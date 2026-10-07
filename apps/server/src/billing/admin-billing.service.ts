import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentPurpose, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreditService } from './credits/credit.service';
import { SubscriptionService } from './subscriptions/subscription.service';
import { receiptLabel } from './invoice-pdf.service';

/** Read models for Admin → Billing (payments, per-customer billing view). */
@Injectable()
export class AdminBillingService {
  constructor(
    private prisma: PrismaService,
    private credits: CreditService,
    private subscriptions: SubscriptionService,
  ) {}

  async listPayments(params: {
    page?: string;
    status?: string;
    purpose?: string;
    search?: string;
    userId?: string;
  }) {
    const page = Math.max(1, parseInt(params.page ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where: Prisma.PaymentWhereInput = {};
    if (
      params.status &&
      (Object.values(PaymentStatus) as string[]).includes(params.status)
    ) {
      where.paymentStatus = params.status as PaymentStatus;
    }
    if (
      params.purpose &&
      (Object.values(PaymentPurpose) as string[]).includes(params.purpose)
    ) {
      where.purpose = params.purpose as PaymentPurpose;
    }
    if (params.userId) where.userId = params.userId;
    const search = params.search?.trim();
    if (search) {
      const receipt = /^(?:pcr-?)?0*(\d{1,9})$/i.exec(search);
      where.OR = [
        { providerPaymentId: search },
        { providerOrderId: search },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        ...(receipt ? [{ receiptNumber: Number(receipt[1]) }] : []),
      ];
    }
    const [total, data] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: { id: true, email: true, name: true, companyName: true },
          },
          attempts: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
      }),
    ]);
    return {
      data: data.map((p) => ({
        ...p,
        receipt: p.receiptNumber ? receiptLabel(p.receiptNumber, p.id) : null,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Everything billing-related about one customer. */
  async getCustomerBilling(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        companyName: true,
        razorpayTokenId: true,
        spendingLimitPaise: true,
      },
    });
    if (!user) throw new NotFoundException('Customer not found');
    const overview = await this.subscriptions.getOverview(userId);
    const [wallet, history, payments, legacyInvoices] = await Promise.all([
      this.credits.getSummary(userId, overview.subscription.currentPeriodStart),
      this.credits.getHistory(userId, {}),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.usageInvoice.count({ where: { userId } }),
    ]);
    return {
      customer: {
        id: user.id,
        email: user.email,
        name: user.name,
        companyName: user.companyName,
      },
      ...overview,
      wallet,
      creditHistory: history,
      payments,
      legacy: {
        hasSavedCard: !!user.razorpayTokenId,
        spendingLimitPaise: user.spendingLimitPaise,
        usageInvoices: legacyInvoices,
      },
    };
  }

  async getMigrationSummary() {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key: 'billing.prepaidMigration' },
    });
    return row?.value ?? null;
  }
}
