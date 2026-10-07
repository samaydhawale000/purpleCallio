import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const { router, api, runCheckout, search } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  runCheckout: vi.fn(),
  search: { value: new URLSearchParams('plan=plan-growth') },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/billing/checkout',
  useSearchParams: () => search.value,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../app/lib/api', () => ({ api }));
vi.mock('../app/lib/checkout', () => ({ runCheckout }));
vi.mock('../app/hooks/useRequireAuth', () => ({ useRequireAuth: () => ({ isAuthed: true, isReady: true }) }));

import CheckoutPage from '../app/dashboard/billing/checkout/page';

const planQuote = {
  purpose: 'SUBSCRIPTION_PURCHASE',
  description: 'Growth plan',
  credits: 12000,
  currency: 'INR',
  subtotalPaise: 249900,
  discountPercent: 10,
  discountPaise: 24990,
  discountReason: 'Startup programme',
  taxPercent: 18,
  taxPaise: 40484,
  totalPaise: 265394,
  lineItems: [],
  summary: { type: 'plan', planName: 'Growth', intervalLabel: 'month', includedCredits: 12000, features: ['WEBHOOKS'] },
};

const topUpQuote = {
  ...planQuote,
  purpose: 'TOPUP',
  description: '5,000 credits',
  credits: 5000,
  discountPercent: null,
  discountPaise: 0,
  discountReason: null,
  subtotalPaise: 50000,
  taxPaise: 9000,
  totalPaise: 59000,
  summary: { type: 'topup', name: 'Booster', credits: 5000 },
};

function mockApi(quote: unknown) {
  api.post.mockImplementation(async (url: string) => {
    if (url === '/billing/checkout/quote') return { data: quote };
    throw new Error(`unexpected POST ${url}`);
  });
  api.get.mockImplementation(async (url: string) => {
    if (url === '/billing/plans') return { data: { plans: [], features: [{ key: 'WEBHOOKS', name: 'Webhook events' }], topUps: [], creditRates: {} } };
    throw new Error(`unexpected GET ${url}`);
  });
}

const outcome = (o: Record<string, unknown> = {}) => ({
  paymentId: 'pay-1',
  status: 'PAID',
  purpose: 'SUBSCRIPTION_PURCHASE',
  description: 'Growth plan',
  amountPaise: 265394,
  currency: 'INR',
  credits: 12000,
  failureReason: null,
  receiptNumber: 7,
  subscription: { id: 'sub-1', planName: 'Growth', status: 'ACTIVE', currentPeriodEnd: '2026-11-07T00:00:00.000Z' },
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  search.value = new URLSearchParams('plan=plan-growth');
});

describe('Checkout', () => {
  it('shows the server-computed totals and pays the quoted amount', async () => {
    mockApi(planQuote);
    render(<CheckoutPage />);

    const totals = await screen.findByTestId('checkout-totals');
    expect(api.post).toHaveBeenCalledWith('/billing/checkout/quote', { kind: 'plan', planId: 'plan-growth' });
    expect(totals.textContent).toContain('₹2,499.00');
    expect(totals.textContent).toContain('Discount (10%) — Startup programme');
    expect(totals.textContent).toContain('GST (18%)');
    expect(screen.getByTestId('checkout-total').textContent).toBe('₹2,653.94');
    expect(screen.getByTestId('checkout-summary').textContent).toContain('Webhook events');
    expect(screen.getAllByText(/one-time payment/i).length).toBeGreaterThan(0);

    runCheckout.mockResolvedValue({ kind: 'paid', outcome: outcome() });
    fireEvent.click(screen.getByText('Pay ₹2,653.94'));

    expect(await screen.findByText('Payment successful')).toBeTruthy();
    expect(runCheckout).toHaveBeenCalledWith({ kind: 'plan', planId: 'plan-growth' });
    expect(screen.getByText('You’re now on Growth.')).toBeTruthy();
    expect(screen.getByText('12,000 credits have been added to your account.')).toBeTruthy();
  });

  it('shows the failure state with Try again', async () => {
    mockApi(planQuote);
    render(<CheckoutPage />);
    await screen.findByTestId('checkout-totals');

    runCheckout.mockResolvedValue({ kind: 'failed', outcome: null, message: 'Card declined' });
    fireEvent.click(screen.getByText('Pay ₹2,653.94'));

    expect(await screen.findByText('Payment failed. Your subscription has not been activated.')).toBeTruthy();
    expect(screen.getByText('Card declined')).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByTestId('checkout-totals')).toBeTruthy();
  });

  it('top-up success says how many credits were added', async () => {
    search.value = new URLSearchParams('topup=tp-1');
    mockApi(topUpQuote);
    render(<CheckoutPage />);
    await screen.findByTestId('checkout-totals');
    expect(api.post).toHaveBeenCalledWith('/billing/checkout/quote', { kind: 'topup', topUpPackageId: 'tp-1' });

    runCheckout.mockResolvedValue({ kind: 'paid', outcome: outcome({ purpose: 'TOPUP', credits: 5000, subscription: null }) });
    fireEvent.click(screen.getByText('Pay ₹590.00'));
    expect(await screen.findByText('5,000 credits added to your account.')).toBeTruthy();
  });

  it('shows the pending state and returns to review when dismissed', async () => {
    mockApi(planQuote);
    render(<CheckoutPage />);
    await screen.findByTestId('checkout-totals');

    runCheckout.mockResolvedValueOnce({ kind: 'dismissed', session: {} });
    fireEvent.click(screen.getByText('Pay ₹2,653.94'));
    expect(await screen.findByText(/You have not been charged/)).toBeTruthy();

    runCheckout.mockResolvedValueOnce({ kind: 'pending', outcome: outcome({ status: 'PENDING' }) });
    fireEvent.click(screen.getByText('Pay ₹2,653.94'));
    expect(await screen.findByText('We’re confirming your payment…')).toBeTruthy();
  });
});
