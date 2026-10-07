export type NotificationArea = 'CUSTOMER' | 'ADMIN';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  metadata: Record<string, string | number | null> | null;
  createdAt: string;
}

/** Fired after any read-state change so the bell and the page stay in sync. */
export const NOTIFICATIONS_CHANGED = 'purplecallio:notifications-changed';

export function notifyNotificationsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export function notificationsPath(area: NotificationArea) {
  return area === 'ADMIN' ? '/admin/notifications' : '/dashboard/notifications';
}

/**
 * Where clicking a notification goes. Routing lives here (not in the
 * backend) and is derived from type + metadata ids; null = no related page,
 * the click just marks it read.
 */
export function notificationHref(n: AppNotification, area: NotificationArea): string | null {
  const m = n.metadata ?? {};
  const id = (key: string) => (typeof m[key] === 'string' ? (m[key] as string) : null);

  if (area === 'ADMIN') {
    if (n.type.startsWith('SUPPORT_TICKET') && id('ticketId')) return `/admin/support/${id('ticketId')}`;
    if (n.type === 'INVOICE_PAYMENT_FAILED') {
      return id('customerId') ? `/admin/customers/${id('customerId')}` : '/admin/billing';
    }
    if (n.type === 'CUSTOM_PLAN_REQUEST_CREATED') {
      return id('requestId') ? `/admin/billing/custom-plans/${id('requestId')}` : '/admin/billing?tab=custom-plans';
    }
    if (n.type === 'PAYMENT_FAILED') return '/admin/billing?tab=payments';
    if (n.type === 'PLAN_ACTIVATED') return '/admin/billing?tab=subscriptions';
    return null;
  }

  switch (n.type) {
    case 'SUPPORT_TICKET_CREATED':
    case 'SUPPORT_TICKET_REPLY':
    case 'SUPPORT_TICKET_STATUS_CHANGED':
      return id('ticketId') ? `/dashboard/support/${id('ticketId')}` : '/dashboard/support';
    case 'INVOICE_GENERATED':
    case 'INVOICE_PAYMENT_SUCCESS':
    case 'INVOICE_PAYMENT_FAILED':
      return id('invoiceId') ? `/dashboard/billing/invoices/${id('invoiceId')}` : '/dashboard/billing';
    case 'USAGE_LIMIT_APPROACHING':
    case 'USAGE_LIMIT_REACHED':
      return '/dashboard/usage';
    case 'PAYMENT_SUCCESS':
    case 'PAYMENT_FAILED':
      return '/dashboard/billing/payments';
    case 'PLAN_ACTIVATED':
    case 'PLAN_EXPIRING':
    case 'PLAN_EXPIRED':
      return '/dashboard/billing';
    case 'CREDITS_LOW':
    case 'CREDITS_EXHAUSTED':
    case 'TOPUP_SUCCESS':
      return '/dashboard/billing/credits';
    case 'CUSTOM_PLAN_REQUEST_CREATED':
      return id('ticketId') ? `/dashboard/support/${id('ticketId')}` : '/dashboard/billing';
    case 'CUSTOM_PLAN_OFFER_RECEIVED':
      return id('offerId') ? `/dashboard/billing/offers/${id('offerId')}` : '/dashboard/billing';
    case 'API_KEY_CREATED':
    case 'API_KEY_REVOKED':
      return '/dashboard/api-keys';
    case 'PROJECT_CREATED':
      return '/dashboard/projects';
    default:
      return null;
  }
}

/** "Just now", "10 minutes ago", "2 hours ago", "Yesterday", then a date. */
export function timeAgo(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.ceil((startOfToday.getTime() - date.getTime()) / 86_400_000);
  if (days <= 1) return 'Yesterday';
  if (days < 7) return rtf.format(-days, 'day');
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
