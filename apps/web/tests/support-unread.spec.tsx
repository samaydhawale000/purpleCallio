import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { api, realtime } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  realtime: { handlers: {} as Record<string, (p: any) => void> },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/support',
}));
vi.mock('../app/lib/api', () => ({ api }));
vi.mock('../app/lib/realtime', () => ({
  useRealtimeEvent: (event: string, handler: (p: any) => void) => {
    realtime.handlers[event] = handler;
  },
}));

import AdminSupportPage from '../app/admin/support/page';

const ticket = (over: object) => ({
  id: 't1',
  ticketNumber: 'PC-1001',
  subject: 'Webhook not firing',
  documentationId: null,
  status: 'OPEN',
  createdAt: '2026-10-05T10:00:00Z',
  updatedAt: '2026-10-05T10:00:00Z',
  customer: { id: 'c1', name: 'Samay', email: 's@acme.com', companyName: null },
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('/admin/support — unread indicators', () => {
  it('tags tickets with an unseen customer message and refreshes on push', async () => {
    api.get.mockResolvedValue({
      data: {
        data: [ticket({ hasUnread: true }), ticket({ id: 't2', ticketNumber: 'PC-1002', subject: 'Seen', hasUnread: false })],
        total: 2, page: 1, pageSize: 10, pageCount: 1,
      },
    });
    render(<AdminSupportPage />);

    expect(await screen.findByText('New')).toBeTruthy();
    expect(screen.getAllByText('New')).toHaveLength(1);
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1);

    realtime.handlers['support:ticket-updated']({ ticketId: 't2' });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
