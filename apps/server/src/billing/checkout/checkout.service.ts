import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingStatus,
  CustomPlanOfferStatus,
  PaymentPurpose,
  PaymentStatus,
  PlanCtaAction,
  PlanStatus,
  PlanType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../../payment/providers/payment-provider';
import type { PaymentProvider } from '../../payment/providers/payment-provider';
import { BillingConfigService } from '../billing-config.service';
import { CustomerDiscountService } from '../customer-discount.service';
import { calculateInvoiceAmounts } from '../discount.util';
import { PlanService, PlanWithVersion } from '../plans/plan.service';
import {
  SubscriptionService,
  snapshotData,
} from '../subscriptions/subscription.service';
import { TopUpService } from '../topups/topup.service';
import { BillingFulfillmentService } from './fulfillment.service';

export type CheckoutRequest =
  | { kind: 'plan'; planId: string }
  | { kind: 'renewal' }
  | { kind: 'topup'; topUpPackageId: string }
  | { kind: 'offer'; offerId: string };

interface ResolvedCheckout {
  purpose: PaymentPurpose;
  description: string;
  basePaise: number;
  currency: string;
  credits: number;
  plan?: PlanWithVersion;
  subscriptionId?: string; // renewal of an existing ACTIVE subscription
  topUpPackageId?: string;
  offerId?: string;
  summary: Record<string, unknown>;
}

const INTERVAL_LABEL: Record<string, string> = {
  MONTH: 'month',
  YEAR: 'year',
  CUSTOM: 'period',
};

/**
 * Builds and starts checkouts for plan purchases, renewals, upgrades,
 * top-ups and accepted custom-plan offers.
 *
 * Security: the browser only ever names *what* to buy (a plan / package /
 * offer id). Price, credits, discount and tax are always resolved here from
 * the database, and nothing is activated until the provider payment is
 * verified server-side (BillingFulfillmentService).
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
    private config: BillingConfigService,
    private discounts: CustomerDiscountService,
    private plans: PlanService,
    private subscriptions: SubscriptionService,
    private topUps: TopUpService,
    private fulfillment: BillingFulfillmentService,
  ) {}

  /** Price breakdown shown on the review screen (no side effects). */
  async quote(userId: string, req: CheckoutRequest) {
    const resolved = await this.resolve(userId, req);
    return this.present(userId, resolved);
  }

  /**
   * Creates the pending Payment (and, for a new plan, the PENDING_PAYMENT
   * subscription) plus a provider order. Returns only what the browser
   * needs to open checkout — never a secret.
   */
  async start(userId: string, req: CheckoutRequest) {
    const resolved = await this.resolve(userId, req);
    const quote = await this.present(userId, resolved);
    if (quote.totalPaise < 100)
      throw new BadRequestException(
        'This purchase is below the minimum payable amount.',
      );
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, phone: true },
    });

    // A double-click / second tab for the identical purchase reuses the
    // open provider order instead of creating a second one.
    const reusable = await this.prisma.payment.findFirst({
      where: {
        userId,
        purpose: resolved.purpose,
        paymentStatus: PaymentStatus.PENDING,
        providerOrderId: { not: null },
        amount: quote.totalPaise,
        planVersionId:
          resolved.plan?.currentVersion?.id ??
          (resolved.summary.planVersionId as string | undefined) ??
          null,
        topUpPackageId: resolved.topUpPackageId ?? null,
        customOfferId: resolved.offerId ?? null,
        createdAt: { gt: new Date(Date.now() - 30 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable?.providerOrderId && reusable.provider === this.provider.name) {
      return {
        paymentId: reusable.id,
        provider: reusable.provider,
        providerOrderId: reusable.providerOrderId,
        publicKey: this.provider.isConfigured()
          ? (process.env.RAZORPAY_KEY_ID ?? null)
          : null,
        amountPaise: reusable.amount,
        currency: reusable.currency,
        description: resolved.description,
        mock: !this.provider.isConfigured(),
        prefill: { name: user.name, email: user.email, contact: user.phone },
        quote,
      };
    }

    const { payment } = await this.prisma.$transaction(async (tx) => {
      let subscriptionId = resolved.subscriptionId ?? null;
      if (resolved.plan) {
        const pending = await tx.subscription.create({
          data: {
            companyId: userId,
            status: BillingStatus.PENDING_PAYMENT,
            ...snapshotData(resolved.plan, resolved.plan.currentVersion!),
          },
        });
        subscriptionId = pending.id;
      }
      const created = await tx.payment.create({
        data: {
          userId,
          subscriptionId,
          purpose: resolved.purpose,
          provider: this.provider.name,
          amount: quote.totalPaise,
          subtotalPaise: quote.subtotalPaise,
          discountPaise: quote.discountPaise,
          discountPercent: quote.discountPercent,
          taxPercent: quote.taxPercent,
          taxPaise: quote.taxPaise,
          currency: quote.currency,
          credits: resolved.credits,
          planVersionId:
            resolved.plan?.currentVersion?.id ??
            (resolved.summary.planVersionId as string | undefined) ??
            null,
          topUpPackageId: resolved.topUpPackageId ?? null,
          customOfferId: resolved.offerId ?? null,
          description: resolved.description,
          lineItems: quote.lineItems,
        },
      });
      return { payment: created };
    });

    try {
      const checkout = await this.provider.createCheckout({
        paymentId: payment.id,
        amountPaise: payment.amount,
        currency: payment.currency,
        description: resolved.description,
        notes: { paymentId: payment.id, userId, purpose: resolved.purpose },
        customer: { name: user.name, email: user.email, contact: user.phone },
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerOrderId: checkout.providerOrderId },
      });
      return {
        paymentId: payment.id,
        provider: checkout.provider,
        providerOrderId: checkout.providerOrderId,
        publicKey: checkout.publicKey,
        amountPaise: checkout.amountPaise,
        currency: checkout.currency,
        description: resolved.description,
        mock: checkout.mock,
        prefill: { name: user.name, email: user.email, contact: user.phone },
        quote,
      };
    } catch (err) {
      await this.abandon(payment.id, 'provider_order_failed');
      this.logger.error(
        `Could not create provider order for payment ${payment.id}: ${String(err)}`,
      );
      throw new BadRequestException(
        'Could not start checkout with the payment provider. Please try again.',
      );
    }
  }

  /**
   * Browser callback after Checkout succeeds. The signature proves the
   * provider issued this payment for our order; the provider is then asked
   * directly for the payment state before anything is activated.
   */
  async verify(
    userId: string,
    input: {
      paymentId: string;
      providerOrderId: string;
      providerPaymentId: string;
      signature: string;
    },
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: input.paymentId, userId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (
      !payment.providerOrderId ||
      payment.providerOrderId !== input.providerOrderId
    ) {
      throw new BadRequestException(
        'This payment does not belong to that checkout.',
      );
    }
    if (payment.paymentStatus === PaymentStatus.PAID)
      return this.fulfillment.describe(payment.id);

    const verified = await this.provider.verifyPayment({
      providerOrderId: input.providerOrderId,
      providerPaymentId: input.providerPaymentId,
      signature: input.signature,
    });
    if (!verified)
      throw new BadRequestException(
        'We could not verify this payment. If you were charged, it will be confirmed automatically shortly.',
      );

    if (verified.status === 'captured') {
      await this.fulfillment.fulfill(payment.id, verified, 'callback');
    } else if (verified.status === 'failed') {
      await this.fulfillment.markFailed(
        payment.id,
        verified,
        verified.errorDescription ?? 'Payment failed',
      );
    }
    // 'authorized'/'pending': the webhook completes it; the client polls.
    return this.fulfillment.describe(payment.id);
  }

  /**
   * Browser reports Checkout's payment.failed. Only ever moves a payment
   * toward FAILED (never to success); a later verified capture still wins.
   */
  async reportFailure(
    userId: string,
    paymentId: string,
    input: { providerPaymentId?: string; code?: string; description?: string },
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.paymentStatus === PaymentStatus.PENDING) {
      await this.fulfillment.markFailed(
        payment.id,
        input.providerPaymentId
          ? {
              providerPaymentId: input.providerPaymentId,
              errorCode: input.code ?? null,
              errorDescription: input.description ?? null,
            }
          : null,
        input.description?.slice(0, 200) || 'Payment failed',
      );
    }
    return this.fulfillment.describe(payment.id);
  }

  async getStatus(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
      select: { id: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.fulfillment.describe(paymentId);
  }

  /** Marks an unpaid checkout abandoned (and its pending subscription cancelled). */
  async abandon(paymentId: string, reason: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (
      !payment ||
      ![PaymentStatus.PENDING, PaymentStatus.FAILED].includes(
        payment.paymentStatus as 'PENDING' | 'FAILED',
      )
    )
      return;
    await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: {
          id: paymentId,
          paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
        },
        data: {
          paymentStatus: PaymentStatus.EXPIRED,
          failureReason: payment.failureReason ?? reason,
        },
      }),
      ...(payment.subscriptionId &&
      payment.purpose !== PaymentPurpose.SUBSCRIPTION_RENEWAL
        ? [
            this.prisma.subscription.updateMany({
              where: {
                id: payment.subscriptionId,
                status: BillingStatus.PENDING_PAYMENT,
              },
              data: { status: BillingStatus.CANCELED, canceledAt: new Date() },
            }),
          ]
        : []),
    ]);
  }

  // ── Resolution ────────────────────────────────────────────
  private async resolve(
    userId: string,
    req: CheckoutRequest,
  ): Promise<ResolvedCheckout> {
    switch (req?.kind) {
      case 'plan':
        return this.resolvePlan(userId, req.planId);
      case 'renewal':
        return this.resolveRenewal(userId);
      case 'topup':
        return this.resolveTopUp(req.topUpPackageId);
      case 'offer':
        return this.resolveOffer(userId, req.offerId);
      default:
        throw new BadRequestException('Unknown checkout type.');
    }
  }

  private async resolvePlan(
    userId: string,
    planId: string,
  ): Promise<ResolvedCheckout> {
    if (!planId) throw new BadRequestException('planId is required.');
    const plan = await this.plans.getPlan(planId);
    const v = plan.currentVersion;
    if (plan.status !== PlanStatus.ACTIVE || !v)
      throw new BadRequestException('This plan is not available.');
    if (plan.type === PlanType.FREE)
      throw new BadRequestException('The Free plan needs no checkout.');
    if (!plan.isPublic && plan.assignedUserId !== userId)
      throw new NotFoundException('Plan not found');
    if (plan.type === PlanType.CUSTOM) {
      if (
        plan.ctaAction === PlanCtaAction.CONTACT_SALES ||
        plan.assignedUserId !== userId
      ) {
        throw new BadRequestException(
          'Custom plans are arranged with our team — request one from Billing.',
        );
      }
    }

    const current = await this.subscriptions.getActiveSubscription(userId);
    if (current.planId === plan.id && current.planType !== PlanType.FREE) {
      return this.resolveRenewal(userId);
    }
    let purpose: PaymentPurpose = PaymentPurpose.SUBSCRIPTION_PURCHASE;
    if (current.planType !== PlanType.FREE) {
      if (v.pricePaise <= current.pricePaise) {
        throw new ConflictException(
          'That plan costs the same or less than your current plan. Downgrades take effect when your current period ends — schedule one from Manage plan.',
        );
      }
      purpose = PaymentPurpose.SUBSCRIPTION_UPGRADE;
    }
    if (plan.type === PlanType.CUSTOM) purpose = PaymentPurpose.CUSTOM_PLAN;

    return {
      purpose,
      description: `${plan.name} plan`,
      basePaise: v.pricePaise,
      currency: v.currency,
      credits: v.includedCredits,
      plan,
      summary: this.planSummary(plan, purpose),
    };
  }

  private async resolveRenewal(userId: string): Promise<ResolvedCheckout> {
    const current = await this.subscriptions.getActiveSubscription(userId);
    if (current.planType !== PlanType.FREE && current.planId) {
      const plan = await this.plans.getPlan(current.planId);
      const v = plan.currentVersion;
      if (plan.status !== PlanStatus.ACTIVE || !v) {
        throw new BadRequestException(
          `${plan.name} is no longer offered. Choose another plan to continue after this period.`,
        );
      }
      return {
        purpose: PaymentPurpose.SUBSCRIPTION_RENEWAL,
        description: `${plan.name} plan renewal`,
        basePaise: v.pricePaise,
        currency: v.currency,
        credits: v.includedCredits,
        subscriptionId: current.id,
        summary: {
          ...this.planSummary(plan, PaymentPurpose.SUBSCRIPTION_RENEWAL),
          planVersionId: v.id,
          renewsFrom: current.currentPeriodEnd,
        },
      };
    }

    // On Free after a paid plan ended: renew = buy that plan (or the
    // downgrade the customer had scheduled) again.
    const ended = await this.prisma.subscription.findFirst({
      where: {
        companyId: userId,
        status: { in: [BillingStatus.EXPIRED, BillingStatus.CANCELED] },
        planType: { not: PlanType.FREE },
        replacedBySubscriptionId: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
    // A downgrade scheduled to Free just ended the plan; renewing means the
    // paid plan again.
    const scheduled = ended?.scheduledPlanId
      ? await this.prisma.plan.findUnique({
          where: { id: ended.scheduledPlanId },
          select: { id: true, type: true },
        })
      : null;
    const targetId =
      scheduled && scheduled.type !== PlanType.FREE
        ? scheduled.id
        : ended?.planId;
    if (!targetId)
      throw new BadRequestException(
        'There is no plan to renew. Choose a plan instead.',
      );
    return this.resolvePlan(userId, targetId);
  }

  private async resolveTopUp(
    topUpPackageId: string,
  ): Promise<ResolvedCheckout> {
    if (!topUpPackageId)
      throw new BadRequestException('topUpPackageId is required.');
    const pkg = await this.topUps.getActive(topUpPackageId);
    return {
      purpose: PaymentPurpose.TOPUP,
      description: `${pkg.credits.toLocaleString('en-IN')} credit top-up`,
      basePaise: pkg.pricePaise,
      currency: pkg.currency,
      credits: pkg.credits,
      topUpPackageId: pkg.id,
      summary: { type: 'topup', name: pkg.name, credits: pkg.credits },
    };
  }

  private async resolveOffer(
    userId: string,
    offerId: string,
  ): Promise<ResolvedCheckout> {
    if (!offerId) throw new BadRequestException('offerId is required.');
    const offer = await this.prisma.customPlanOffer.findFirst({
      where: { id: offerId, userId },
      include: { plan: true, planVersion: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.status !== CustomPlanOfferStatus.SENT)
      throw new BadRequestException('This offer is no longer open.');
    if (offer.expiresAt && offer.expiresAt < new Date())
      throw new BadRequestException(
        'This offer has expired. Ask our team for a new one.',
      );
    const plan = {
      ...offer.plan,
      currentVersion: offer.planVersion,
    } as PlanWithVersion;
    return {
      purpose: PaymentPurpose.CUSTOM_PLAN,
      description: `${offer.plan.name} (custom plan)`,
      basePaise: offer.planVersion.pricePaise,
      currency: offer.planVersion.currency,
      credits: offer.planVersion.includedCredits,
      plan,
      offerId: offer.id,
      summary: this.planSummary(plan, PaymentPurpose.CUSTOM_PLAN),
    };
  }

  private planSummary(plan: PlanWithVersion, purpose: PaymentPurpose) {
    const v = plan.currentVersion!;
    return {
      type: 'plan',
      purpose,
      planId: plan.id,
      planName: plan.name,
      planType: plan.type,
      planVersionId: v.id,
      billingInterval: v.billingInterval,
      intervalCount: v.intervalCount,
      intervalLabel:
        v.billingInterval === 'CUSTOM'
          ? `${v.intervalCount} days`
          : `${v.intervalCount > 1 ? `${v.intervalCount} ` : ''}${INTERVAL_LABEL[v.billingInterval]}${v.intervalCount > 1 ? 's' : ''}`,
      includedCredits: v.includedCredits,
      features: v.features,
    };
  }

  private async present(userId: string, r: ResolvedCheckout) {
    const [config, discount] = await Promise.all([
      this.config.get(),
      this.discounts.getActiveDiscount(userId),
    ]);
    const amounts = calculateInvoiceAmounts({
      subtotalPaise: r.basePaise,
      discountPercent: discount?.percentage ?? null,
      taxPercent: config.taxPercent,
    });
    const lineItems: {
      label: string;
      amountPaise: number;
      credits?: number;
    }[] = [
      { label: r.description, amountPaise: r.basePaise, credits: r.credits },
    ];
    if (amounts.discountPaise > 0) {
      lineItems.push({
        label: `Discount (${amounts.discountPercent}%)`,
        amountPaise: -amounts.discountPaise,
      });
    }
    if (amounts.taxPaise > 0)
      lineItems.push({
        label: `GST (${config.taxPercent}%)`,
        amountPaise: amounts.taxPaise,
      });
    return {
      purpose: r.purpose,
      description: r.description,
      credits: r.credits,
      currency: r.currency,
      subtotalPaise: amounts.subtotalPaise,
      discountPercent: amounts.discountPercent,
      discountPaise: amounts.discountPaise,
      discountReason: discount?.reason ?? null,
      taxPercent: config.taxPercent,
      taxPaise: amounts.taxPaise,
      totalPaise: amounts.totalPaise,
      lineItems,
      summary: r.summary,
    };
  }
}
