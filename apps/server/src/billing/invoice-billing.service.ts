import { Injectable, Logger, Inject } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_SERVICE } from '../payment/payment.service';
import type { PaymentService } from '../payment/payment.service';
import { UsageBillingService, BillingRates } from './usage-billing.service';
import { CustomerDiscountService } from './customer-discount.service';
import { calculateInvoiceAmounts } from './discount.util';
import { NotificationService } from '../notification/notification.service';

/** Fixed dunning retry schedule: days after dunningStartedAt to retry. */
const DUNNING_RETRY_SCHEDULE_DAYS = [1, 3, 7];

/**
 * Recurring usage invoice generation + auto-charge (usage-based billing v2).
 *
 * Flow:
 *  1. Generate a line-item invoice from a closed cycle's CallUsage rows
 *     (per media type: audio / video / screen-share → minutes + ₹), folding
 *     in any pending proration adjustments from a mid-cycle plan change.
 *  2. Apply tax (GST from BillingRate.taxPercent).
 *  3. Auto-charge the customer's saved card via a PaymentIntent.
 *  4. On success → invoice marked PAID (and any dunning state cleared). On
 *     failure → mark dunning, set a grace period, retry on a fixed
 *     day-1/3/7 schedule. Active calls are never interrupted.
 */
@Injectable()
export class InvoiceBillingService {
  private readonly logger = new Logger(InvoiceBillingService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_SERVICE) private payments: PaymentService,
    private usageBilling: UsageBillingService,
    private customerDiscounts: CustomerDiscountService,
    private notifications: NotificationService,
  ) {}

  /**
   * Billable minutes + per-media-type paise for a usage snapshot at the
   * given rates (free allowance already applied; screen-share always
   * billable). Shared by generateInvoiceForCycle (closed cycle) and
   * previewCurrentCycle (still-open cycle) so the two can never diverge.
   */
  private billableAmounts(
    usage: { audioMinutes: number; videoMinutes: number; screenShareMinutes: number } | null,
    rates: BillingRates,
  ) {
    const billableAudio = Math.max(0, (usage?.audioMinutes ?? 0) - rates.freeAudioMins);
    const billableVideo = Math.max(0, (usage?.videoMinutes ?? 0) - rates.freeVideoMins);
    const billableScreenShare = usage?.screenShareMinutes ?? 0;

    const audioPaise = billableAudio * rates.audioPaise;
    const videoPaise = billableVideo * rates.videoPaise;
    const screenSharePaise = billableScreenShare * rates.screenSharePaise;

    return {
      billableAudio,
      billableVideo,
      billableScreenShare,
      audioPaise,
      videoPaise,
      screenSharePaise,
      subtotalPaise: audioPaise + videoPaise + screenSharePaise,
    };
  }

  /**
   * Generate (or return existing) the invoice for a given cycle for a user.
   * The cycle is identified by its start date (the subscription's anchored
   * currentPeriodStart at the time it closed, NOT necessarily the 1st).
   */
  async generateInvoiceForCycle(userId: string, cycleStart: Date) {
    const existing = await this.prisma.usageInvoice.findUnique({
      where: {
        userId_cycleStart: { userId, cycleStart },
      },
      include: { lineItems: true },
    });
    if (existing) return existing;

    const usage = await this.prisma.usage.findUnique({
      where: {
        companyId_billingCycleStart: {
          companyId: userId,
          billingCycleStart: cycleStart,
        },
      },
    });

    const rates = await this.usageBilling.getRates();

    // Billable minutes = usage beyond free allowance (screen-share always paid).
    const {
      billableAudio,
      billableVideo,
      billableScreenShare,
      audioPaise,
      videoPaise,
      screenSharePaise,
      subtotalPaise,
    } = this.billableAmounts(usage, rates);

    // Resolve the discount active FOR THIS CUSTOMER AS OF THIS CYCLE'S START
    // — not "now". This is what makes recurring billing automatic (the same
    // active discount is picked up every cycle with no admin action) while
    // also keeping past invoices immutable (a discount changed after this
    // cycle closed can never retroactively affect it, since a closed cycle's
    // generateInvoiceForCycle call always passes that cycle's own
    // cycleStart).
    const discount = await this.customerDiscounts.getActiveDiscount(userId, cycleStart);
    const amounts = calculateInvoiceAmounts({
      subtotalPaise,
      discountPercent: discount?.percentage ?? null,
      taxPercent: rates.taxPercent,
    });
    const { discountPercent, discountPaise, taxPaise } = amounts;

    // Anchored cycle end comes from the Usage row itself (the true end of
    // this subscription's anchored cycle) — falling back to a calendar-month
    // estimate only if no Usage row exists yet (e.g. a zero-usage cycle).
    const cycleEnd = usage?.billingCycleEnd ?? (() => {
      const fallback = new Date(cycleStart);
      fallback.setMonth(fallback.getMonth() + 1);
      fallback.setDate(0);
      return fallback;
    })();

    const pendingAdjustments = await this.prisma.prorationAdjustment.findMany({
      where: { userId, consumedAt: null },
    });
    const adjustmentPaise = pendingAdjustments.reduce((s, a) => s + a.amountPaise, 0);
    // amounts.totalPaise is taxableAmountPaise (post-discount) + taxPaise;
    // proration adjustments fold in on top exactly as before discounts
    // existed — discounts only ever apply to the usage subtotal.
    const totalPaise = amounts.totalPaise + adjustmentPaise;

    const invoiceNumber = await this.nextInvoiceNumber(cycleStart);

    const callUsage = await this.prisma.callUsage.findMany({
      where: { usageId: usage?.id ?? '' },
    });

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.usageInvoice.create({
        data: {
          userId,
          cycleStart,
          cycleEnd,
          invoiceNumber,
          audioMinutes: billableAudio,
          videoMinutes: billableVideo,
          screenShareMinutes: billableScreenShare,
          audioPaise,
          videoPaise,
          screenSharePaise,
          subtotalPaise,
          discountPercent,
          discountPaise,
          discountReason: discount?.reason ?? null,
          taxPaise,
          totalPaise,
          currency: 'INR',
          status: 'open',
        },
      });

      if (callUsage.length) {
        await tx.usageInvoiceLineItem.createMany({
          data: callUsage.map((cu) => ({
            invoiceId: created.id,
            callId: cu.callId,
            mediaType: cu.audioMinutes
              ? 'audio'
              : cu.videoMinutes
                ? 'video'
                : 'screen_share',
            minutes:
              cu.audioMinutes + cu.videoMinutes + cu.screenShareMinutes,
            participants: cu.participants,
            amountPaise: cu.costPaise,
          })),
        });
      }

      if (pendingAdjustments.length) {
        await tx.usageInvoiceLineItem.createMany({
          data: pendingAdjustments.map((a) => ({
            invoiceId: created.id,
            callId: null,
            mediaType: 'adjustment',
            minutes: 0,
            participants: 0,
            amountPaise: a.amountPaise,
          })),
        });
        await tx.prorationAdjustment.updateMany({
          where: { id: { in: pendingAdjustments.map((a) => a.id) } },
          data: { consumedAt: new Date(), consumedInvoiceId: created.id },
        });
      }

      return created;
    });

    this.logger.log(
      `Generated invoice ${invoice.invoiceNumber} for user ${userId}: ${totalPaise} paise`,
    );
    // A ₹0 invoice (usage fully inside the free allowance) needs no action.
    if (totalPaise > 0) {
      await this.notifications.createNotification({
        userId,
        type: NotificationType.INVOICE_GENERATED,
        title: 'Invoice generated',
        message: invoice.invoiceNumber
          ? `Your usage invoice ${invoice.invoiceNumber} is now available.`
          : 'Your usage invoice is now available.',
        metadata: { invoiceId: invoice.id },
        dedupeKey: `invoice-generated:${invoice.id}`,
      });
    }

    return this.prisma.usageInvoice.findUnique({
      where: { id: invoice.id },
      include: { lineItems: true },
    });
  }

  /**
   * Live, non-persisting preview of what the invoice for the customer's
   * CURRENT (still-open) cycle would look like right now — same math as
   * generateInvoiceForCycle (via the shared billableAmounts/
   * calculateInvoiceAmounts helpers), resolving the discount as of "now"
   * rather than a cycle-start date. Nothing is written to the database.
   * This is the single source of truth the frontend renders for "Usage
   * subtotal / Discount / Tax / Total" — it must never compute these
   * numbers itself (see task requirement: backend is authoritative).
   */
  async previewCurrentCycle(userId: string) {
    const usage = await this.usageBilling.getOrCreateUsage(userId);
    const rates = await this.usageBilling.getRates();
    const billable = this.billableAmounts(usage, rates);
    const discount = await this.customerDiscounts.getActiveDiscount(userId, new Date());
    const amounts = calculateInvoiceAmounts({
      subtotalPaise: billable.subtotalPaise,
      discountPercent: discount?.percentage ?? null,
      taxPercent: rates.taxPercent,
    });

    return {
      cycle: { start: usage.billingCycleStart, end: usage.billingCycleEnd },
      usage: {
        audioMinutes: billable.billableAudio,
        videoMinutes: billable.billableVideo,
        screenShareMinutes: billable.billableScreenShare,
      },
      breakdown: {
        audioPaise: billable.audioPaise,
        videoPaise: billable.videoPaise,
        screenSharePaise: billable.screenSharePaise,
      },
      ...amounts,
      discountReason: discount?.reason ?? null,
      currency: 'INR',
    };
  }

  /** `BJ-{year}-{sequence}`, sequential within the invoice's cycle year. */
  private async nextInvoiceNumber(cycleStart: Date): Promise<string> {
    const year = cycleStart.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const countThisYear = await this.prisma.usageInvoice.count({
      where: { cycleStart: { gte: yearStart, lt: yearEnd } },
    });
    return `BJ-${year}-${String(countThisYear + 1).padStart(6, '0')}`;
  }

  /**
   * Attempt to charge the user's saved card for an open invoice. If no
   * payment method is configured, mark the invoice as dunning and set a
   * grace period so new calls can be gated (active calls keep running).
   *
   * Guards against double-charge from overlapping cron runs by atomically
   * claiming open->processing before ever calling out to Razorpay.
   */
  async chargeInvoice(userId: string, invoiceId: string) {
    const invoice = await this.prisma.usageInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'paid') return invoice;

    const claimed = await this.prisma.usageInvoice.updateMany({
      where: { id: invoiceId, status: 'open' },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) {
      // Either already being charged by a concurrent run, or already in
      // dunning/failed — either way, not ours to charge right now.
      return this.prisma.usageInvoice.findUnique({ where: { id: invoiceId } });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.razorpayCustomerId || !user?.phone || !this.payments.isConfigured()) {
      // No payment method (or no contact number, which Razorpay requires to
      // auto-charge a recurring mandate): enter dunning + grace period.
      return this.enterDunning(invoiceId, userId);
    }

    try {
      const userToken = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { razorpayTokenId: true },
      });

      const intent = await this.payments.createPaymentIntent({
        customerId: user.razorpayCustomerId,
        amountPaise: invoice.totalPaise,
        currency: invoice.currency,
        tokenId: userToken?.razorpayTokenId,
        email: user.email,
        contact: user.phone,
        metadata: { invoiceId: invoice.id, userId },
      });

      if (intent.status === 'captured' || intent.status === 'authorized' || intent.status === 'succeeded') {
        const updated = await this.prisma.usageInvoice.update({
          where: { id: invoice.id },
          data: {
            status: 'paid',
            razorpayPaymentId: intent.id,
            paidAt: new Date(),
            nextRetryAt: null,
          },
        });
        // Clear any dunning state this invoice may have put the subscription
        // into (this may be a scheduled retry, not just the first attempt).
        await this.prisma.subscription.updateMany({
          where: { companyId: userId, status: 'PAST_DUE' },
          data: {
            status: 'ACTIVE',
            dunningAttempts: 0,
            paymentFailedAt: null,
            gracePeriodEndsAt: null,
          },
        });
        await this.prisma.auditLog.create({
          data: {
            actorId: userId,
            action: 'PAYMENT_RECEIVED',
            metadata: { invoiceId: invoice.id, amountPaise: invoice.totalPaise },
          },
        });
        this.logger.log(`Charged invoice ${invoice.id}: ${invoice.totalPaise} paise`);
        await this.notifications.createNotification({
          userId,
          type: NotificationType.INVOICE_PAYMENT_SUCCESS,
          title: 'Payment successful',
          message: 'Your invoice payment was successfully processed.',
          metadata: { invoiceId: invoice.id },
          dedupeKey: `invoice-paid:${invoice.id}`,
        });
        return updated;
      }

      // Payment not immediately succeeded → treat as dunning.
      await this.prisma.usageInvoice.update({
        where: { id: invoice.id },
        data: { razorpayOrderId: intent.id },
      });
      return this.enterDunning(invoice.id, userId);
    } catch (err) {
      this.logger.warn(`Payment failed for invoice ${invoice.id}: ${String(err)}`);
      return this.enterDunning(invoice.id, userId);
    }
  }

  /**
   * Mark an invoice as dunning and set a grace period (7 days) so the UI can
   * gate NEW calls while active calls continue uninterrupted. Schedules the
   * first retry per DUNNING_RETRY_SCHEDULE_DAYS.
   */
  private async enterDunning(invoiceId: string, userId: string) {
    const grace = new Date();
    grace.setDate(grace.getDate() + 7);
    const dunningStartedAt = new Date();
    const nextRetryAt = new Date(dunningStartedAt);
    nextRetryAt.setDate(nextRetryAt.getDate() + DUNNING_RETRY_SCHEDULE_DAYS[0]);

    const [invoice] = await Promise.all([
      this.prisma.usageInvoice.update({
        where: { id: invoiceId },
        data: { status: 'dunning', dueAt: grace, dunningStartedAt, nextRetryAt, retryCount: 0 },
      }),
      this.prisma.subscription.updateMany({
        where: { companyId: userId },
        data: {
          status: 'PAST_DUE',
          dunningAttempts: { increment: 1 },
          paymentFailedAt: new Date(),
          gracePeriodEndsAt: grace,
        },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'PAYMENT_FAILED',
        metadata: { invoiceId, gracePeriodEndsAt: grace },
      },
    });

    this.logger.log(`Invoice ${invoiceId} entered dunning (grace until ${grace.toISOString()})`);
    // Keyed per invoice: scheduled retries re-enter dunning, but the customer
    // (and admins) only need to hear about a failing invoice once.
    await this.notifications.createNotification({
      userId,
      type: NotificationType.INVOICE_PAYMENT_FAILED,
      title: 'Payment failed',
      message: "We couldn't process your latest payment. Please check your billing information.",
      metadata: { invoiceId },
      dedupeKey: `invoice-payment-failed:${invoiceId}`,
    });
    await this.notifications.notifyAdmins({
      type: NotificationType.INVOICE_PAYMENT_FAILED,
      title: 'Payment issue',
      message: `A customer payment failed for invoice ${invoice.invoiceNumber ?? invoiceId}.`,
      metadata: { invoiceId, customerId: userId },
      dedupeKey: `admin:invoice-payment-failed:${invoiceId}`,
    });
    return invoice;
  }

  /**
   * Retry a dunning invoice per the fixed day-1/3/7 schedule (offsets from
   * the original dunningStartedAt, not from "now", so retries land on
   * predictable calendar days regardless of when the cron actually runs).
   * On success, chargeInvoice already clears the subscription's dunning
   * state. On failure, advances to the next scheduled slot, or stops
   * scheduling further retries once exhausted (the grace-period/downgrade
   * job takes over from there).
   */
  async retryChargeInvoice(invoiceId: string) {
    const invoice = await this.prisma.usageInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.status !== 'dunning') return invoice;

    // chargeInvoice requires status='open' to claim — flip it back so this
    // retry can go through the same atomic claim as a first attempt.
    await this.prisma.usageInvoice.update({ where: { id: invoiceId }, data: { status: 'open' } });
    const result = await this.chargeInvoice(invoice.userId, invoiceId);

    if (result?.status === 'paid') return result;

    // Still failing — advance the retry counter/schedule.
    const dunningStartedAt = invoice.dunningStartedAt ?? invoice.createdAt;
    const nextIndex = invoice.retryCount + 1;
    const nextOffsetDays = DUNNING_RETRY_SCHEDULE_DAYS[nextIndex];

    if (nextOffsetDays == null) {
      // Retry schedule exhausted — leave in dunning for the grace-period/
      // downgrade job, no further automatic retries.
      return this.prisma.usageInvoice.update({
        where: { id: invoiceId },
        data: { status: 'dunning', nextRetryAt: null, retryCount: nextIndex },
      });
    }

    const nextRetryAt = new Date(dunningStartedAt);
    nextRetryAt.setDate(nextRetryAt.getDate() + nextOffsetDays);
    return this.prisma.usageInvoice.update({
      where: { id: invoiceId },
      data: { status: 'dunning', nextRetryAt, retryCount: nextIndex },
    });
  }

  /**
   * List a user's usage invoices (newest first).
   */
  async getInvoicesForUser(userId: string, pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(process.env.PAGE_SIZE) || 10));
    const where = { userId };
    const [total, data] = await Promise.all([
      this.prisma.usageInvoice.count({ where }),
      this.prisma.usageInvoice.findMany({
        where,
        orderBy: { cycleStart: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { lineItems: true },
      }),
    ]);
    return { data, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** A single invoice, scoped to its owner (throws if not found/owned). */
  async getInvoiceForUser(userId: string, invoiceId: string) {
    const invoice = await this.prisma.usageInvoice.findFirst({
      where: { id: invoiceId, userId },
      include: { lineItems: true },
    });
    if (!invoice) throw new Error('Invoice not found');
    return invoice;
  }

  /** A single invoice enriched with the user info needed to render a PDF. */
  async getInvoiceForPdf(userId: string, invoiceId: string) {
    const invoice = await this.getInvoiceForUser(userId, invoiceId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, cardBrand: true, cardLast4: true },
    });
    return { ...invoice, user: user! };
  }

  /**
   * Combined "billing history" view: paginates off UsageInvoice (the stable
   * one-row-per-closed-cycle anchor — unlike Usage, which also has a live
   * row for the still-open current cycle) and joins in the matching Usage
   * row per cycle.
   */
  async getCycleHistory(userId: string, pageValue?: string) {
    const invoices = await this.getInvoicesForUser(userId, pageValue);
    const cycleStarts = invoices.data.map((i) => i.cycleStart);
    const usages = cycleStarts.length
      ? await this.prisma.usage.findMany({
          where: { companyId: userId, billingCycleStart: { in: cycleStarts } },
        })
      : [];
    const usageByStart = new Map(usages.map((u) => [u.billingCycleStart.toISOString(), u]));
    return {
      ...invoices,
      data: invoices.data.map((invoice) => ({
        invoice,
        usage: usageByStart.get(invoice.cycleStart.toISOString()) ?? null,
      })),
    };
  }
}

export interface InvoiceBillingDeps {
  prisma: PrismaService;
  payments: PaymentService;
  usageBilling: UsageBillingService;
}
