import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { router, api } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
}));
vi.mock('../app/lib/api', () => ({ api }));

import { NotificationBell } from '../app/components/notifications/NotificationBell';
import { NotificationsPanel } from '../app/components/notifications/NotificationsPanel';
import { notificationHref, timeAgo, type AppNotification } from '../app/lib/notifications';
import { useAuthStore } from '../app/store/auth.store';

const n = (over: Partial<AppNotification>): AppNotification => ({
  id: 'n1',
  type: 'SUPPORT_TICKET_REPLY',
  title: 'Support ticket updated',
  message: 'Our support team replied to ticket PC-1001.',
  read: false,
  metadata: { ticketId: 't1' },
  createdAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: 'access', refreshToken: 'r', hasHydrated: true, user: { userId: 'u1' } });
  api.patch.mockResolvedValue({ data: {} });
});

describe('notificationHref', () => {
  it('routes by type and metadata, per area', () => {
    expect(notificationHref(n({}), 'CUSTOMER')).toBe('/dashboard/support/t1');
    expect(notificationHref(n({ type: 'SUPPORT_TICKET_CREATED' }), 'ADMIN')).toBe('/admin/support/t1');
    expect(
      notificationHref(n({ type: 'INVOICE_GENERATED', metadata: { invoiceId: 'i1' } }), 'CUSTOMER'),
    ).toBe('/dashboard/billing/invoices/i1');
    expect(notificationHref(n({ type: 'INVOICE_PAYMENT_SUCCESS', metadata: null }), 'CUSTOMER')).toBe(
      '/dashboard/billing',
    );
    expect(notificationHref(n({ type: 'USAGE_LIMIT_REACHED' }), 'CUSTOMER')).toBe('/dashboard/usage');
    expect(notificationHref(n({ type: 'API_KEY_REVOKED' }), 'CUSTOMER')).toBe('/dashboard/api-keys');
    expect(
      notificationHref(n({ type: 'INVOICE_PAYMENT_FAILED', metadata: { customerId: 'c1' } }), 'ADMIN'),
    ).toBe('/admin/customers/c1');
    expect(notificationHref(n({ type: 'SOMETHING_NEW' }), 'CUSTOMER')).toBeNull();
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-10-05T12:00:00');
  it('formats recent times relatively', () => {
    expect(timeAgo('2026-10-05T11:59:30', now)).toBe('Just now');
    expect(timeAgo('2026-10-05T11:50:00', now)).toMatch(/10 minutes ago/);
    expect(timeAgo('2026-10-05T10:00:00', now)).toMatch(/2 hours ago/);
    expect(timeAgo('2026-10-04T09:00:00', now)).toBe('Yesterday');
  });
});

describe('NotificationBell', () => {
  it('shows the unread count and opens the latest notifications', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/notifications/unread-count')
          ? { data: { count: 3 } }
          : { data: { data: [n({})] } },
      ),
    );
    render(<NotificationBell area="CUSTOMER" />);

    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    expect(api.get).toHaveBeenCalledWith('/notifications/unread-count?audience=CUSTOMER');
    fireEvent.click(bell);

    expect(await screen.findByText('Support ticket updated')).toBeTruthy();
    expect(screen.getByText('View all notifications').getAttribute('href')).toBe(
      '/dashboard/notifications',
    );
  });

  it('marks a notification read and navigates to it on click', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/notifications/unread-count')
          ? { data: { count: 1 } }
          : { data: { data: [n({})] } },
      ),
    );
    render(<NotificationBell area="CUSTOMER" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(await screen.findByText('Support ticket updated'));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/notifications/n1/read'));
    expect(router.push).toHaveBeenCalledWith('/dashboard/support/t1');
  });
});

describe('NotificationsPanel', () => {
  it('filters to unread and marks all as read', async () => {
    api.get.mockResolvedValue({
      data: { data: [n({}), n({ id: 'n2', read: true, title: 'Project created' })], unread: 1, total: 2, page: 1, pageSize: 10, pageCount: 1 },
    });
    render(<NotificationsPanel area="ADMIN" />);

    expect(await screen.findByText('1 unread')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/notifications?audience=ADMIN&page=1');

    fireEvent.click(screen.getByRole('button', { name: 'Unread (1)' }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/notifications?audience=ADMIN&page=1&filter=unread'),
    );

    fireEvent.click(screen.getByRole('button', { name: /Mark all as read/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/notifications/read-all?audience=ADMIN'));
  });
});
