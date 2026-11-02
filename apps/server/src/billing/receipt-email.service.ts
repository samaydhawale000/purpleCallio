import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { InvoicePdfService, receiptLabel } from './invoice-pdf.service';
import { receiptEmail } from './receipt-email';

/**
 * Emails the customer a receipt (with the PDF attached) once a payment is
 * fulfilled. Called once per payment from BillingFulfillmentService after
 * the fulfillment commits; failures are logged and never affect the
 * purchase — the receipt stays downloadable from Billing → Payments.
 */
@Injectable()
export class ReceiptEmailService {
  private readonly logger = new Logger(ReceiptEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly pdf: InvoicePdfService,
  ) {}

  async send(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { user: { select: { name: true, email: true, companyName: true } } },
    });
    if (!payment?.receiptNumber || !payment.user?.email) return;

    const attachment = await this.pdf.renderReceiptPdf(payment);
    await this.mail.send({
      ...receiptEmail({ ...payment, user: payment.user }),
      attachments: [{ filename: `${receiptLabel(payment.receiptNumber, payment.id)}.pdf`, content: attachment }],
    });
  }

  /** Fire-and-forget: the checkout response doesn't wait for the PDF or Resend. */
  sendInBackground(paymentId: string): void {
    this.send(paymentId).catch((err) =>
      this.logger.warn(`event=receipt_email_failed paymentId=${paymentId} reason=${(err as Error)?.message ?? 'unknown'}`),
    );
  }
}
