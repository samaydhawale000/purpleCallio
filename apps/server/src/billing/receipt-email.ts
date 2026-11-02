import type { MailMessage } from '../mail/mail.service';
import { emailLayout, esc, link, p, siteUrl } from '../mail/email-layout';
import { receiptLabel, type ReceiptForPdf } from './invoice-pdf.service';

const PURPOSE: Record<string, string> = {
  SUBSCRIPTION_PURCHASE: 'Plan purchase',
  SUBSCRIPTION_RENEWAL: 'Plan renewal',
  SUBSCRIPTION_UPGRADE: 'Plan upgrade',
  CUSTOM_PLAN: 'Custom plan',
  TOPUP: 'Credit top-up',
  AUTO_TOPUP: 'Automatic credit top-up',
};

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The payment receipt email; the PDF receipt is attached by the caller. */
export function receiptEmail(payment: ReceiptForPdf & { user: { email: string } }): MailMessage {
  const account = payment.user.companyName || payment.user.name || payment.user.email;
  const receipt = receiptLabel(payment.receiptNumber, payment.id);
  const item = payment.description || PURPOSE[payment.purpose] || 'Payment';
  const tax = payment.taxPaise > 0 ? ` (incl. ${payment.taxPercent}% GST ${rupees(payment.taxPaise)})` : '';
  const paymentsUrl = siteUrl('/dashboard/billing/payments');

  const rows = [
    `For: <b>${esc(item)}</b>`,
    `Amount paid: <b>${rupees(payment.amount)}</b>${tax}`,
    ...(payment.credits > 0 ? [`Credits added: <b>${payment.credits.toLocaleString('en-IN')}</b>`] : []),
  ];

  const body = [
    p(`We have received your payment for PurpleCallio account <b>${esc(account)}</b>.`),
    ...rows.map((r) => p(r)),
    p(`Receipt ${esc(receipt)} for this payment is attached. You can find all your payments in the ${link(paymentsUrl, 'PurpleCallio dashboard')}.`),
    p(`If you have any questions, contact us from ${link(siteUrl('/dashboard/support'), 'Support')} in your dashboard.`),
  ].join('');

  const text = [
    `We have received your payment for PurpleCallio account ${account}.`,
    '',
    `For: ${item}`,
    `Amount paid: ${rupees(payment.amount)}${tax}`,
    ...(payment.credits > 0 ? [`Credits added: ${payment.credits.toLocaleString('en-IN')}`] : []),
    '',
    `Receipt ${receipt} for this payment is attached. You can find all your payments at ${paymentsUrl}.`,
    `If you have any questions, contact us from Support in your dashboard: ${siteUrl('/dashboard/support')}.`,
    '',
    'This is an automated message from PurpleCallio. Please do not reply to this email.',
  ].join('\n');

  return {
    to: payment.user.email,
    subject: `Your PurpleCallio receipt ${receipt}`,
    html: emailLayout({ preheader: `Payment of ${rupees(payment.amount)} received. Receipt ${receipt} attached.`, body }),
    text,
  };
}
