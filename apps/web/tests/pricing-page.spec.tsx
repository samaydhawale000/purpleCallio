import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { api, serverPricing } = vi.hoisted(() => ({ api: { get: vi.fn() }, serverPricing: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('../app/lib/api', () => ({ api }));
// Server fetch unavailable by default: the page falls back to loading in the browser.
vi.mock('../app/lib/public-pricing-server', () => ({ getServerPricing: serverPricing }));

import PricingPage from '../app/pricing/page';
import { resetPublicPricingCache } from '../app/lib/public-pricing';
import { useAuthStore } from '../app/store/auth.store';

const rates = { audioCreditsPerMinute: 1, videoCreditsPerMinute: 3, screenShareCreditsPerMinute: 2, aiCreditsPerMinute: 10, taxPercent: 18 };
const publishedPrice = {
  id: 'price-1', version: 2, currency: 'INR', creditPricePaise: 20,
  minimumPurchasePaise: 10_000, maximumPurchasePaise: 100_000,
  minimumCredits: 500, maximumCredits: 5_000, purchasedValidityDays: 365,
};

beforeEach(() => {
  vi.clearAllMocks();
  serverPricing.mockResolvedValue({});
  resetPublicPricingCache();
  useAuthStore.setState({ token: null, refreshToken: null, user: null, hasHydrated: true } as never);
});

describe('public prepaid pricing page', () => {
  it('renders published wallet pricing and usage rates, not subscription cards', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/billing/credit-rates') return Promise.resolve({ data: rates });
      if (url === '/billing/credit-pricing/current') return Promise.resolve({ data: publishedPrice });
      return Promise.reject(new Error(`unexpected endpoint: ${url}`));
    });
    render(await PricingPage());

    await screen.findByTestId('prepaid-pricing-feature');
    expect(screen.getByText('Pricing that moves with your usage.')).toBeTruthy();
    expect(screen.getByTestId('credit-price').textContent).toContain('₹0.20 per credit');
    expect(screen.queryByTestId('buy-credits')).toBeNull();
    expect(screen.queryByTestId('credit-rate-strip')).toBeNull();
    expect(screen.queryByText(/Starter|Growth|Business/)).toBeNull();
    expect(screen.getByRole('link', { name: /^Create an account$/i }).getAttribute('href')).toBe('/signup');
  });

  it('uses the wallet purchase route for an authenticated visitor', async () => {
    useAuthStore.setState({ token: 'jwt' } as never);
    api.get.mockImplementation((url: string) => Promise.resolve({ data: url === '/billing/credit-rates' ? rates : publishedPrice }));
    render(await PricingPage());
    // The signed-in link switches in after mount (server HTML is the signed-out version).
    const cta = await screen.findByTestId('pricing-primary-cta');
    await waitFor(() => expect(cta.getAttribute('href')).toBe('/dashboard/billing/credits#topups'));
  });

  it('does not invent a price when published pricing is unavailable', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve({ data: url === '/billing/credit-rates' ? rates : null }));
    render(await PricingPage());
    await screen.findByTestId('credit-price');
    expect(screen.getByTestId('credit-price').textContent).toMatch(/published soon/i);
  });

  it('shows a retryable error if live usage rates cannot be loaded', async () => {
    api.get.mockRejectedValue(new Error('down'));
    render(await PricingPage());
    expect(await screen.findByText('Current credit pricing is temporarily unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it('server-rendered rates: content and pricing answers without waiting for the browser', async () => {
    serverPricing.mockResolvedValue({ rates: { creditRates: rates }, credit: publishedPrice });
    api.get.mockReturnValue(new Promise(() => {}));
    render(await PricingPage());
    expect(screen.getByTestId('credit-price').textContent).toContain('₹0.20 per credit');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pricing that moves with your usage.');
    expect(screen.getByText(/audio 1 credit \(about ₹0\.20\), video 3 credits \(about ₹0\.60\)/)).toBeTruthy();
    expect(screen.getByText(/Free credits cover audio, video and screen share only/)).toBeTruthy();
  });
});
