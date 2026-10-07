import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/pricing',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('../app/lib/api', () => ({ api }));

import PricingPage from '../app/pricing/page';
import { resetPublicPricingCache } from '../app/lib/public-pricing';
import { useAuthStore } from '../app/store/auth.store';

function plan(over: Record<string, unknown>, version: Record<string, unknown> | null) {
  return {
    description: null,
    badge: null,
    type: 'PAID',
    status: 'ACTIVE',
    isPopular: false,
    isPublic: true,
    ctaLabel: null,
    ctaAction: 'CHECKOUT',
    customPricing: false,
    ...over,
    version: version && {
      id: `${over.id}-v1`,
      version: 1,
      currency: 'INR',
      billingInterval: 'MONTH',
      intervalCount: 1,
      includedAudioCredits: null,
      includedVideoCredits: null,
      includedScreenShareCredits: null,
      features: [],
      ...version,
    },
  };
}

// Deliberately unusual numbers so nothing can pass by matching a hard-coded value.
const pricing = {
  plans: [
    plan(
      { id: 'p-growth', slug: 'growth', name: 'Growth', displayOrder: 3, isPopular: true, badge: 'Best value' },
      { pricePaise: 789_900, includedCredits: 43_210, features: ['HOSTED_UI', 'WEBHOOKS'] },
    ),
    plan(
      { id: 'p-free', slug: 'free', name: 'Free', type: 'FREE', displayOrder: 1, ctaAction: 'SIGNUP', ctaLabel: 'Start free' },
      { pricePaise: 0, includedCredits: 1_234, features: ['HOSTED_UI'] },
    ),
    plan(
      { id: 'p-starter', slug: 'starter', name: 'Starter', displayOrder: 2 },
      { pricePaise: 123_400, includedCredits: 9_876, features: ['HOSTED_UI'] },
    ),
    plan(
      { id: 'p-custom', slug: 'custom', name: 'Custom', type: 'CUSTOM', displayOrder: 9, ctaAction: 'CONTACT_SALES', customPricing: true },
      { pricePaise: 0, includedCredits: 0, features: [] },
    ),
  ],
  features: [
    { key: 'HOSTED_UI', name: 'Hosted meeting UI', description: null, category: 'Platform' },
    { key: 'WEBHOOKS', name: 'Webhook events', description: null, category: 'Platform' },
  ],
  topUps: [
    { id: 't1', name: 'Boost pack', description: null, pricePaise: 55_500, currency: 'INR', credits: 7_777, status: 'ACTIVE', displayOrder: 1, isPopular: false },
  ],
  creditRates: {
    audioCreditsPerMinute: 1,
    videoCreditsPerMinute: 3,
    screenShareCreditsPerMinute: 2,
    taxPercent: 17,
    topUpExpiryPolicy: 'DAYS',
    topUpExpiryDays: 45,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPublicPricingCache();
  useAuthStore.setState({ token: null, refreshToken: null, user: null, hasHydrated: true } as never);
});

describe('public pricing page', () => {
  it('shows no prices or credit numbers while plans are loading', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<PricingPage />);
    expect(api.get).toHaveBeenCalledWith('/billing/plans');
    expect(screen.getByText('Loading current plans…')).toBeTruthy();
    expect(container.textContent).not.toMatch(/₹/);
    expect(container.textContent).not.toMatch(/credits included/);
  });

  it('renders plans, prices, credits, features and rates from the API response', async () => {
    api.get.mockResolvedValue({ data: pricing });
    render(<PricingPage />);

    await screen.findByTestId('plan-card-growth');
    const cards = screen.getAllByTestId(/^plan-card-/).map((el) => el.getAttribute('data-testid'));
    expect(cards).toEqual(['plan-card-free', 'plan-card-starter', 'plan-card-growth', 'plan-card-custom']);

    const free = screen.getByTestId('plan-card-free');
    expect(within(free).getByText('₹0')).toBeTruthy();
    expect(within(free).getByText('Start free').getAttribute('href')).toBe('/signup');

    const growth = screen.getByTestId('plan-card-growth');
    expect(within(growth).getByText('₹7,899')).toBeTruthy();
    expect(within(growth).getByText('Best value')).toBeTruthy();
    expect(growth.textContent).toContain('43,210');
    expect(within(growth).getByText('Webhook events')).toBeTruthy();
    expect(within(growth).getByText('Choose Growth').getAttribute('href')).toBe('/signup?plan=growth');

    const custom = screen.getByTestId('plan-card-custom');
    expect(within(custom).getByText('Custom pricing')).toBeTruthy();
    expect(within(custom).getByText('Talk to us').getAttribute('href')).toBe('/signup?intent=custom');

    // Credit explainer computed from API rates: 2 × 10 min video × 3 credits = 60.
    expect(screen.getByText(/1 video participant-minute =/).textContent).toContain('3');
    expect(screen.getAllByText(/60 credits/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Prices exclude GST \(17%\), added at checkout\./).length).toBeGreaterThan(0);

    // Top-ups and comparison table.
    expect(within(screen.getByTestId('topup-t1')).getByText('₹555')).toBeTruthy();
    expect(screen.getAllByText(/45 days after purchase/).length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: 'Plan comparison' });
    expect(within(table).getByText('Hosted meeting UI')).toBeTruthy();
    expect(within(table).queryByText(/Participants per call|Concurrent calls|On request/)).toBeNull();
  });

  it('sends logged-in visitors to the dashboard plan and custom-plan flows', async () => {
    useAuthStore.setState({ token: 'jwt' } as never);
    api.get.mockResolvedValue({ data: pricing });
    render(<PricingPage />);
    const growth = await screen.findByTestId('plan-card-growth');
    expect(within(growth).getByText('Choose Growth').getAttribute('href')).toBe('/dashboard/billing/plans?plan=growth');
    const custom = screen.getByTestId('plan-card-custom');
    expect(within(custom).getByText('Talk to us').getAttribute('href')).toBe('/dashboard/billing/plans?custom=1');
  });

  it('recommends the smallest plan whose included credits cover the estimate', async () => {
    api.get.mockResolvedValue({ data: pricing });
    render(<PricingPage />);
    await screen.findByTestId('estimated-credits');

    const set = (label: string, value: number) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
    // 100 calls × 2 people × 10 min = 2,000 participant-minutes, all audio = 2,000 credits → Starter (9,876).
    set('Calls per month', 100);
    set('Average call length (minutes)', 10);
    set('% of participant-minutes with video', 0);
    set('% of call time with screen sharing', 0);
    expect(screen.getByTestId('estimated-credits').textContent).toBe('2,000');
    expect(screen.getByTestId('plan-recommendation').textContent).toContain('Starter');

    // All video: 2,000 × 3 = 6,000 → still Starter; 10× the calls = 60,000 → beyond Growth → Custom.
    set('% of participant-minutes with video', 100);
    expect(screen.getByTestId('estimated-credits').textContent).toBe('6,000');
    set('Calls per month', 1000);
    expect(screen.getByTestId('estimated-credits').textContent).toBe('60,000');
    expect(screen.getByTestId('plan-recommendation').textContent).toContain('custom pricing');
  });

  it('shows an error state with retry instead of fabricated prices', async () => {
    api.get.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: pricing });
    const { container } = render(<PricingPage />);
    await screen.findByText('Current plans are temporarily unavailable.');
    expect(container.textContent).not.toMatch(/₹/);
    fireEvent.click(screen.getAllByRole('button', { name: /Retry/ })[0]);
    await waitFor(() => expect(screen.getByTestId('plan-card-free')).toBeTruthy());
  });
});
