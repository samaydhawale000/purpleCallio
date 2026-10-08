import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const { router, api } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/dashboard/billing' }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../app/lib/api', () => ({ api }));
vi.mock('../app/hooks/useRequireAuth', () => ({ useRequireAuth: () => ({ isAuthed: true, isReady: true }) }));

import BillingOverviewPage from '../app/dashboard/billing/page';
import { overview, page, usageDebit, wallet } from './billing-fixtures';

function mockApi(ov: ReturnType<typeof overview>) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/billing/overview') return { data: ov };
    if (url === '/billing/credits/history') return { data: page([usageDebit]) };
    throw new Error(`unexpected GET ${url}`);
  });
}

beforeEach(() => vi.clearAllMocks());

describe('Billing overview', () => {
  it('renders the plan, credits, usage and rates from the API', async () => {
    mockApi(overview());
    render(<BillingOverviewPage />);

    const plan = await screen.findByTestId('current-plan');
    expect(plan.textContent).toContain('Growth');
    expect(plan.textContent).toContain('₹2,499 / month');
    expect(plan.textContent).toContain('Active until');
    expect(plan.textContent).toContain('Auto-renew is off');
    expect(screen.getByTestId('auto-renew-control').textContent).toContain('Turn on auto-renew');
    expect(screen.getByTestId('credit-balance').textContent).toContain('9,000');
    expect(screen.getByTestId('usage-by-media').textContent).toContain('2,400');
    expect(screen.getByText('1 video participant-minute = 2 credits')).toBeTruthy();
    expect(screen.getByTestId('recent-usage').textContent).toContain('20.00 participant-min');
    expect(screen.getByText('How prepaid billing works')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/billing/credits/history', { params: { page: 1, type: 'USAGE_DEBIT' } });
    expect(screen.queryByTestId('credit-alert')).toBeNull();
    expect(document.body.textContent).not.toMatch(/pay as you go|usage invoice|spending limit|auto billing|free tier/i);
  });

  it('shows an auto-renewing plan with its next charge and a Turn off control instead of Renew', async () => {
    mockApi(
      overview({
        subscription: { ...overview().subscription, autoRenew: true, renewalAmountPaise: 294882 },
        autoRenew: { autoRenew: true, status: 'active', renewalAmountPaise: 294882, nextChargeAt: overview().subscription.currentPeriodEnd, offReason: null },
      }),
    );
    render(<BillingOverviewPage />);
    const plan = await screen.findByTestId('current-plan');
    expect(plan.textContent).toContain('Renews automatically on');
    expect(plan.textContent).toContain('₹2,948.82');
    expect(screen.queryByText('Renew')).toBeNull();
    expect(screen.getByTestId('auto-renew-control').textContent).toContain('Turn off');
  });

  it('shows the cancel-at-period-end state with Resume', async () => {
    mockApi(overview({ subscription: { ...overview().subscription, cancelAtPeriodEnd: true } }));
    render(<BillingOverviewPage />);
    expect((await screen.findByTestId('current-plan')).textContent).toContain('Your plan remains active until');
    expect(screen.getByText('Resume plan')).toBeTruthy();
  });

  it('warns when credits run out and shows a ready custom plan offer', async () => {
    const empty = { ...wallet, balance: 0, available: 0, used: 12000, usedPercent: 100, buckets: [] };
    mockApi(
      overview({
        wallet: empty,
        customPlan: {
          request: null,
          offers: [
            {
              id: 'offer-1',
              status: 'SENT',
              message: null,
              expiresAt: null,
              acceptedAt: null,
              createdAt: '2026-10-01T00:00:00.000Z',
              requestId: 'req-1',
              plan: { id: 'p-c', name: 'Acme Enterprise', version: { pricePaise: 5000000, currency: 'INR', billingInterval: 'MONTH', intervalCount: 1 } },
            },
          ],
        },
      }),
    );
    render(<BillingOverviewPage />);
    expect((await screen.findByTestId('credit-alert')).textContent).toContain('New calls are paused until you add credits');
    expect(screen.getByText('Your custom plan is ready')).toBeTruthy();
    expect(screen.getByText('Review offer').closest('a')?.getAttribute('href')).toBe('/dashboard/billing/offers/offer-1');
  });
});
