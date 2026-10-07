import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type {
  Payment,
  UsageInvoice,
  UsageInvoiceLineItem,
  User,
} from '@prisma/client';

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export type InvoiceForPdf = UsageInvoice & {
  lineItems: UsageInvoiceLineItem[];
  user: Pick<User, 'name' | 'email' | 'cardBrand' | 'cardLast4'>;
};

export type ReceiptForPdf = Payment & {
  user: Pick<User, 'name' | 'email' | 'companyName'> | null;
};

const PURPOSE_LABEL: Record<string, string> = {
  SUBSCRIPTION_PURCHASE: 'Plan purchase',
  SUBSCRIPTION_RENEWAL: 'Plan renewal',
  SUBSCRIPTION_UPGRADE: 'Plan upgrade',
  TOPUP: 'Credit top-up',
  CUSTOM_PLAN: 'Custom plan purchase',
  LEGACY: 'Payment',
};

export function receiptLabel(receiptNumber: number | null, id: string) {
  return receiptNumber ? `PCR-${String(receiptNumber).padStart(6, '0')}` : id;
}

/**
 * Renders a LEGACY UsageInvoice (pay-as-you-go) or a prepaid payment
 * receipt as a PDF buffer. Kept intentionally simple
 * (text/table layout via pdfkit, no headless browser) — this is an itemized
 * receipt, not a marketing document.
 */
@Injectable()
export class InvoicePdfService {
  /** Receipt for a prepaid purchase (plan, renewal, top-up, custom plan). */
  renderReceiptPdf(payment: ReceiptForPdf): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('PurpleCallio', { continued: false });
      doc
        .fontSize(10)
        .fillColor('#555')
        .text(`Receipt ${receiptLabel(payment.receiptNumber, payment.id)}`);
      doc.moveDown(1.5);

      doc.fillColor('#000').fontSize(11);
      const billedTo = payment.user?.companyName
        ? `${payment.user.companyName} (${payment.user.name ?? payment.user.email})`
        : (payment.user?.name ?? payment.user?.email ?? '');
      doc.text(`Billed to: ${billedTo}`);
      doc.text(`Type: ${PURPOSE_LABEL[payment.purpose] ?? 'Payment'}`);
      if (payment.paidAt) doc.text(`Paid on: ${formatDate(payment.paidAt)}`);
      if (payment.paymentMethod)
        doc.text(`Payment method: ${payment.paymentMethod}`);
      doc.moveDown(1);

      const items = Array.isArray(payment.lineItems)
        ? (payment.lineItems as {
            label: string;
            amountPaise: number;
            credits?: number;
          }[])
        : [
            {
              label: payment.description ?? 'Purchase',
              amountPaise: payment.subtotalPaise,
            },
          ];
      doc.font('Helvetica-Bold').text('Items');
      doc.font('Helvetica');
      for (const item of items) {
        const credits = item.credits
          ? ` (${item.credits.toLocaleString('en-IN')} credits)`
          : '';
        const amount =
          item.amountPaise < 0
            ? `-${formatRupees(-item.amountPaise)}`
            : formatRupees(item.amountPaise);
        doc.text(`  ${item.label}${credits} — ${amount}`);
      }
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.5);

      doc.text(`Subtotal:  ${formatRupees(payment.subtotalPaise)}`, {
        align: 'right',
      });
      if (payment.discountPaise > 0) {
        doc.text(
          `Discount${payment.discountPercent != null ? ` (${payment.discountPercent}%)` : ''}:  -${formatRupees(payment.discountPaise)}`,
          { align: 'right' },
        );
      }
      doc.text(
        `GST (${payment.taxPercent}%):  ${formatRupees(payment.taxPaise)}`,
        { align: 'right' },
      );
      doc.font('Helvetica-Bold').fontSize(13);
      doc.text(`Total paid:  ${formatRupees(payment.amount)}`, {
        align: 'right',
      });
      if (payment.refundedPaise > 0) {
        doc
          .font('Helvetica')
          .fontSize(11)
          .text(`Refunded:  ${formatRupees(payment.refundedPaise)}`, {
            align: 'right',
          });
      }
      doc.moveDown(1);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#555')
        .text(
          'Prepaid purchase. Credits are added to your PurpleCallio account and consumed by usage; no further charges apply.',
        );
      doc.end();
    });
  }

  /** LEGACY pay-as-you-go usage invoice. */
  renderInvoicePdf(invoice: InvoiceForPdf): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('PurpleCallio', { continued: false });
      doc
        .fontSize(10)
        .fillColor('#555')
        .text(
          `Usage invoice ${invoice.invoiceNumber ?? invoice.id} (legacy pay-as-you-go billing)`,
        );
      doc.moveDown(1.5);

      doc.fillColor('#000').fontSize(11);
      doc.text(`Billed to: ${invoice.user.name ?? invoice.user.email}`);
      doc.text(
        `Billing period: ${formatDate(invoice.cycleStart)} - ${formatDate(invoice.cycleEnd)}`,
      );
      doc.text(`Invoice date: ${formatDate(invoice.createdAt)}`);
      doc.moveDown(1);

      doc.font('Helvetica-Bold').text('Usage');
      doc.font('Helvetica');
      const usedMinutes =
        invoice.audioMinutes +
        invoice.videoMinutes +
        invoice.screenShareMinutes;
      doc.text(
        `Used (billable): ${usedMinutes.toLocaleString('en-IN')} participant-min`,
      );
      doc.text(
        `  Audio: ${invoice.audioMinutes.toLocaleString('en-IN')} participant-min — ${formatRupees(invoice.audioPaise)}`,
      );
      doc.text(
        `  Video: ${invoice.videoMinutes.toLocaleString('en-IN')} participant-min — ${formatRupees(invoice.videoPaise)}`,
      );
      doc.text(
        `  Screen share: ${invoice.screenShareMinutes.toLocaleString('en-IN')} participant-min — ${formatRupees(invoice.screenSharePaise)}`,
      );
      doc.moveDown(1);

      const adjustments = invoice.lineItems.filter(
        (li) => li.mediaType === 'adjustment',
      );
      if (adjustments.length) {
        doc.font('Helvetica-Bold').text('Adjustments');
        doc.font('Helvetica');
        for (const a of adjustments) {
          const label = a.amountPaise < 0 ? 'Credit' : 'Charge';
          doc.text(`  ${label}: ${formatRupees(Math.abs(a.amountPaise))}`);
        }
        doc.moveDown(1);
      }

      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.5);

      doc.font('Helvetica').fontSize(11);
      doc.text(`Subtotal:  ${formatRupees(invoice.subtotalPaise)}`, {
        align: 'right',
      });
      if (invoice.discountPaise > 0) {
        const label =
          invoice.discountPercent != null
            ? `Volume discount (${invoice.discountPercent}%):`
            : 'Discount:';
        doc.text(`${label}  -${formatRupees(invoice.discountPaise)}`, {
          align: 'right',
        });
      }
      doc.text(`Tax (GST):  ${formatRupees(invoice.taxPaise)}`, {
        align: 'right',
      });
      doc.font('Helvetica-Bold').fontSize(13);
      doc.text(`Total:  ${formatRupees(invoice.totalPaise)}`, {
        align: 'right',
      });
      doc.moveDown(1);

      doc.font('Helvetica').fontSize(11);
      doc.text(
        `Payment: ${invoice.status === 'paid' ? 'Paid' : invoice.status}`,
      );
      if (invoice.paidAt) doc.text(`Paid on: ${formatDate(invoice.paidAt)}`);
      if (invoice.user.cardLast4) {
        doc.text(
          `Payment method: ${invoice.user.cardBrand ?? 'Card'} •••• ${invoice.user.cardLast4}`,
        );
      }

      doc.end();
    });
  }
}
