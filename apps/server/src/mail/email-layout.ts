/**
 * Shared frame for PurpleCallio emails: logo, the message, and a grey
 * footer card (tagline, links, automated-message note, copyright). Inline
 * styles and tables only, so it renders the same in Gmail, Outlook and
 * Apple Mail.
 */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TEXT = '#2A2638';
const PURPLE = '#7F40E8';

/** The site origin used for links in emails (FRONTEND_URL, e.g. https://purplecallio.com). */
export function siteUrl(path = ''): string {
  const base = (process.env.FRONTEND_URL || process.env.APP_URL || 'https://purplecallio.com').replace(/\/+$/, '');
  return `${base}${path}`;
}

/** Escapes user-supplied text (names, company) for HTML. */
export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function link(href: string, label: string): string {
  return `<a href="${esc(href)}" style="color:${PURPLE};text-decoration:none;font-weight:600">${label}</a>`;
}

/** A body paragraph. */
export function p(html: string): string {
  return `<p style="margin:0 0 20px;font-size:16px;line-height:26px;color:${TEXT}">${html}</p>`;
}

/**
 * Where email images are loaded from. Mail clients fetch them from the
 * internet, so a localhost FRONTEND_URL (local testing) falls back to the
 * production site, which serves the same file.
 */
function assetUrl(path: string): string {
  const url = siteUrl(path);
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) ? `https://purplecallio.com${path}` : url;
}

/** The logo (apps/web/public/email/logo.png, 440×105, shown at half size for sharp retina rendering). */
function logo(width: number): string {
  const height = Math.round((width * 105) / 440);
  return `<a href="${esc(siteUrl())}" style="text-decoration:none"><img src="${esc(assetUrl('/email/logo.png'))}" width="${width}" height="${height}" alt="PurpleCallio" style="display:inline-block;border:0;outline:none;width:${width}px;height:${height}px;font-size:22px;font-weight:800;color:#6425C4"></a>`;
}

export function emailLayout({ preheader, body }: { preheader: string; body: string }): string {
  const year = new Date().getFullYear();
  const dot = `<span style="color:#A9A3B8;padding:0 8px">&middot;</span>`;
  const footerLink = (path: string, label: string) =>
    `<a href="${esc(siteUrl(path))}" style="color:#3D3650;text-decoration:none;font-weight:600">${label}</a>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PurpleCallio</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${FONT}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td align="center" style="padding-bottom:36px">${logo(200)}</td></tr>
        <tr><td style="padding:0 8px">${body}</td></tr>
        <tr><td style="padding-top:20px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2F8;border-radius:20px">
            <tr><td align="center" style="padding:36px 24px">
              <div style="padding-bottom:14px">${logo(160)}</div>
              <div style="font-size:16px;color:#4A4458;padding-bottom:18px">Voice, video, AI agents and live translation for your product.</div>
              <div style="font-size:14px;padding-bottom:22px">${footerLink('', 'Website')}${dot}${footerLink('/docs', 'Docs')}${dot}${footerLink('/pricing', 'Pricing')}${dot}${footerLink('/dashboard', 'Dashboard')}${dot}${footerLink('/dashboard/support', 'Support')}</div>
              <div style="font-size:13px;line-height:20px;color:#7A7389">This is an automated message from PurpleCallio. Please do not reply to this email.<br>For help, contact us from <a href="${esc(siteUrl('/dashboard/support'))}" style="color:#7A7389;font-weight:600;text-decoration:none">Support</a> in your dashboard.</div>
              <div style="font-size:13px;color:#7A7389;padding-top:16px">&copy; ${year} PurpleCallio. All rights reserved.</div>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
