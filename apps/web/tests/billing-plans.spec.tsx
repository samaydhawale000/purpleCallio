import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { router, api, search } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  search: { value: new URLSearchParams('') },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/billing/plans',
  useSearchParams: () => search.value,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../app/lib/api', () => ({ api }));
vi.mock('../app/hooks/useRequireAuth', () => ({ useRequireAuth: () => ({ isAuthed: true, isReady: true }) }));

import PlansPage from '../app/dashboard/billing/plans/page';
import { subscription } from './billing-fixtures';

const version = (pricePaise: number, includedCredits: number, features: string[] = []) => ({
  id: `v-${pricePaise}`,
  version: 1,
  pricePaise,
  currency: 'INR',
  billingInterval: 'MONTH',
  intervalCount: 1,
  includedCredits,
  includedAudioCredits: null,
  includedVideoCredits: null,
  includedScreenShareCredits: null,
  features,
});
const plan = (id: string, name: string, type: string, extra: Record<string, unknown>) => ({
  id,
  slug: id,
  name,
  description: null,
  badge: null,
  type,
  status: 'ACTIVE',
  displayOrder: 0,
  isPopular: false,
  isPublic: true,
  ctaLabel: null,
  ctaAction: 'CHECKOUT',
  customPricing: false,
  ...extra,
});

const available = {
  current: { ...subscription, planId: 'free', planName: 'Free', planType: 'FREE', pricePaise: 0 },
  plans: [
    plan('free', 'Free', 'FREE', { version: version(0, 1000), isCurrent: true, relation: 'current' }),
    plan('growth', 'Growth', 'PAID', { version: version(249900, 12000, ['WEBHOOKS']), isCurrent: false, relation: 'upgrade' }),
    plan('enterprise', 'Enterprise', 'CUSTOM', { customPricing: true, version: null, isCurrent: false, relation: 'contact' }),
    plan('acme', 'Acme Private', 'CUSTOM', { version: version(5000000, 300000), isCurrent: false, relation: 'upgrade' }),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  search.value = new URLSearchParams('');
  api.get.mockImplementation(async (url: string) => {
    if (url === '/billing/plans/available') return { data: available };
    if (url === '/billing/plans') return { data: { plans: [], features: [{ key: 'WEBHOOKS', name: 'Webhook events' }], topUps: [], creditRates: {} } };
    throw new Error(`unexpected GET ${url}`);
  });
  api.post.mockImplementation(async (url: string) => {
    if (url === '/billing/custom-plan/request') {
      return { data: { request: { id: 'req-1', ticketId: 'ticket-9', ticketNumber: 'PC-9', status: 'NEW', open: true, requestedAt: '' }, offers: [], created: true } };
    }
    throw new Error(`unexpected POST ${url}`);
  });
});

describe('Plans page', () => {
  it('renders plans from the API with relation-based actions and a comparison table', async () => {
    render(<PlansPage />);
    const growth = await screen.findByTestId('plan-card-growth');
    expect(growth.textContent).toContain('₹2,499 / month');
    expect(growth.textContent).toContain('12,000 credits included');
    expect(growth.textContent).toContain('Webhook events');
    expect(screen.getByTestId('plan-card-enterprise').textContent).toContain('Custom pricing');
    expect(screen.getByText('Your custom plans')).toBeTruthy();
    expect(screen.getByTestId('plan-card-acme').textContent).toContain('Custom plan');
    expect(screen.getByText('Current plan')).toBeTruthy();
    expect(screen.getByTestId('plan-comparison').textContent).toContain('Webhook events');

    fireEvent.click(growth.querySelector('button')!);
    expect(router.push).toHaveBeenCalledWith('/dashboard/billing/checkout?plan=growth');
  });

  it('"Talk to our team" posts a custom-plan request and opens the ticket', async () => {
    render(<PlansPage />);
    fireEvent.click(await screen.findByText('Talk to our team'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/dashboard/support/ticket-9'));
    expect(api.post).toHaveBeenCalledWith('/billing/custom-plan/request');
  });

  it('?custom=1 opens the conversation once automatically', async () => {
    search.value = new URLSearchParams('custom=1');
    const { rerender } = render(<PlansPage />);
    expect(screen.getByText('Opening a conversation with our team…')).toBeTruthy();
    rerender(<PlansPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard/support/ticket-9'));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('?plan=<slug> for an upgrade goes straight to the checkout review', async () => {
    search.value = new URLSearchParams('plan=growth');
    render(<PlansPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard/billing/checkout?plan=growth'));
  });
});
