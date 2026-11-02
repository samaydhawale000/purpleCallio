import type { MailMessage } from '../mail/mail.service';
import { emailLayout, p } from '../mail/email-layout';

type Kind = 'signup' | 'reset';

const COPY: Record<Kind, { subject: string; intro: string; ignore: string }> = {
  signup: {
    subject: 'Your PurpleCallio verification code',
    intro: 'Use this code to verify your email and finish creating your PurpleCallio account:',
    ignore: "If you didn't try to create an account, you can ignore this email.",
  },
  reset: {
    subject: 'Your PurpleCallio password reset code',
    intro: 'Use this code to choose a new password for your PurpleCallio account:',
    ignore: "If you didn't ask to reset your password, you can ignore this email; your password stays the same.",
  },
};

/** The one-time-code email for sign-up or password reset. */
export function otpEmail(kind: Kind, to: string, code: string, ttlMinutes: number): MailMessage {
  const { subject, intro, ignore } = COPY[kind];
  const codeBlock = `<div style="margin:0 0 20px;text-align:center"><span style="display:inline-block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#170B2E;background:#F3ECFE;border-radius:12px;padding:14px 24px">${code}</span></div>`;
  return {
    to,
    subject,
    text: `${intro}\n\n${code}\n\nThe code expires in ${ttlMinutes} minutes. ${ignore}\n\nThis is an automated message from PurpleCallio. Please do not reply to this email.`,
    html: emailLayout({
      preheader: `Your code is ${code}. It expires in ${ttlMinutes} minutes.`,
      body: [p(intro), codeBlock, p(`The code expires in ${ttlMinutes} minutes. ${ignore}`)].join(''),
    }),
  };
}
