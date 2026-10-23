import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/features/live-translation' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../app/lib/api', () => ({ api }));

import LiveTranslationPage from '../app/features/live-translation/page';
import FeaturesPage from '../app/features/page';
import { LiveTranslateSection } from '../app/components/marketing/live-translate/LiveTranslateSection';
import { LiveTranslateDoc } from '../app/components/marketing/LiveTranslateDoc';
import { LIVE_TRANSLATE_FEATURES } from '../app/lib/live-translate';
import { resetTranslationRatesCache } from '../app/lib/live-translate-api';

const FORBIDDEN = [
  /100\s*%\s*accura/i,
  /zero\s+latency/i,
  /under\s+(1|one)\s+second/i,
  /zero\s+hallucination/i,
  /detects every error/i,
  /\d+(\.\d+)?\s*%\s*(accura|confiden|precis|correct)/i,
  /(accura\w*|confidence)\s*(of|:)?\s*\d+(\.\d+)?\s*%/i,
];

function assertHonest(text: string) {
  for (const re of FORBIDDEN) expect(text).not.toMatch(re);
}

const BRANDS = [
  ['DualView Translation', 'Original and translated captions, side by side'],
  ['PurpleLex', 'Custom business vocabulary for translation'],
  ['MeaningGuard', 'Misunderstanding detection and recovery'],
  ['Translation Observability', 'Latency, quality and cost metrics for translation'],
  ['CostGuard', 'Usage budgets and cost limits for AI calls'],
  ['Post-Call Suite', 'Multilingual transcript, summary and action items after every call'],
  ['Translation UI Kit', 'Drop-in multilingual call components'],
];

beforeEach(() => {
  api.get.mockReset();
  resetTranslationRatesCache();
});

describe('Live Translate feature page', () => {
  it('renders the seven features with brand name and plain description', () => {
    api.get.mockRejectedValue(new Error('offline'));
    render(<LiveTranslationPage />);
    expect(LIVE_TRANSLATE_FEATURES).toHaveLength(7);
    for (const [brand, description] of BRANDS) {
      const id = LIVE_TRANSLATE_FEATURES.find((f) => f.brand === brand)!.id;
      const block = screen.getByTestId(`lt-feature-${id}`);
      expect(within(block).getByRole('heading', { name: brand })).toBeTruthy();
      expect(within(block).getByText(description)).toBeTruthy();
    }
  });

  it('shows the Early access badge and makes no forbidden accuracy or latency claims', () => {
    api.get.mockRejectedValue(new Error('offline'));
    const { container } = render(<LiveTranslationPage />);
    expect(screen.getByTestId('early-access-badge').textContent).toMatch(/Early access/);
    assertHonest(container.textContent ?? '');
  });

  it('describes original-audio replay as off by default', () => {
    api.get.mockRejectedValue(new Error('offline'));
    render(<LiveTranslationPage />);
    expect(screen.getByTestId('lt-privacy').textContent).toMatch(/Replay of the original audio is off by default/);
  });

  it('falls back to "Pricing set at launch" and the validating language list when the API is unavailable', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    render(<LiveTranslationPage />);
    await waitFor(() => expect(within(screen.getByTestId('translation-rates')).getAllByText('Pricing set at launch')).toHaveLength(2));
    expect(screen.getByTestId('language-grid').textContent).toMatch(/Voice availability is being validated/);
    expect(screen.getByText(/Based on public documentation as of Oct 2026; verify before relying on it\./)).toBeTruthy();
  });

  it('shows live rates and languages from the public endpoints', async () => {
    api.get.mockImplementation((url: string, opts?: { params?: { mode?: string } }) => {
      if (url === '/translation/estimate') {
        const mode = opts?.params?.mode;
        return Promise.resolve({ data: { mode, ratePerMinute: mode === 'voice' ? 437 : 53, creditsPerCall: 0, totalCredits: 0, approxInrPerCall: null, note: null } });
      }
      if (url === '/translation/languages') {
        return Promise.resolve({ data: { languages: [{ code: 'mr', name: 'Marathi', nativeName: 'मराठी', voice: false, captions: true }] } });
      }
      return Promise.reject(new Error('unexpected'));
    });
    render(<LiveTranslationPage />);
    const rates = screen.getByTestId('translation-rates');
    await waitFor(() => expect(within(rates).getByText('437 credits')).toBeTruthy());
    expect(within(rates).getByText('53 credits')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('language-grid').textContent).toMatch(/Live list/));
    expect(within(screen.getByTestId('language-grid')).getByText('मराठी')).toBeTruthy();
  });
});

describe('homepage Live Translate section', () => {
  it('has the early-access badge, seven feature cards and both CTAs', () => {
    const { container } = render(<LiveTranslateSection />);
    expect(screen.getByText('Live Translate: talk to anyone, in their language')).toBeTruthy();
    expect(screen.getAllByText(/Early access/).length).toBeGreaterThan(0);
    for (const f of LIVE_TRANSLATE_FEATURES) {
      const card = screen.getByTestId(`lt-card-${f.id}`);
      expect(within(card).getByText(f.brand)).toBeTruthy();
      expect(within(card).getByText(f.description)).toBeTruthy();
    }
    expect(screen.getByText(/Explore Live Translate/).closest('a')?.getAttribute('href')).toBe('/features/live-translation');
    expect(screen.getByText('Join early access').closest('a')?.getAttribute('href')).toBe('/signup?intent=live-translate');
    assertHonest(container.textContent ?? '');
  });
});

describe('features overview', () => {
  it('links to the Live Translate page as a separate New card', () => {
    render(<FeaturesPage />);
    const card = screen.getByTestId('feature-card-live-translation');
    expect(card.getAttribute('href')).toBe('/features/live-translation');
    expect(card.textContent).toMatch(/New/);
    expect(card.textContent).toMatch(/Early access/);
  });
});

describe('Live Translate docs', () => {
  it('documents replay as off by default and never uses confidence percentages', () => {
    const { container } = render(<LiveTranslateDoc />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Replay of the original audio is off by default/);
    expect(text).toMatch(/can\s+still be wrong/);
    assertHonest(text);
  });
});
