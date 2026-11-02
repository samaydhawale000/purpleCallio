import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

const RESEND_URL = 'https://api.resend.com/emails';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}

/**
 * Transactional email through Resend (https://resend.com).
 *
 * RESEND_API_KEY and EMAIL_FROM (a sender on a domain verified in Resend,
 * e.g. "PurpleCallio <no-reply@purplecallio.com>") must be set in
 * production. Outside production, a missing key logs the message instead so
 * sign-up and password reset can be tried locally.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.isConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('event=mail_not_configured (set RESEND_API_KEY and EMAIL_FROM)');
        throw new ServiceUnavailableException('Email is temporarily unavailable. Please try again later.');
      }
      this.logger.warn(`[dev] email not sent (Resend not configured) to=${message.to} subject="${message.subject}"\n${message.text}`);
      return;
    }

    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM!.trim(),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.attachments?.length
            ? { attachments: message.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })) }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error(`event=mail_send_failed reason=${(err as Error)?.name ?? 'network'}`);
      throw new ServiceUnavailableException('We could not send the email. Please try again.');
    }
    if (!res.ok) {
      // Resend's error body names the problem (unverified domain, bad key…); never the recipient.
      const body = await res.text().catch(() => '');
      this.logger.error(`event=mail_send_failed status=${res.status} body=${body.slice(0, 300)}`);
      throw new ServiceUnavailableException('We could not send the email. Please try again.');
    }
  }
}
