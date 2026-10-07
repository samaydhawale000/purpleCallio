import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LEGACY pay-as-you-go usage invoices — read-only.
 *
 * The retired post-paid model generated a UsageInvoice at the end of each
 * cycle and auto-charged the saved card (with dunning retries). Prepaid
 * billing never creates these; this service only keeps historical
 * invoices viewable and downloadable.
 */
@Injectable()
export class InvoiceBillingService {
  constructor(private prisma: PrismaService) {}

  /** A user's legacy usage invoices (newest first). */
  async getInvoicesForUser(userId: string, pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
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
    return {
      data,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** A single invoice, scoped to its owner. */
  async getInvoiceForUser(userId: string, invoiceId: string) {
    const invoice = await this.prisma.usageInvoice.findFirst({
      where: { id: invoiceId, userId },
      include: { lineItems: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return { ...invoice, legacy: true as const };
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
}
