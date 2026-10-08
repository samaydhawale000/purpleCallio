import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  BillingStatus,
  PlanStatus,
  PlanType,
  PlanVersion,
  Prisma,
  Subscription,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../../payment/providers/payment-provider';
import type {
  PaymentProvider,
  ProviderSubscription,
} from '../../payment/providers/payment-provider';
import { BillingAuditService } from '../billing-audit.service';
import { BillingConfigService } from '../billing-config.service';
import { BillingNotificationService } from '../billing-notification.service';
import { CustomerDiscountService } from '../customer-discount.service';
import { calculateInvoiceAmounts } from '../discount.util';

type Client = Prisma.TransactionClient | PrismaService;

/** Provider mandate states in which the next renewal can still be charged. */
export const LIVE_MANDATE_STATES = [
  'created',
  'authenticated',
  'active',
  'pending',
];

export interface RenewalTerms {
  version: PlanVersion & {
    plan: { id: string; name: string; type: PlanType; status: PlanStatus };
  };
  subtotalPaise: number;
  discountPercent: number | null;
  discountPaise: number;
  taxPercent: number;
  taxPaise: number;
  totalPaise: number;
}

/**
 * Auto-renew on top of prepaid billing.
 *
 * A customer who keeps auto-renew on authorizes a recurring e-mandate (card
 * or UPI Autopay) with the payment provider. The provider owns the charging
 * schedule, pre-debit notifications and retries; each period is still paid
 * at its start, and our server only extends the plan + grants credits after
 * a verified `subscription.charged` webhook (BillingFulfillmentService).
 *
 * This service keeps the mandate's amount in line with what the next
 * renewal should cost — the plan's current price (price changes apply from
 * the next renewal, with notice), a scheduled downgrade, GST and any
 * customer discount — and turns mandates on/off.
 */
@Injectable()
export class AutoRenewService {
  private readonly logger = new Logger(AutoRenewService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
    private config: BillingConfigService,
    private discounts: CustomerDiscountService,
    private notify: BillingNotificationService,
    private audit: BillingAuditService,
  ) {}

  // ── Terms ────────────────────────────────────────────────
  /**
   * What the next renewal of `sub` will be for: a scheduled (paid)
   * downgrade's plan, otherwise the plan's current version (so admin price
   * changes apply from the next renewal), falling back to the purchased
   * version if the plan is no longer offered.
   */
  async renewalTerms(
    sub: Subscription,
    client: Client = this.prisma,
  ): Promise<RenewalTerms | null> {
    const pick = async (planId: string | null) => {
      if (!planId) return null;
      const plan = await client.plan.findUnique({
        where: { id: planId },
        include: { currentVersion: true },
      });
      if (
        !plan?.currentVersion ||
        plan.status !== PlanStatus.ACTIVE ||
        plan.type === PlanType.FREE
      )
        return null;
      return { ...plan.currentVersion, plan };
    };
    const version =
      (await pick(sub.scheduledPlanId)) ??
      (await pick(sub.planId)) ??
      (sub.planVersionId
        ? await client.planVersion.findUnique({
            where: { id: sub.planVersionId },
            include: { plan: true },
          })
        : null);
    if (!version) return null;
    const [config, discount] = await Promise.all([
      this.config.get(client),
      this.discounts.getActiveDiscount(sub.companyId),
    ]);
    const amounts = calculateInvoiceAmounts({
      subtotalPaise: version.pricePaise,
      discountPercent: discount?.percentage ?? null,
      taxPercent: config.taxPercent,
    });
    return {
      version,
      subtotalPaise: amounts.subtotalPaise,
      discountPercent: amounts.discountPercent,
      discountPaise: amounts.discountPaise,
      taxPercent: config.taxPercent,
      taxPaise: amounts.taxPaise,
      totalPaise: amounts.totalPaise,
    };
  }

  /** Provider recurring plan for an exact amount + interval (created once, reused). */
  async providerPlanFor(input: {
    amountPaise: number;
    currency: string;
    billingInterval: 'MONTH' | 'YEAR' | 'CUSTOM';
    intervalCount: number;
    name: string;
  }): Promise<string> {
    const key = {
      provider: this.provider.name,
      amountPaise: input.amountPaise,
      currency: input.currency,
      billingInterval: input.billingInterval,
      intervalCount: input.intervalCount,
    };
    const existing = await this.prisma.providerPlan.findUnique({
      where: {
        provider_amountPaise_currency_billingInterval_intervalCount: key,
      },
    });
    if (existing) return existing.providerPlanId;
    const providerPlanId = await this.provider.createRecurringPlan(input);
    try {
      await this.prisma.providerPlan.create({
        data: { ...key, providerPlanId },
      });
      return providerPlanId;
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      // Concurrent creation: use whichever row won.
      return (
        await this.prisma.providerPlan.findUniqueOrThrow({
          where: {
            provider_amountPaise_currency_billingInterval_intervalCount: key,
          },
        })
      ).providerPlanId;
    }
  }

  /** Mandate whose first charge is this checkout (charged on authorization). */
  async createMandateForCheckout(input: {
    paymentId: string;
    userId: string;
    amountPaise: number;
    currency: string;
    version: Pick<PlanVersion, 'billingInterval' | 'intervalCount'>;
    planName: string;
  }): Promise<ProviderSubscription> {
    const providerPlanId = await this.providerPlanFor({
      amountPaise: input.amountPaise,
      currency: input.currency,
      billingInterval: input.version.billingInterval,
      intervalCount: input.version.intervalCount,
      name: `${input.planName} (auto-renew)`,
    });
    return this.provider.createSubscription({
      providerPlanId,
      notes: {
        paymentId: input.paymentId,
        userId: input.userId,
        purpose: 'auto_renew',
      },
    });
  }

  // ── Customer: turn on / off ─────────────────────────────
  private async activePaid(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { companyId: userId, status: BillingStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub || sub.planType === PlanType.FREE || !sub.currentPeriodEnd) {
      throw new BadRequestException('Auto-renew is available on paid plans.');
    }
    return sub;
  }

  /**
   * Starts a mandate for a plan bought without auto-renew. Nothing is
   * charged now: the first charge is at the current period's end. The
   * customer authorizes it in Checkout; confirmEnable (or the provider's
   * `subscription.authenticated` webhook) switches auto-renew on.
   */
  async startEnable(userId: string) {
    const sub = await this.activePaid(userId);
    if (sub.autoRenew)
      throw new BadRequestException('Auto-renew is already on.');
    const terms = await this.renewalTerms(sub);
    if (!terms)
      throw new BadRequestException(
        'This plan is no longer offered, so it cannot renew. Choose another plan instead.',
      );
    if (terms.version.plan.type === PlanType.FREE)
      throw new BadRequestException('Auto-renew is available on paid plans.');

    // A previous, never-authorized mandate attempt is replaced.
    if (sub.providerSubscriptionId && !sub.autoRenew) {
      await this.provider
        .cancelSubscription(sub.providerSubscriptionId, false)
        .catch(() => undefined);
    }
    const providerPlanId = await this.providerPlanFor({
      amountPaise: terms.totalPaise,
      currency: terms.version.currency,
      billingInterval: terms.version.billingInterval,
      intervalCount: terms.version.intervalCount,
      name: `${terms.version.plan.name} (auto-renew)`,
    });
    const mandate = await this.provider.createSubscription({
      providerPlanId,
      startAt: sub.currentPeriodEnd,
      notes: { subscriptionId: sub.id, userId, purpose: 'auto_renew' },
    });
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        providerSubscriptionId: mandate.providerSubscriptionId,
        providerSubscriptionStatus: mandate.status,
        renewalPlanVersionId: terms.version.id,
        renewalAmountPaise: terms.totalPaise,
      },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, phone: true },
    });
    return {
      mode: 'mandate' as const,
      provider: this.provider.name,
      providerSubscriptionId: mandate.providerSubscriptionId,
      publicKey: this.provider.isConfigured()
        ? (process.env.RAZORPAY_KEY_ID ?? null)
        : null,
      mock: !this.provider.isConfigured(),
      description: `${terms.version.plan.name} auto-renew`,
      renewalAmountPaise: terms.totalPaise,
      currency: terms.version.currency,
      firstChargeAt: sub.currentPeriodEnd,
      prefill: {
        name: user?.name ?? null,
        email: user?.email ?? null,
        contact: user?.phone ?? null,
      },
    };
  }

  /** Browser proof that the customer authorized the mandate. */
  async confirmEnable(
    userId: string,
    input: {
      providerSubscriptionId: string;
      providerPaymentId: string;
      signature: string;
    },
  ) {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        companyId: userId,
        providerSubscriptionId: input.providerSubscriptionId,
      },
    });
    if (!sub)
      throw new BadRequestException(
        'This auto-renew setup does not belong to your plan.',
      );
    if (sub.autoRenew) return this.describe(sub);
    const verified = await this.provider.verifySubscriptionPayment(input);
    if (!verified)
      throw new BadRequestException(
        'We could not verify the auto-renew authorization.',
      );
    const updated = await this.markAuthorized(sub.id, 'authenticated');
    return this.describe(updated ?? sub);
  }

  /** Mandate is authorized (browser proof or provider webhook). Idempotent. */
  async markAuthorized(subscriptionId: string, status: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub || sub.autoRenew || sub.status !== BillingStatus.ACTIVE)
      return sub;
    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        autoRenew: true,
        providerSubscriptionStatus: status,
        cancelAtPeriodEnd: false,
        autoRenewChangedAt: new Date(),
        autoRenewOffReason: null,
      },
    });
    await this.audit.log({
      action: 'SUBSCRIPTION_RESUMED',
      actorId: sub.companyId,
      entity: 'Subscription',
      entityId: sub.id,
      newValue: { autoRenew: true, renewalAmountPaise: sub.renewalAmountPaise },
    });
    await this.notify.autoRenewChanged(updated, true);
    return updated;
  }

  /**
   * Turns auto-renew off. `atCycleEnd` keeps the current (already paid)
   * period untouched — the plan simply won't renew. Never throws on a
   * provider error: the local flag is what stops renewals being honored.
   */
  async disable(
    subscriptionId: string,
    reason: string,
    opts: {
      atCycleEnd?: boolean;
      notifyCustomer?: boolean;
      actorId?: string | null;
      callProvider?: boolean;
    } = {},
  ) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub || (!sub.autoRenew && !sub.providerSubscriptionId)) return sub;
    if (sub.providerSubscriptionId && opts.callProvider !== false) {
      try {
        await this.provider.cancelSubscription(
          sub.providerSubscriptionId,
          opts.atCycleEnd ?? true,
        );
      } catch (err) {
        this.logger.warn(
          `Could not cancel mandate ${sub.providerSubscriptionId}: ${String(err)}`,
        );
      }
    }
    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        autoRenew: false,
        providerSubscriptionStatus: 'cancelled',
        autoRenewChangedAt: new Date(),
        autoRenewOffReason: reason,
      },
    });
    if (sub.autoRenew) {
      await this.audit.log({
        action: 'SUBSCRIPTION_CANCELED',
        actorId: opts.actorId ?? sub.companyId,
        entity: 'Subscription',
        entityId: sub.id,
        oldValue: { autoRenew: true },
        newValue: { autoRenew: false, reason },
      });
      if (opts.notifyCustomer !== false)
        await this.notify.autoRenewChanged(updated, false, reason);
    }
    return updated;
  }

  /** Customer turns auto-renew off: the plan stays active until period end. */
  async disableForCustomer(userId: string) {
    const sub = await this.activePaid(userId);
    if (!sub.autoRenew) return this.describe(sub);
    const updated = await this.disable(sub.id, 'customer', {
      atCycleEnd: true,
      notifyCustomer: false,
    });
    return this.describe(updated ?? sub);
  }

  // ── Keeping the mandate amount right ─────────────────────
  /**
   * Re-points the mandate at what the next renewal should cost. Called when
   * a plan's price changes, GST changes, a customer's discount changes or a
   * downgrade is scheduled. Applies from the next cycle, and the customer
   * is told about any change in amount before it is charged. If the
   * provider can't move the mandate, auto-renew is switched off (the
   * customer is never charged an amount they weren't told about).
   */
  async syncRenewalTerms(subscriptionId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (
      !sub ||
      !sub.autoRenew ||
      !sub.providerSubscriptionId ||
      sub.status !== BillingStatus.ACTIVE
    )
      return;
    const terms = await this.renewalTerms(sub);
    if (!terms) {
      await this.disable(sub.id, 'plan_unavailable', { atCycleEnd: true });
      return;
    }
    if (
      terms.totalPaise === sub.renewalAmountPaise &&
      terms.version.id === (sub.renewalPlanVersionId ?? sub.planVersionId)
    )
      return;

    const amountChanged =
      sub.renewalAmountPaise != null &&
      terms.totalPaise !== sub.renewalAmountPaise;
    try {
      if (terms.totalPaise !== sub.renewalAmountPaise) {
        const providerPlanId = await this.providerPlanFor({
          amountPaise: terms.totalPaise,
          currency: terms.version.currency,
          billingInterval: terms.version.billingInterval,
          intervalCount: terms.version.intervalCount,
          name: `${terms.version.plan.name} (auto-renew)`,
        });
        await this.provider.changeSubscriptionPlan(
          sub.providerSubscriptionId,
          providerPlanId,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Could not update mandate ${sub.providerSubscriptionId}: ${String(err)}`,
      );
      await this.disable(sub.id, 'renewal_terms_changed', { atCycleEnd: true });
      return;
    }
    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        renewalPlanVersionId: terms.version.id,
        renewalAmountPaise: terms.totalPaise,
      },
    });
    await this.audit.log({
      action: 'SUBSCRIPTION_RENEWED',
      entity: 'Subscription',
      entityId: sub.id,
      oldValue: {
        renewalAmountPaise: sub.renewalAmountPaise,
        renewalPlanVersionId: sub.renewalPlanVersionId,
      },
      newValue: {
        renewalAmountPaise: terms.totalPaise,
        renewalPlanVersionId: terms.version.id,
      },
      extra: { change: 'auto_renew_terms' },
    });
    if (amountChanged)
      await this.notify.renewalPriceChanged(
        updated,
        terms.version.plan.name,
        terms.totalPaise,
      );
  }

  /** All auto-renewing subscriptions on (or downgrading to) a plan. */
  async syncPlan(planId: string) {
    const subs = await this.prisma.subscription.findMany({
      where: {
        status: BillingStatus.ACTIVE,
        autoRenew: true,
        OR: [{ planId }, { scheduledPlanId: planId }],
      },
      select: { id: true },
    });
    for (const s of subs)
      await this.syncRenewalTerms(s.id).catch((err) =>
        this.logger.warn(String(err)),
      );
    return subs.length;
  }

  async syncCustomer(userId: string) {
    const subs = await this.prisma.subscription.findMany({
      where: {
        companyId: userId,
        status: BillingStatus.ACTIVE,
        autoRenew: true,
      },
      select: { id: true },
    });
    for (const s of subs)
      await this.syncRenewalTerms(s.id).catch((err) =>
        this.logger.warn(String(err)),
      );
  }

  async syncAll() {
    const subs = await this.prisma.subscription.findMany({
      where: { status: BillingStatus.ACTIVE, autoRenew: true },
      select: { id: true },
    });
    for (const s of subs)
      await this.syncRenewalTerms(s.id).catch((err) =>
        this.logger.warn(String(err)),
      );
    return subs.length;
  }

  /** Fire-and-forget wrapper for admin edits (never blocks the request). */
  inBackground(task: () => Promise<unknown>, label: string) {
    setImmediate(() => {
      task().catch((err) =>
        this.logger.error(`Auto-renew sync (${label}) failed: ${String(err)}`),
      );
    });
  }

  // ── Provider lifecycle events (non-charge) ───────────────
  async onMandateEvent(
    type: string,
    mandate: { providerSubscriptionId: string; status: string },
  ) {
    const sub = await this.prisma.subscription.findUnique({
      where: { providerSubscriptionId: mandate.providerSubscriptionId },
    });
    if (!sub) return;
    if (
      type === 'subscription.authenticated' ||
      type === 'subscription.activated'
    ) {
      // Mandate set up for an existing plan (no charge yet).
      if (!sub.autoRenew && sub.status === BillingStatus.ACTIVE)
        await this.markAuthorized(sub.id, mandate.status);
      else
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { providerSubscriptionStatus: mandate.status },
        });
      return;
    }
    if (type === 'subscription.pending') {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { providerSubscriptionStatus: 'pending' },
      });
      await this.notify.renewalChargeFailed(sub, true);
      return;
    }
    if (type === 'subscription.halted') {
      await this.disable(sub.id, 'renewal_failed', {
        callProvider: false,
        notifyCustomer: false,
      });
      await this.notify.renewalChargeFailed(sub, false);
      return;
    }
    if (
      type === 'subscription.cancelled' ||
      type === 'subscription.completed'
    ) {
      await this.disable(
        sub.id,
        type === 'subscription.completed'
          ? 'mandate_completed'
          : 'mandate_cancelled',
        {
          callProvider: false,
        },
      );
    }
  }

  describe(sub: Subscription) {
    return {
      autoRenew: sub.autoRenew,
      status: sub.providerSubscriptionStatus,
      renewalAmountPaise: sub.renewalAmountPaise,
      nextChargeAt: sub.autoRenew ? sub.currentPeriodEnd : null,
      offReason: sub.autoRenewOffReason,
    };
  }
}
