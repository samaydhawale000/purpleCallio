import { ServiceUnavailableException } from '@nestjs/common';

import { MailService } from './mail.service';

describe('MailService (Resend)', () => {
  const env = { ...process.env };
  const message = { to: 'asha@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({ ok: true, text: async () => '' }));
    global.fetch = fetchMock as any;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('posts the message to the Resend API with the key and sender', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'PurpleCallio <no-reply@purplecallio.com>';
    await new MailService().send(message);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body)).toEqual({
      from: 'PurpleCallio <no-reply@purplecallio.com>',
      to: ['asha@example.com'],
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('sends attachments base64-encoded', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'no-reply@purplecallio.com';
    await new MailService().send({ ...message, attachments: [{ filename: 'PCR-000042.pdf', content: Buffer.from('%PDF') }] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).attachments).toEqual([
      { filename: 'PCR-000042.pdf', content: Buffer.from('%PDF').toString('base64') },
    ]);
  });

  it('turns a Resend error into a 503 without leaking details', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'no-reply@purplecallio.com';
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'domain not verified' });
    await expect(new MailService().send(message)).rejects.toThrow(
      new ServiceUnavailableException('We could not send the email. Please try again.'),
    );
  });

  it('without a key: logs in development, refuses in production', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'development';
    await expect(new MailService().send(message)).resolves.toBeUndefined();
    process.env.NODE_ENV = 'production';
    await expect(new MailService().send(message)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
