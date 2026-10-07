import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, nav } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  nav: { push: vi.fn(), replace: vi.fn(), params: { id: 't1' } as Record<string, string>, search: '' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
  usePathname: () => '/admin/billing',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('../app/lib/api', () => ({ api }));
vi.mock('../app/lib/realtime', () => ({ useRealtimeEvent: () => {} }));

import { PlanEditor } from '../app/admin/billing/_components/PlanEditor';
import { RefundDialog } from '../app/admin/billing/_components/PaymentsTab';
import { CreditRatesTab } from '../app/admin/billing/_components/CreditRatesTab';
import AdminBillingPage from '../app/admin/billing/page';
import AdminTicketPage from '../app/admin/support/[id]/page';
import { rupeesToPaise } from '../app/lib/admin-billing';
import type { AdminPaymentRow } from '../app/lib/admin-billing';

const page = <T,>(data: T[]) => ({ data: { data, total: data.length, page: 1, pageSize: 10, pageCount: 1 } });

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = '';
  nav.params = { id: 't1' };
});

describe('rupeesToPaise', () => {
  it('converts rupees to integer paise and rejects bad input', () => {
    expect(rupeesToPaise('499')).toBe(49900);
    expect(rupeesToPaise('499.5')).toBe(49950);
    expect(rupeesToPaise('0.01')).toBe(1);
    expect(Number.isNaN(rupeesToPaise('4.999'))).toBe(true);
    expect(Number.isNaN(rupeesToPaise('abc'))).toBe(true);
  });
});

describe('Plan editor', () => {
  it('submits the price in paise and feature keys loaded from the registry', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/admin/billing/features') {
        return Promise.resolve({
          data: [
            { id: 'f1', key: 'TEAM_ROOMS', name: 'Team rooms', description: null, category: 'Calling', displayOrder: 0, isActive: true, isPublic: true },
            { id: 'f2', key: 'AUDIT_EXPORT', name: 'Audit export', description: null, category: 'Platform', displayOrder: 1, isActive: true, isPublic: true },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    api.post.mockResolvedValue({ data: { id: 'new-plan' } });

    render(<PlanEditor planId={null} />);
    // Features come from the API, not a hard-coded list.
    const teamRooms = await screen.findByLabelText('Team rooms');
    expect(screen.getByLabelText('Audit export')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Scale Plan' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '1499.50' } });
    fireEvent.change(screen.getByLabelText('Total included credits'), { target: { value: '25000' } });
    fireEvent.click(teamRooms);
    expect(screen.getByText(/creates a new version\. Existing subscribers keep the terms they purchased/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/admin/billing/plans');
    expect(body).toMatchObject({
      name: 'Scale Plan',
      slug: 'scale-plan',
      pricePaise: 149950,
      includedCredits: 25000,
      features: ['TEAM_ROOMS'],
      billingInterval: 'MONTH',
      intervalCount: 1,
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/billing/plans/new-plan'));
  });

  it('blocks a paid plan without a price', async () => {
    api.get.mockResolvedValue({ data: [] });
    render(<PlanEditor planId={null} />);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Broken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(await screen.findByText('A paid plan needs a price above zero.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Refund dialog', () => {
  const payment: AdminPaymentRow = {
    id: 'pay1',
    userId: 'u1',
    purpose: 'TOPUP',
    paymentStatus: 'PAID',
    description: 'Credit top-up',
    amount: 117882,
    subtotalPaise: 99900,
    discountPaise: 0,
    taxPaise: 17982,
    currency: 'INR',
    credits: 60000,
    paymentMethod: 'upi',
    providerOrderId: 'order_1',
    providerPaymentId: 'pay_1',
    receiptNumber: 12,
    failureReason: null,
    refundedPaise: 0,
    paidAt: '2026-10-01T10:00:00Z',
    createdAt: '2026-10-01T10:00:00Z',
    user: { id: 'u1', email: 'a@acme.com', name: 'A' },
  };

  it('requires a reason and confirmation before refunding', async () => {
    api.post.mockResolvedValue({ data: {} });
    const onDone = vi.fn();
    render(<RefundDialog payment={payment} onClose={() => {}} onDone={onDone} />);

    expect(screen.getByText(/Credits from this payment that are still unused are removed/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Issue refund' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/I understand this reverses/));
    expect(submit.disabled).toBe(true); // still no reason
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Duplicate purchase' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/billing/payments/pay1/refund', { reason: 'Duplicate purchase' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('Credit rates', () => {
  it('computes the live example from the form values', async () => {
    api.get.mockResolvedValue({
      data: {
        id: 'c1',
        audioCreditsPerMinute: 1,
        videoCreditsPerMinute: 4,
        screenShareCreditsPerMinute: 2,
        minimumCreditsToStartCall: 10,
        taxPercent: 18,
        lowCreditThresholds: [20, 10],
        topUpExpiryPolicy: 'NEVER',
        topUpExpiryDays: null,
        renewalReminderDays: 3,
        pendingCheckoutTtlHours: 24,
      },
    });
    render(<CreditRatesTab />);
    const example = await screen.findByTestId('credit-example');
    expect(example.textContent).toContain('2 participants × 10 min video = 80 credits');
    fireEvent.change(screen.getByLabelText('Video (credits / participant-min)'), { target: { value: '5' } });
    expect(screen.getByTestId('credit-example').textContent).toContain('2 participants × 10 min video = 100 credits');
    expect(screen.queryByText(/AI voice|Recording/)).toBeNull();
  });
});

describe('Billing console tabs', () => {
  it('opens the tab named in ?tab= and syncs tab clicks to the URL', async () => {
    nav.search = 'tab=payments';
    api.get.mockResolvedValue(page([]));
    render(<AdminBillingPage />);
    expect(await screen.findByText('No payments match these filters.')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/admin/billing/payments', { params: { page: 1 } });

    fireEvent.click(screen.getByRole('tab', { name: 'Custom Plans' }));
    expect(nav.replace).toHaveBeenCalledWith('/admin/billing?tab=custom-plans', { scroll: false });
  });
});

describe('Admin support ticket — custom plan', () => {
  it('shows the CUSTOM PLAN badge and the request context panel', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/admin/support/tickets/t1') {
        return Promise.resolve({
          data: {
            id: 't1',
            ticketNumber: 'PC-1042',
            subject: 'Custom plan request',
            documentationId: null,
            status: 'OPEN',
            type: 'CUSTOM_PLAN',
            customPlanRequest: { id: 'cpr1', status: 'NEW' },
            createdAt: '2026-10-05T10:00:00Z',
            updatedAt: '2026-10-05T10:00:00Z',
            messages: [],
            customer: {
              id: 'u1', name: 'Asha', email: 'asha@acme.com', phone: null, companyName: 'Acme', jobTitle: null,
              country: null, companyWebsite: null, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00Z',
            },
          },
        });
      }
      if (url === '/admin/billing/custom-plans/cpr1') {
        return Promise.resolve({
          data: {
            id: 'cpr1',
            status: 'NEW',
            notes: null,
            estimatedMonthlyCredits: null,
            requestedAt: '2026-10-05T10:00:00Z',
            closedAt: null,
            customer: { id: 'u1', email: 'asha@acme.com', name: 'Asha' },
            assignedAdmin: null,
            ticket: { id: 't1', ticketNumber: 'PC-1042', status: 'OPEN' },
            subscription: { planName: 'Growth', planType: 'PAID', status: 'ACTIVE', currentPeriodEnd: '2026-11-01T00:00:00Z' },
            wallet: { balance: 5000, reserved: 0, available: 5000, granted: 10000, used: 5000, usedPercent: 50, buckets: [] },
            usageLast30Days: { calls: 12, audioMinutes: 100, videoMinutes: 200, screenShareMinutes: 5, credits: 4321 },
            payments: [],
            offers: [],
          },
        });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    render(<AdminTicketPage />);
    expect(await screen.findByText('Custom plan')).toBeTruthy();
    expect(await screen.findByText('Growth')).toBeTruthy();
    expect(screen.getByText(/4,321 credits · 12 calls/)).toBeTruthy();
    const link = screen.getByText(/Open request/).closest('a');
    expect(link?.getAttribute('href')).toBe('/admin/billing/custom-plans/cpr1');
  });
});
