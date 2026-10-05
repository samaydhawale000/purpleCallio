export type TicketStatus = 'OPEN' | 'PENDING' | 'RESOLVED';
export type SenderType = 'CUSTOMER' | 'ADMIN';

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  documentationId: string | null;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  /** The other side has posted since this viewer last opened the ticket. */
  hasUnread?: boolean;
}

export interface SupportMessage {
  id: string;
  senderType: SenderType;
  senderName?: string | null;
  message: string;
  createdAt: string;
}

export const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'PENDING', 'RESOLVED'];

// Mirrors the backend DTO limits (apps/server/src/support/dto).
export const SUBJECT_MAX_LENGTH = 200;
export const MESSAGE_MAX_LENGTH = 5000;

/**
 * Public documentation pages a ticket can reference. The id is the
 * /docs/<slug> route segment, so "Contact Support" on a docs page can
 * preselect it via /dashboard/support/new?doc=<slug>.
 */
export const DOC_PAGES: { id: string; label: string }[] = [
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'rest-api', label: 'REST API' },
  { id: 'calls', label: 'Calls' },
  { id: 'hosted-ui', label: 'Hosted UI' },
  { id: 'javascript', label: 'JavaScript SDK' },
  { id: 'react', label: 'React SDK' },
  { id: 'angular', label: 'Angular SDK' },
  { id: 'react-native', label: 'React Native SDK' },
  { id: 'vue', label: 'Vue SDK' },
  { id: 'svelte', label: 'Svelte SDK' },
  { id: 'flutter', label: 'Flutter' },
  { id: 'ios', label: 'iOS' },
  { id: 'android', label: 'Android' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'screen-sharing', label: 'Screen Sharing' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'security', label: 'Security' },
  { id: 'usage-billing', label: 'Usage and Billing' },
];

export function docLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return DOC_PAGES.find((d) => d.id === id)?.label ?? id;
}

export function apiErrorMessage(e: any, fallback: string): string {
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg[0] ?? fallback;
  return msg || fallback;
}
