import { ReceiptEmailService } from './receipt-email.service';
import { receiptEmail } from './receipt-email';

const payment = {
  id: 'pay_1',
  receiptNumber: 42,
  purpose: 'SUBSCRIPTION_PURCHASE',
  description: 'Growth plan — monthly',
  amount: 118000,
  subtotalPaise: 100000,
  taxPercent: 18,
  taxPaise: 18000,
  credits: 100000,
  user: { name: 'Asha Rao', email: 'asha@example.com', companyName: 'Acme <Labs>' },
} as any;

beforeAll(() => {
  process.env.FRONTEND_URL = 'https://purplecallio.com';
});

describe('receiptEmail', () => {
  it('matches the receipt layout: account, item, amount with GST, credits, receipt number and links', () => {
    const m = receiptEmail(payment);
    expect(m).toMatchObject({ to: 'asha@example.com', subject: 'Your PurpleCallio receipt PCR-000042' });
    expect(m.html).toContain('We have received your payment for PurpleCallio account <b>Acme &lt;Labs&gt;</b>.');
    expect(m.html).toContain('For: <b>Growth plan — monthly</b>');
    expect(m.html).toContain('Amount paid: <b>₹1,180.00</b> (incl. 18% GST ₹180.00)');
    expect(m.html).toContain('Credits added: <b>1,00,000</b>');
    expect(m.html).toContain('Receipt PCR-000042 for this payment is attached.');
    expect(m.html).toContain('href="https://purplecallio.com/dashboard/billing/payments"');
    expect(m.html).toContain('This is an automated message from PurpleCallio. Please do not reply to this email.');
    expect(m.html).toContain(`&copy; ${new Date().getFullYear()} PurpleCallio. All rights reserved.`);
    expect(m.html).not.toContain('<Labs>');
    expect(m.text).toContain('Amount paid: ₹1,180.00 (incl. 18% GST ₹180.00)');
  });

  it('falls back to the purpose and the name, and leaves out credits and GST when there are none', () => {
    const m = receiptEmail({ ...payment, description: null, purpose: 'TOPUP', taxPaise: 0, credits: 0, user: { ...payment.user, companyName: null } });
    expect(m.html).toContain('account <b>Asha Rao</b>');
    expect(m.html).toContain('For: <b>Credit top-up</b>');
    expect(m.html).toContain('Amount paid: <b>₹1,180.00</b></p>');
    expect(m.html).not.toContain('Credits added');
  });
});

describe('ReceiptEmailService', () => {
  function setup(row: any) {
    const prisma = { payment: { findUnique: jest.fn(async () => row) } };
    const mail = { send: jest.fn(async () => undefined) };
    const pdf = { renderReceiptPdf: jest.fn(async () => Buffer.from('%PDF')) };
    return { mail, pdf, service: new ReceiptEmailService(prisma as any, mail as any, pdf as any) };
  }

  it('sends the receipt with the PDF attached', async () => {
    const { service, mail, pdf } = setup(payment);
    await service.send('pay_1');
    expect(pdf.renderReceiptPdf).toHaveBeenCalledWith(payment);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'asha@example.com',
        attachments: [{ filename: 'PCR-000042.pdf', content: Buffer.from('%PDF') }],
      }),
    );
  });

  it('skips a payment without a receipt number or customer email', async () => {
    for (const row of [null, { ...payment, receiptNumber: null }, { ...payment, user: null }]) {
      const { service, mail } = setup(row);
      await service.send('pay_1');
      expect(mail.send).not.toHaveBeenCalled();
    }
  });

  it('never throws from the background send', async () => {
    const { service, mail } = setup(payment);
    mail.send.mockRejectedValueOnce(new Error('resend down'));
    expect(() => service.sendInBackground('pay_1')).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
