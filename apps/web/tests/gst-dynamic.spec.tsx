import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/faq', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../app/lib/api', () => ({ api }));

import FaqPage from '../app/faq/page';
import { GstRate } from '../app/components/GstRate';
import { resetPublicPricingCache } from '../app/lib/public-pricing';

const pricing = (taxPercent: number) => ({
  data: {
    plans: [],
    features: [],
    topUps: [],
    creditRates: { audioCreditsPerMinute: 1, videoCreditsPerMinute: 3, screenShareCreditsPerMinute: 1, taxPercent, topUpExpiryPolicy: 'NEVER', topUpExpiryDays: null },
  },
});

describe('GST comes from the admin setting', () => {
  it('shows the configured rate in the FAQ answer', async () => {
    resetPublicPricingCache();
    api.get.mockResolvedValue(pricing(12));
    render(<FaqPage />);
    fireEvent.click(await screen.findByText('Is GST included in plan prices?'));
    expect(await screen.findByText(/GST at 12% is added at checkout/)).toBeTruthy();
  });

  it('GstRate renders the live rate, with a fallback while loading', async () => {
    resetPublicPricingCache();
    api.get.mockResolvedValue(pricing(5));
    render(
      <p>
        GST <GstRate fallback="at checkout" />
      </p>,
    );
    expect(screen.getByText('GST at checkout')).toBeTruthy();
    expect(await screen.findByText('GST 5%')).toBeTruthy();
  });
});
