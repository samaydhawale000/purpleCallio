import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BillingStatus, PaymentStatus, PlanType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_SERVICE } from '../payment/payment.service';
import type { PaymentService } from '../payment/payment.service';

/** Loose E.164 check (+ up to 15 digits) — what Razorpay requires for a contact number. */
export const PHONE_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Account-level billing helpers that sit outside the prepaid purchase flow:
 *  - payment methods: cards saved under the retired pay-as-you-go model can
 *    be listed and removed. They are never charged automatically — payment
 *    for plans and top-ups is always chosen by the customer at checkout;
 *  - the contact phone kept in sync on the Razorpay customer;
 *  - admin revenue reporting.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_SERVICE) private payments: PaymentService,
  ) {}

  /** LEGACY invoice rows from before usage invoices existed (read-only). */
  async getInvoices(userId: string) {
    return this.prisma.invoices.findMany({
      where: { subscription: { companyId: userId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Saved cards on the customer's Razorpay record (including the legacy
   * pay-as-you-go card stored on the user). Display + removal only.
   */
  async getPaymentMethods(userId: string) {
    const found = await this.prisma.user.findUnique({ where: { id: userId } });
    const user = found ? await this.clearStaleRazorpayCustomer(found) : found;

    let methods: Awaited<ReturnType<PaymentService['getPaymentMethods']>> = [];
    if (user?.razorpayCustomerId && this.payments.isConfigured()) {
      methods = await this.payments.getPaymentMethods(user.razorpayCustomerId);
    }
    if (
      user?.razorpayTokenId &&
      !methods.some((m) => m.id === user.razorpayTokenId)
    ) {
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
      brand:
        m.brand ?? (m.id === user?.razorpayTokenId ? user.cardBrand : null),
      last4:
        m.last4 ?? (m.id === user?.razorpayTokenId ? user.cardLast4 : null),
      expMonth:
        m.expMonth ??
        (m.id === user?.razorpayTokenId ? user.cardExpMonth : null),
      expYear:
        m.expYear ?? (m.id === user?.razorpayTokenId ? user.cardExpYear : null),
      legacy: m.id === user?.razorpayTokenId,
    }));
  }

  /** Remove a saved card from Razorpay (and the legacy reference to it). */
  async removePaymentMethod(userId: string, tokenId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.razorpayCustomerId && this.payments.isConfigured()) {
      try {
        await this.payments.deletePaymentMethod(
          user.razorpayCustomerId,
          tokenId,
        );
      } catch (e: any) {
        this.logger.warn(
          `Failed to delete Razorpay token ${tokenId}: ${e?.message}`,
        );
      }
    }
    if (user.razorpayTokenId === tokenId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          razorpayTokenId: null,
          cardBrand: null,
          cardLast4: null,
          cardExpMonth: null,
          cardExpYear: null,
        },
      });
    }
    await this.logAudit(userId, 'PAYMENT_METHOD_REMOVED', { tokenId });
    return { removed: true };
  }

  /**
   * A stored customer id can belong to a different Razorpay account or mode
   * than the current keys (e.g. test-mode customers after switching to
   * live, or `cus_mock_` ids from a run without credentials). Drop it — and
   * the card token saved against it — so stale ids never reach Razorpay.
   */
  private async clearStaleRazorpayCustomer<
    T extends { id: string; razorpayCustomerId: string | null },
  >(user: T): Promise<T> {
    const customerId = user.razorpayCustomerId;
    if (!customerId || !this.payments.isConfigured()) return user;

    const stale =
      customerId.startsWith('cus_mock_') ||
      !(await this.payments.customerExists(customerId));
    if (!stale) return user;

    this.logger.warn(
      `Razorpay customer ${customerId} for user ${user.id} doesn't exist on the current account — clearing it and its saved card.`,
    );
    const cleared = {
      razorpayCustomerId: null,
      razorpayTokenId: null,
      cardBrand: null,
      cardLast4: null,
      cardExpMonth: null,
      cardExpYear: null,
    };
    await this.prisma.user.update({ where: { id: user.id }, data: cleared });
    return { ...user, ...cleared };
  }

  /**
   * Sets the user's contact phone number (prefilled in Checkout) and syncs
   * it to the Razorpay customer if one exists.
   */
  async setContactPhone(userId: string, phone: string) {
    const trimmed = phone?.trim();
    if (!trimmed || !PHONE_RE.test(trimmed)) {
      throw new BadRequestException(
        'Enter a valid phone number with country code, e.g. +919876543210.',
      );
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: trimmed },
    });
    const user = await this.clearStaleRazorpayCustomer(updated);
    if (user.razorpayCustomerId && this.payments.isConfigured()) {
      await this.payments.updateCustomerContact(
        user.razorpayCustomerId,
        trimmed,
      );
    }
    return { phone: trimmed };
  }

  // ── Admin: revenue ───────────────────────────────────
  /**
   * Prepaid revenue = verified payments (plans, renewals, top-ups, custom
   * plans) net of refunds, plus historical paid usage invoices. MRR is the
   * monthly-normalized price of currently active paid subscriptions.
   */
  async getRevenue() {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [paid, refunds, last30, legacyPaid, activePaid, recent] =
      await Promise.all([
        this.prisma.payment.aggregate({
          where: {
            purpose: { not: 'LEGACY' },
            paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.REFUNDED] },
          },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.payment.aggregate({
          where: { purpose: { not: 'LEGACY' } },
          _sum: { refundedPaise: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            purpose: { not: 'LEGACY' },
            paymentStatus: PaymentStatus.PAID,
            paidAt: { gte: since30 },
          },
          _sum: { amount: true },
        }),
        this.prisma.usageInvoice.aggregate({
          where: { status: 'paid' },
          _sum: { totalPaise: true },
          _count: true,
        }),
        this.prisma.subscription.findMany({
          where: {
            status: BillingStatus.ACTIVE,
            planType: { in: [PlanType.PAID, PlanType.CUSTOM] },
          },
          select: {
            pricePaise: true,
            billingInterval: true,
            intervalCount: true,
            companyId: true,
          },
        }),
        this.prisma.payment.findMany({
          where: {
            purpose: { not: 'LEGACY' },
            paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.REFUNDED] },
          },
          orderBy: { paidAt: 'desc' },
          take: 20,
          include: { user: { select: { id: true, email: true, name: true } } },
        }),
      ]);

    const monthly = (s: {
      pricePaise: number;
      billingInterval: string | null;
      intervalCount: number;
    }) =>
      s.billingInterval === 'YEAR'
        ? s.pricePaise / (12 * s.intervalCount)
        : s.billingInterval === 'CUSTOM'
          ? (s.pricePaise * 30) / Math.max(1, s.intervalCount)
          : s.pricePaise / Math.max(1, s.intervalCount);
    const mrr = Math.round(activePaid.reduce((sum, s) => sum + monthly(s), 0));
    const prepaidNet =
      (paid._sum.amount ?? 0) - (refunds._sum.refundedPaise ?? 0);

    return {
      totalPaise: prepaidNet + (legacyPaid._sum.totalPaise ?? 0),
      prepaidNetPaise: prepaidNet,
      refundedPaise: refunds._sum.refundedPaise ?? 0,
      last30DaysPaise: last30._sum.amount ?? 0,
      legacyUsageInvoicePaise: legacyPaid._sum.totalPaise ?? 0,
      payments: paid._count,
      mrrPaise: mrr,
      arrPaise: mrr * 12,
      activePaidSubscriptions: activePaid.length,
      payingCustomers: new Set(activePaid.map((s) => s.companyId)).size,
      recentPayments: recent,
    };
  }

  private async logAudit(actorId: string | null, action: any, metadata: any) {
    try {
      await this.prisma.auditLog.create({
        data: { actorId: actorId || null, action, metadata },
      });
    } catch {
      // Non-fatal
    }
  }
}
