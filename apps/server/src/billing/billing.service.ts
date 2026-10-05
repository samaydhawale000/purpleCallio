import {
  BadRequestException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PAYMENT_SERVICE } from '../payment/payment.service';
import type { PaymentService } from '../payment/payment.service';

/** Loose E.164 check (+ up to 15 digits) — what Razorpay requires for a contact number. */
export const PHONE_RE = /^\+[1-9]\d{7,14}$/;

/**
 * PurpleCallio billing = usage-based (see UsageBillingService,
 * RatingEngineService, UsageSegmentService — that is the active model
 * calls are actually metered and charged against, enforced via
 * UsageBillingService.canStartCall).
 *
 * `Subscription` here is not a per-plan subscription anymore — there is no
 * more Plan model. It's the billing-cycle-anchor + dunning-state record for
 * a customer: currentPeriodStart/End + billingAnchorDay (see
 * billing-cycle.util.ts) drive the monthly cycle, and status/
 * gracePeriodEndsAt/dunningAttempts/paymentFailedAt drive the dunning flow in
 * InvoiceBillingService + BillingJobsService.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_SERVICE) private payments: PaymentService,
    private notifications: NotificationService,
  ) {}

  // ── Subscriptions (billing-cycle anchor) ────────────
  async getCurrentSubscription(userId: string) {
    return this.prisma.subscription.findFirst({
      where: { companyId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrCreateFreeSubscription(userId: string) {
    const existing = await this.getCurrentSubscription(userId);
    if (existing) return existing;

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const sub = await this.prisma.subscription.create({
      data: {
        companyId: userId,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        billingAnchorDay: now.getDate(),
      },
    });

    await this.ensureUsageRecord(userId, sub.id, now, periodEnd);
    return sub;
  }

  async getInvoices(userId: string) {
    const sub = await this.getCurrentSubscription(userId);
    if (!sub) return [];
    return this.prisma.invoices.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The card stored on the User record (razorpayTokenId + card fields) is
   * always the one actually charged at month end — it's the source of truth
   * for "default", independent of how many tokens Razorpay has on file for
   * the customer. Merge it into the provider's list (or fall back to it
   * entirely in mock mode, where there is no provider list to fetch).
   */
  async getPaymentMethods(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    let methods: Awaited<ReturnType<PaymentService['getPaymentMethods']>> = [];
    if (user?.razorpayCustomerId && this.payments.isConfigured()) {
      methods = await this.payments.getPaymentMethods(user.razorpayCustomerId);
    }

    if (user?.razorpayTokenId && !methods.some((m) => m.id === user.razorpayTokenId)) {
      methods = [
        {
          id: user.razorpayTokenId,
          brand: user.cardBrand ?? null,
          last4: user.cardLast4 ?? null,
          expMonth: user.cardExpMonth ?? null,
          expYear: user.cardExpYear ?? null,
        },
        ...methods,
      ];
    }

    return methods.map((m) => ({
      ...m,
      brand: m.brand ?? (m.id === user?.razorpayTokenId ? user.cardBrand : null),
      last4: m.last4 ?? (m.id === user?.razorpayTokenId ? user.cardLast4 : null),
      expMonth: m.expMonth ?? (m.id === user?.razorpayTokenId ? user.cardExpMonth : null),
      expYear: m.expYear ?? (m.id === user?.razorpayTokenId ? user.cardExpYear : null),
      default: m.id === user?.razorpayTokenId,
    }));
  }

  /**
   * Remove a saved card. If it was the active auto-charge card, promote
   * another remaining card to default automatically (mirrors how most SaaS
   * billing UIs behave) rather than silently pausing auto-billing.
   */
  async removePaymentMethod(userId: string, tokenId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.razorpayCustomerId && this.payments.isConfigured()) {
      try {
        await this.payments.deletePaymentMethod(user.razorpayCustomerId, tokenId);
      } catch (e: any) {
        this.logger.warn(`Failed to delete Razorpay token ${tokenId}: ${e?.message}`);
      }
    }

    if (user.razorpayTokenId === tokenId) {
      const remaining = user.razorpayCustomerId && this.payments.isConfigured()
        ? (await this.payments.getPaymentMethods(user.razorpayCustomerId)).filter((m) => m.id !== tokenId)
        : [];
      const promoted = remaining[0] ?? null;

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          razorpayTokenId: promoted?.id ?? null,
          cardBrand: promoted?.brand ?? null,
          cardLast4: promoted?.last4 ?? null,
          cardExpMonth: promoted?.expMonth ?? null,
          cardExpYear: promoted?.expYear ?? null,
        },
      });
    }

    await this.logAudit(userId, 'PAYMENT_METHOD_REMOVED', { tokenId });
    return { removed: true };
  }

  /** Switch which saved card is charged automatically at month end. */
  async setDefaultPaymentMethod(userId: string, tokenId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let card: {
      brand?: string | null;
      last4?: string | null;
      expMonth?: number | null;
      expYear?: number | null;
    } | null = null;

    if (user.razorpayCustomerId && this.payments.isConfigured()) {
      card = await this.payments.getPaymentMethod(user.razorpayCustomerId, tokenId);
      if (!card) throw new NotFoundException('Payment method not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        razorpayTokenId: tokenId,
        cardBrand: card?.brand ?? user.cardBrand,
        cardLast4: card?.last4 ?? user.cardLast4,
        cardExpMonth: card?.expMonth ?? user.cardExpMonth,
        cardExpYear: card?.expYear ?? user.cardExpYear,
      },
    });

    await this.logAudit(userId, 'PAYMENT_METHOD_UPDATED', { tokenId, event: 'default_changed' });
    return { success: true };
  }

  // ── Add Payment Method (usage-based, no charge) ────
  /**
   * Ensure a Razorpay customer exists for the user, creating one if needed,
   * and persist the customer id on the user.
   */
  async ensureRazorpayCustomer(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.razorpayCustomerId) return user.razorpayCustomerId;

    // Payment provider not configured (local/dev/demo) — use a synthetic
    // customer id so the rest of the flow (card save, auto-charge bookkeeping)
    // still works without calling out to Razorpay.
    const customerId = this.payments.isConfigured()
      ? await this.payments.createCustomer({
          email: user.email || '',
          name: user.name,
          contact: user.phone,
          userId,
        })
      : `cus_mock_${userId}`;

    await this.prisma.user.update({
      where: { id: userId },
      data: { razorpayCustomerId: customerId },
    });

    return customerId;
  }

  /**
   * Create a ₹1 Razorpay card-mandate authorisation order so the frontend
   * can open the Checkout modal with recurring = true. Returns the order id.
   *
   * The contact phone number Razorpay requires to authorise a recurring
   * mandate is collected once at login (see AuthService.updateProfile) and kept
   * in sync on the Razorpay customer — not re-collected here.
   */
  async createPaymentSetup(userId: string) {
    const customerId = await this.ensureRazorpayCustomer(userId);

    if (this.payments.isConfigured()) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true },
      });
      if (!user?.phone) {
        throw new BadRequestException(
          'Add a contact phone number to your account before saving a card.',
        );
      }
      await this.payments.updateCustomerContact(customerId, user.phone);
    }

    const setup = await this.payments.createSetupIntent(customerId);
    return { clientSecret: setup.clientSecret, customerId };
  }

  /**
   * Sets the user's contact phone number (required by Razorpay to authorise
   * a recurring card mandate) and, if a Razorpay customer already exists,
   * syncs it there immediately — covers customers created before this field
   * existed, which Razorpay would otherwise reject with "The contact field
   * is required for recurring links".
   */
  async setContactPhone(userId: string, phone: string) {
    const trimmed = phone?.trim();
    if (!trimmed || !PHONE_RE.test(trimmed)) {
      throw new BadRequestException(
        'Enter a valid phone number with country code, e.g. +919876543210.',
      );
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: trimmed },
    });

    if (user.razorpayCustomerId && this.payments.isConfigured()) {
      await this.payments.updateCustomerContact(user.razorpayCustomerId, trimmed);
    }

    return { phone: trimmed };
  }

  /**
   * Persist the saved-card token + card metadata for future auto-charges.
   *
   * When Razorpay is configured, the token is never taken from the client —
   * a `razorpay_payment_id` is not a card token. Instead we verify the
   * Checkout payment signature server-side, then ask Razorpay for the real
   * token it created for this customer (see resolveSavedCardToken). Only in
   * mock/dev mode (no Razorpay credentials) do we fall back to trusting the
   * client-simulated token, since there is no real gateway to verify against.
   */
  async attachPaymentMethod(
    userId: string,
    paymentMethodId: string,
    payment?: {
      tokenId?: string | null;
      orderId?: string | null;
      paymentId?: string | null;
      signature?: string | null;
    } | null,
    fallbackCard?: {
      brand?: string | null;
      last4?: string | null;
      expMonth?: number | null;
      expYear?: number | null;
    } | null,
  ) {
    const customerId = await this.ensureRazorpayCustomer(userId);

    let tokenId: string | null | undefined;
    let card = fallbackCard;

    if (this.payments.isConfigured()) {
      if (!payment?.orderId || !payment?.paymentId || !payment?.signature) {
        throw new BadRequestException(
          'Missing Razorpay payment verification details.',
        );
      }
      const { verified } = await this.payments.verifyCardSetupPayment({
        orderId: payment.orderId,
        paymentId: payment.paymentId,
        signature: payment.signature,
      });
      if (!verified) {
        throw new BadRequestException(
          'Could not verify the Razorpay payment signature.',
        );
      }
      const resolved = await this.payments.resolveSavedCardToken(
        customerId,
        payment.paymentId,
      );
      tokenId = resolved.id;
      card = {
        brand: resolved.brand,
        last4: resolved.last4,
        expMonth: resolved.expMonth,
        expYear: resolved.expYear,
      };
    } else {
      // Mock/dev mode: no real gateway to verify against — trust the
      // client-simulated token so local dev/demo still works end to end.
      tokenId = payment?.tokenId;
    }

    await this.payments.attachPaymentMethod({
      customerId,
      paymentMethodId,
      tokenId,
      card,
      setDefault: true,
    });

    // Persist the token + card metadata for server-side auto-charge.
    if (tokenId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          razorpayTokenId: tokenId,
          cardBrand: card?.brand ?? null,
          cardLast4: card?.last4 ?? null,
          cardExpMonth: card?.expMonth ?? null,
          cardExpYear: card?.expYear ?? null,
        },
      });
    }

    await this.logAudit(userId, 'PAYMENT_RECEIVED', {
      event: 'payment_method_attached',
      paymentMethodId,
      tokenId,
    });
    return { attached: true, customerId };
  }

  async createPortalSession(userId: string) {
    if (!this.payments.isConfigured()) {
      return { url: '/dashboard/billing', mock: true };
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.razorpayCustomerId) {
      throw new NotFoundException('No Razorpay customer found');
    }
    const url = await this.payments.createPortalSession(user.razorpayCustomerId);
    return { url };
  }

  async ensureUsageRecord(userId: string, subId: string, start: Date, end: Date) {
    const existing = await this.prisma.usage.findUnique({
      where: {
        companyId_billingCycleStart: {
          companyId: userId,
          billingCycleStart: start,
        },
      },
    });
    if (existing) return existing;
    return this.prisma.usage.create({
      data: {
        companyId: userId,
        subscriptionId: subId,
        billingCycleStart: start,
        billingCycleEnd: end,
        minutesUsed: 0,
        callsCreated: 0,
        callsCompleted: 0,
      },
    });
  }

  /**
   * Credit purchased (top-up) minutes to the current usage record. Only
   * called today from handlePaymentCaptured's topUpMinutes branch (defensive
   * — kept in case any in-flight/external Razorpay order still carries a
   * `notes.minutes` value; there is no live way to create one anymore).
   */
  private async creditPurchasedMinutes(userId: string, sub: any, minutes: number) {
    const start = sub.currentPeriodStart || new Date();
    await this.prisma.usage.upsert({
      where: {
        companyId_billingCycleStart: { companyId: userId, billingCycleStart: start },
      },
      create: {
        companyId: userId,
        subscriptionId: sub.id,
        billingCycleStart: start,
        billingCycleEnd: sub.currentPeriodEnd || new Date(),
        minutesUsed: 0,
        minutesPurchased: minutes,
        callsCreated: 0,
        callsCompleted: 0,
        participants: 0,
        apiRequests: 0,
      },
      update: {
        minutesPurchased: { increment: minutes },
      },
    });
  }

  // ── Admin: revenue ───────────────────────────────────
  /**
   * Usage-based revenue: real charges only come through paid UsageInvoice
   * rows (InvoiceBillingService.chargeInvoice never writes to Payment — that
   * table is legacy). "MRR"/"ARR" have no fixed recurring price to project
   * from anymore, so they're approximated as trailing-30-day realized (paid)
   * revenue, annualized.
   */
  async getRevenue() {
    const [paidInvoices, activeSubscriptions, payingCustomersAgg, trailing30] = await Promise.all([
      this.prisma.usageInvoice.findMany({
        where: { status: 'paid' },
        orderBy: { paidAt: 'desc' },
        take: 100,
      }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.usageInvoice.groupBy({ by: ['userId'], where: { status: 'paid' } }),
      this.prisma.usageInvoice.aggregate({
        where: { status: 'paid', paidAt: { gte: new Date(Date.now() - 30 * 86400000) } },
        _sum: { totalPaise: true },
      }),
    ]);

    const total = paidInvoices.reduce((s, i) => s + i.totalPaise, 0);
    const mrr = trailing30._sum.totalPaise ?? 0;
    const arr = mrr * 12;

    return {
      total,
      count: paidInvoices.length,
      mrr,
      arr,
      payingCustomers: payingCustomersAgg.length,
      activeSubscriptions,
      invoices: paidInvoices,
    };
  }

  // ── Webhook (Razorpay) ──────────────────────────────
  // NOTE: this previously assumed Stripe's webhook shape (`event.type`,
  // `event.data.object`, invoice/session field names) even though it's only
  // ever called from the Razorpay webhook endpoint — meaning no real
  // Razorpay webhook (payment success/failure) was ever actually processed
  // via that mismatched shape; the switch never matched. Razorpay's shape is
  // `event.event` (event name) + `event.payload.<entity>.entity`.
  async handleWebhookEvent(event: Record<string, any>) {
    const type = event.event;
    this.logger.log(`Handling Razorpay webhook: ${type}`);
    switch (type) {
      case 'payment.captured':
        await this.handlePaymentCaptured(event.payload?.payment?.entity);
        break;
      case 'payment.failed':
        await this.handlePaymentFailedEvent(event.payload?.payment?.entity);
        break;
      default:
        this.logger.debug(`Unhandled Razorpay webhook event: ${type}`);
        break;
    }
  }

  /**
   * A captured (successful) payment — covers minute top-ups via a Razorpay
   * Order carrying `notes` (userId + minutes) that Razorpay copies onto the
   * resulting payment entity.
   *
   * Idempotent: Razorpay retries webhook delivery, so this must never credit
   * the same payment twice. Guarded by an existence check + a DB unique
   * constraint on Payment.razorpayPaymentId as the hard backstop.
   */
  private async handlePaymentCaptured(payment: any) {
    if (!payment?.id) return;

    const already = await this.prisma.payment.findFirst({
      where: { razorpayPaymentId: payment.id },
    });
    if (already) {
      this.logger.warn(`Payment ${payment.id} already recorded — skipping duplicate webhook.`);
      return;
    }

    const userId = payment.notes?.userId;
    if (!userId) {
      this.logger.warn(`payment.captured for ${payment.id} has no userId in notes — skipping.`);
      return;
    }

    const sub = await this.getOrCreateFreeSubscription(userId);

    try {
      await this.prisma.payment.create({
        data: {
          subscriptionId: sub.id,
          razorpayPaymentId: payment.id,
          razorpayOrderId: payment.order_id ?? null,
          amount: payment.amount ?? 0,
          currency: (payment.currency || 'INR').toUpperCase(),
          paymentStatus: 'PAID',
          paymentMethod: payment.method ?? null,
          paidAt: new Date(),
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        this.logger.warn(`Payment ${payment.id} already recorded (race) — skipping duplicate credit.`);
        return;
      }
      throw e;
    }

    const topUpMinutes = Number(payment.notes?.minutes || 0);
    if (topUpMinutes > 0) {
      await this.creditPurchasedMinutes(userId, sub, topUpMinutes);
      await this.logAudit(userId, 'PAYMENT_RECEIVED', {
        minutes: topUpMinutes,
        type: 'topup',
        razorpayPaymentId: payment.id,
      });
    } else {
      await this.logAudit(userId, 'PAYMENT_RECEIVED', { amount: payment.amount, razorpayPaymentId: payment.id });
    }
    await this.notifyPaymentOutcome(userId, payment, true);
  }

  /**
   * Webhook payment notification. An invoice auto-charge carries its
   * invoiceId in the Razorpay notes, so it shares InvoiceBillingService's
   * per-invoice dedupe key — the customer hears about that payment once,
   * whichever path processes it first.
   */
  private async notifyPaymentOutcome(userId: string, payment: any, succeeded: boolean) {
    const invoiceId: string | undefined = payment.notes?.invoiceId;
    await this.notifications.createNotification({
      userId,
      type: succeeded
        ? NotificationType.INVOICE_PAYMENT_SUCCESS
        : NotificationType.INVOICE_PAYMENT_FAILED,
      title: succeeded ? 'Payment successful' : 'Payment failed',
      message: succeeded
        ? 'Your payment was successfully processed.'
        : "We couldn't process your latest payment. Please check your billing information.",
      metadata: invoiceId ? { invoiceId } : undefined,
      dedupeKey: invoiceId
        ? `${succeeded ? 'invoice-paid' : 'invoice-payment-failed'}:${invoiceId}`
        : `payment-${succeeded ? 'success' : 'failed'}:${payment.id}`,
    });
  }

  private async handlePaymentFailedEvent(payment: any) {
    if (!payment?.id) return;

    const userId = payment.notes?.userId;
    if (!userId) {
      this.logger.warn(`payment.failed for ${payment.id} has no userId in notes — skipping.`);
      return;
    }

    const already = await this.prisma.payment.findFirst({
      where: { razorpayPaymentId: payment.id },
    });
    if (already) return;

    const sub = await this.getOrCreateFreeSubscription(userId);

    try {
      await this.prisma.payment.create({
        data: {
          subscriptionId: sub.id,
          razorpayPaymentId: payment.id,
          razorpayOrderId: payment.order_id ?? null,
          amount: payment.amount ?? 0,
          currency: (payment.currency || 'INR').toUpperCase(),
          paymentStatus: 'FAILED',
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return;
      throw e;
    }

    // Increment dunning attempt and extend grace period (7 days from now).
    const grace = new Date();
    grace.setDate(grace.getDate() + 7);
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'PAST_DUE',
        dunningAttempts: { increment: 1 },
        paymentFailedAt: new Date(),
        gracePeriodEndsAt: grace,
      },
    });
    await this.logAudit(sub.companyId, 'PAYMENT_FAILED', {
      amount: payment.amount,
      razorpayPaymentId: payment.id,
    });
    await this.notifyPaymentOutcome(sub.companyId, payment, false);
  }

  private async logAudit(actorId: any, action: any, metadata: any) {
    try {
      await this.prisma.auditLog.create({
        data: { actorId: actorId || null, action, metadata },
      });
    } catch {
      // Non-fatal
    }
  }
}
