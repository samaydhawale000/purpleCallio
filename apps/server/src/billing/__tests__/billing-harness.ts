import { PrismaClient } from '@prisma/client';
import { BillingAuditService } from '../billing-audit.service';
import { BillingConfigService } from '../billing-config.service';
import { BillingNotificationService } from '../billing-notification.service';
import { CheckoutService } from '../checkout/checkout.service';
import { BillingFulfillmentService } from '../checkout/fulfillment.service';
import { BillingWebhookService } from '../checkout/billing-webhook.service';
import { CreditService } from '../credits/credit.service';
import { CustomPlanService } from '../custom-plans/custom-plan.service';
import { CustomerDiscountService } from '../customer-discount.service';
import { PlanService } from '../plans/plan.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { TopUpService } from '../topups/topup.service';
import { UsageBillingService } from '../usage-billing.service';
import { AutoRenewService } from '../subscriptions/auto-renew.service';
import { SupportService } from '../../support/support.service';
import type {
  PaymentProvider,
  ProviderCheckout,
  ProviderCheckoutInput,
  ProviderPayment,
  ProviderPaymentVerification,
  ProviderRecurringPlanInput,
  ProviderSubscription,
  ProviderSubscriptionInput,
  ProviderWebhookEvent,
} from '../../payment/providers/payment-provider';

/**
 * Real-database harness for billing integration tests. Point
 * BILLING_TEST_DATABASE_URL at a disposable, migrated Postgres database —
 * every test truncates it. Never use a database with real data.
 */
export const TEST_DB_URL = process.env.BILLING_TEST_DATABASE_URL;

/**
 * Deterministic in-memory payment provider. Orders/payments it "issues"
 * can be captured or failed by the test; webhooks are JSON bodies whose
 * signature header must equal `sig:<eventId>`.
 */
export class FakeProvider implements PaymentProvider {
  readonly name = 'fake';
  orders = new Map<
    string,
    { amountPaise: number; currency: string; paymentId: string }
  >();
  payments = new Map<string, ProviderPayment>();
  refunds: { providerPaymentId: string; amountPaise: number }[] = [];
  recurringPlans = new Map<string, { amountPaise: number; currency: string }>();
  mandates = new Map<
    string,
    { providerPlanId: string; startAt: Date | null }
  >();
  cancelledMandates: { id: string; atCycleEnd: boolean }[] = [];
  planChanges: { id: string; providerPlanId: string }[] = [];
  failNextPlanChange = false;
  private seq = 0;

  isConfigured() {
    return true;
  }

  async createCheckout(
    input: ProviderCheckoutInput,
  ): Promise<ProviderCheckout> {
    const providerOrderId = `order_${++this.seq}`;
    this.orders.set(providerOrderId, {
      amountPaise: input.amountPaise,
      currency: input.currency,
      paymentId: input.paymentId,
    });
    return {
      provider: this.name,
      providerOrderId,
      publicKey: 'pk_test',
      amountPaise: input.amountPaise,
      currency: input.currency,
      mock: false,
    };
  }

  /** Simulates the customer paying in Checkout. */
  pay(
    providerOrderId: string,
    opts: { status?: 'captured' | 'failed'; amountPaise?: number } = {},
  ) {
    const order = this.orders.get(providerOrderId)!;
    const providerPaymentId = `pay_${++this.seq}`;
    const p: ProviderPayment = {
      providerPaymentId,
      providerOrderId,
      status: opts.status ?? 'captured',
      amountPaise: opts.amountPaise ?? order.amountPaise,
      currency: order.currency,
      method: 'card',
      errorDescription: opts.status === 'failed' ? 'Card declined' : null,
    };
    this.payments.set(providerPaymentId, p);
    return { ...p, signature: `sig:${providerOrderId}|${providerPaymentId}` };
  }

  async verifyPayment(input: ProviderPaymentVerification) {
    if (
      input.signature !==
      `sig:${input.providerOrderId}|${input.providerPaymentId}`
    )
      return null;
    const p = this.payments.get(input.providerPaymentId);
    return p && p.providerOrderId === input.providerOrderId ? p : null;
  }

  async getPayment(id: string) {
    return this.payments.get(id)!;
  }

  async refundPayment(providerPaymentId: string, amountPaise?: number) {
    this.refunds.push({ providerPaymentId, amountPaise: amountPaise ?? 0 });
    return {
      providerRefundId: `rfnd_${++this.seq}`,
      amountPaise: amountPaise ?? 0,
    };
  }

  // ── Recurring mandates ──
  async createRecurringPlan(input: ProviderRecurringPlanInput) {
    const id = `rplan_${++this.seq}`;
    this.recurringPlans.set(id, {
      amountPaise: input.amountPaise,
      currency: input.currency,
    });
    return id;
  }

  async createSubscription(
    input: ProviderSubscriptionInput,
  ): Promise<ProviderSubscription> {
    const id = `rsub_${++this.seq}`;
    this.mandates.set(id, {
      providerPlanId: input.providerPlanId,
      startAt: input.startAt ?? null,
    });
    return { providerSubscriptionId: id, status: 'created', currentEnd: null };
  }

  async verifySubscriptionPayment(input: {
    providerSubscriptionId: string;
    providerPaymentId: string;
    signature: string;
  }) {
    if (
      input.signature !==
      `sig:${input.providerPaymentId}|${input.providerSubscriptionId}`
    )
      return null;
    return this.payments.get(input.providerPaymentId) ?? null;
  }

  async changeSubscriptionPlan(id: string, providerPlanId: string) {
    if (this.failNextPlanChange) {
      this.failNextPlanChange = false;
      throw new Error('provider refused plan change');
    }
    this.planChanges.push({ id, providerPlanId });
    const m = this.mandates.get(id);
    if (m) m.providerPlanId = providerPlanId;
  }

  async cancelSubscription(id: string, atCycleEnd: boolean) {
    this.cancelledMandates.push({ id, atCycleEnd });
  }

  /** Amount the mandate currently charges. */
  mandateAmount(id: string) {
    const m = this.mandates.get(id)!;
    return this.recurringPlans.get(m.providerPlanId)!.amountPaise;
  }

  /** A charge on a mandate (first payment or a renewal). */
  chargeMandate(
    id: string,
    opts: { status?: 'captured' | 'failed'; amountPaise?: number } = {},
  ) {
    const providerPaymentId = `pay_${++this.seq}`;
    const p: ProviderPayment = {
      providerPaymentId,
      providerOrderId: `order_rzp_${this.seq}`,
      status: opts.status ?? 'captured',
      amountPaise: opts.amountPaise ?? this.mandateAmount(id),
      currency: 'INR',
      method: 'upi',
    };
    this.payments.set(providerPaymentId, p);
    return { ...p, signature: `sig:${providerPaymentId}|${id}` };
  }

  mandateWebhook(
    eventId: string,
    type: string,
    mandate: {
      providerSubscriptionId: string;
      status: string;
      currentEnd?: Date | null;
    },
    payment?: ProviderPayment,
  ) {
    return {
      raw: Buffer.from(
        JSON.stringify({
          id: eventId,
          event: type,
          payment: payment ?? null,
          subscription: {
            ...mandate,
            currentEnd: mandate.currentEnd?.toISOString() ?? null,
          },
        }),
      ),
      headers: { 'x-sig': `sig:${eventId}`, 'x-event-id': eventId },
    };
  }

  webhookBody(eventId: string, type: string, payment: ProviderPayment) {
    return {
      raw: Buffer.from(JSON.stringify({ id: eventId, event: type, payment })),
      headers: { 'x-sig': `sig:${eventId}`, 'x-event-id': eventId },
    };
  }

  async parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<ProviderWebhookEvent> {
    const body = JSON.parse(rawBody.toString('utf8'));
    if (headers['x-sig'] !== `sig:${body.id}`) throw new Error('bad signature');
    return {
      eventId: body.id,
      type: body.event,
      rawType: body.event,
      payment: body.payment,
      subscription: body.subscription
        ? {
            ...body.subscription,
            currentEnd: body.subscription.currentEnd
              ? new Date(body.subscription.currentEnd)
              : null,
          }
        : null,
      refund: body.refund ?? null,
      raw: body,
    };
  }
}

export function createHarness() {
  const prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  }) as any;
  const notifications = {
    createNotification: jest.fn(async () => null),
    notifyAdmins: jest.fn(async () => undefined),
  };
  const realtime = { emitToUser: jest.fn(), emitToAdmins: jest.fn() };
  const provider = new FakeProvider();

  const audit = new BillingAuditService(prisma);
  const config = new BillingConfigService(prisma, audit);
  const plans = new PlanService(prisma, audit);
  const credits = new CreditService(prisma);
  const notify = new BillingNotificationService(notifications as any);
  const discounts = new CustomerDiscountService(prisma);
  const autoRenew = new AutoRenewService(
    prisma,
    provider,
    config,
    discounts,
    notify,
    audit,
  );
  const subscriptions = new SubscriptionService(
    prisma,
    credits,
    plans,
    audit,
    notify,
    config,
    autoRenew,
  );
  const entitlements = new EntitlementService(
    prisma,
    subscriptions,
    credits,
    config,
  );
  const topUps = new TopUpService(prisma, audit);
  const fulfillment = new BillingFulfillmentService(
    prisma,
    provider,
    credits,
    subscriptions,
    config,
    audit,
    notify,
    notifications as any,
    autoRenew,
  );
  const checkout = new CheckoutService(
    prisma,
    provider,
    config,
    discounts,
    plans,
    subscriptions,
    topUps,
    fulfillment,
    autoRenew,
  );
  const webhooks = new BillingWebhookService(
    prisma,
    provider,
    fulfillment,
    notifications as any,
    autoRenew,
  );
  const support = new SupportService(
    prisma,
    notifications as any,
    realtime as any,
  );
  const customPlans = new CustomPlanService(
    prisma,
    support,
    plans,
    subscriptions,
    credits,
    audit,
    notify,
  );
  const usage = new UsageBillingService(
    prisma,
    config,
    credits,
    subscriptions,
    entitlements,
    notify,
  );

  return {
    prisma,
    notifications,
    provider,
    audit,
    config,
    plans,
    credits,
    subscriptions,
    entitlements,
    topUps,
    fulfillment,
    checkout,
    webhooks,
    support,
    customPlans,
    usage,
    autoRenew,
  };
}

export type Harness = ReturnType<typeof createHarness>;

const TABLES = [
  'ProviderPlan',
  'CreditTransaction',
  'CreditBucket',
  'CreditWallet',
  'PaymentAttempt',
  'PaymentWebhookEvent',
  'Payment',
  'CustomPlanOffer',
  'CustomPlanRequest',
  'SupportMessage',
  'SupportTicket',
  'CallUsage',
  'Usage',
  'UsageSegment',
  'CallEvent',
  'CallSession',
  'Call',
  'ApiKey',
  'Project',
  'Subscription',
  'Plan',
  'PlanVersion',
  'Feature',
  'TopUpPackage',
  'BillingConfig',
  'CustomerDiscount',
  'Notification',
  'AuditLog',
  'PlatformSetting',
  'User',
];

export async function resetDb(h: Harness) {
  await h.prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`,
  );
  await h.plans.ensureDefaults();
  // Most tests exercise one-time checkout; auto-renew tests opt in explicitly.
  await h.prisma.billingConfig.update({
    where: { key: 'default' },
    data: { autoRenewDefault: false },
  });
}

export async function createUser(
  h: Harness,
  email = `u${Math.random().toString(36).slice(2, 8)}@test.dev`,
  extra: Record<string, unknown> = {},
) {
  return h.prisma.user.create({ data: { email, name: 'Test User', ...extra } });
}

export async function planBySlug(h: Harness, slug: string) {
  return h.prisma.plan.findUniqueOrThrow({
    where: { slug },
    include: { currentVersion: true },
  });
}

/** Full happy-path purchase through checkout + browser verification. */
export async function buyPlan(h: Harness, userId: string, slug: string) {
  const plan = await planBySlug(h, slug);
  const started = await h.checkout.start(userId, {
    kind: 'plan',
    planId: plan.id,
  });
  const paid = h.provider.pay(started.providerOrderId!);
  const result = await h.checkout.verify(userId, {
    paymentId: started.paymentId,
    providerOrderId: started.providerOrderId!,
    providerPaymentId: paid.providerPaymentId,
    signature: paid.signature,
  });
  return { plan, started, paid, result };
}
