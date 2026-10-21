import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/billing',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../app/lib/api', () => ({ api }));

import { CreditRatesTab } from '../app/admin/billing/_components/CreditRatesTab';
import { AiUsagePanel } from '../app/admin/billing/_components/AiUsagePanel';
import { CreditRateStrip } from '../app/components/PricingSection';
import { aiLedgerUsage, describeCreditTransaction, type CreditRates } from '../app/lib/billing';

beforeEach(() => vi.clearAllMocks());

const config = {
  id: 'c1',
  audioCreditsPerMinute: 1,
  videoCreditsPerMinute: 4,
  screenShareCreditsPerMinute: 1,
  aiCreditsPerMinute: 15,
  minimumCreditsToStartCall: 1,
  taxPercent: 18,
  lowCreditThresholds: [80, 90, 100],
  topUpExpiryPolicy: 'NEVER',
  topUpExpiryDays: null,
  renewalReminderDays: 7,
  pendingCheckoutTtlHours: 24,
};

describe('AI voice credit ledger rows', () => {
  const row = {
    type: 'USAGE_DEBIT' as const,
    amount: -23,
    referenceType: 'AI_SESSION',
    referenceId: 'session-1',
    metadata: { sessionId: 'session-1', aiSeconds: 90, aiMinutes: 1.5, aiCredits: 23, shortfall: 0 },
  };

  it('reads as "AI voice call: M min, C credits"', () => {
    expect(describeCreditTransaction(row)).toBe('AI voice call: 1.5 min, 23 credits');
    expect(aiLedgerUsage(row)).toEqual({ minutes: 1.5, credits: 23 });
  });

  it('shows the credits actually debited when the balance ran out', () => {
    const partial = { ...row, amount: -10, metadata: { ...row.metadata, aiMinutes: 2, aiCredits: 30, shortfall: 20 } };
    expect(describeCreditTransaction(partial)).toBe('AI voice call: 2 min, 10 credits');
  });

  it('leaves human-call rows unchanged', () => {
    const human = {
      type: 'USAGE_DEBIT' as const,
      amount: -4,
      referenceType: 'Call',
      referenceId: 'call-123456789012',
      metadata: { callId: 'call-123456789012', audioMinutes: 3.5, audioCredits: 4 },
    };
    expect(aiLedgerUsage(human)).toBeNull();
    expect(describeCreditTransaction(human)).not.toMatch(/AI voice/);
  });
});

describe('AI voice rate', () => {
  it('is editable in the admin credit rates tab and saved with the other rates', async () => {
    api.get.mockResolvedValue({ data: config });
    api.patch.mockResolvedValue({ data: config });
    render(<CreditRatesTab />);

    const input = await screen.findByLabelText(/^AI voice \(credits \/ call-min\)/);
    expect((input as HTMLInputElement).value).toBe('15');
    fireEvent.change(input, { target: { value: '18' } });
    fireEvent.click(screen.getByText('Save credit rates'));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1]).toMatchObject({ aiCreditsPerMinute: 18, videoCreditsPerMinute: 4 });
  });

  it('rejects an AI rate below 1', async () => {
    api.get.mockResolvedValue({ data: config });
    render(<CreditRatesTab />);

    fireEvent.change(await screen.findByLabelText(/^AI voice \(credits \/ call-min\)/), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Save credit rates'));

    expect(await screen.findByText('AI voice must be at least 1 credit per minute.')).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('is listed with the media rates on the pricing page', () => {
    render(<CreditRateStrip rates={config as unknown as CreditRates} />);
    expect(screen.getByTestId('ai-rate').textContent).toContain('AI voice15 credits/min');
    expect(screen.getByTestId('ai-rate').textContent).toContain('paid plans');
  });

  it('estimates a one-to-one call, with screen sharing only as an add-on', () => {
    render(<CreditRateStrip rates={config as unknown as CreditRates} />);
    // No participants slider. Default: 2 people × 30 min video at 4 credits/min.
    expect(screen.queryByLabelText(/Participants/)).toBeNull();
    expect(screen.getByText('2 people × 30 min video × 4')).toBeTruthy();
    expect(screen.getByText(/credits per call/).parentElement!.textContent).toContain('240');

    fireEvent.change(screen.getByLabelText(/Call length/), { target: { value: '10' } });
    expect(screen.getByText(/credits per call/).parentElement!.textContent).toContain('80');

    // Screen sharing adds the sharer's minutes on top of the call: 80 + 10 × 1.
    fireEvent.click(screen.getByText('Screen share').closest('button')!);
    expect(screen.getByText('1 sharer × 10 min screen share × 1')).toBeTruthy();
    expect(screen.getByText(/credits per call/).parentElement!.textContent).toContain('90');

    // AI is per call minute (10 × 15) and can't have screen sharing.
    fireEvent.click(screen.getByTestId('ai-rate'));
    expect(screen.getByText('10 AI call min × 15')).toBeTruthy();
    expect(screen.queryByText(/screen share ×/)).toBeNull();
    expect(screen.getByText('Screen share').closest('button')!.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/credits per call/).parentElement!.textContent).toContain('150');
  });

  it('lets visitors pick a plan and see how many calls its credits cover', () => {
    const plan = (id: string, name: string, type: string, credits: number) =>
      ({ id, slug: id, name, type, displayOrder: 0, customPricing: false, version: { includedCredits: credits, billingInterval: 'MONTH', intervalCount: 1, features: [] } }) as never;
    const plans = [plan('free', 'Free', 'FREE', 1000), plan('starter', 'Starter', 'PAID', 6000), plan('growth', 'Growth', 'PAID', 20000)];
    render(<CreditRateStrip rates={config as unknown as CreditRates} plans={plans} />);
    // 2 people × 30 min video × 4 = 240 credits; the smallest paid plan is the default.
    expect(screen.getByRole('radio', { name: 'Starter' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('plan-coverage').textContent).toContain('≈ 25');
    fireEvent.click(screen.getByRole('radio', { name: 'Growth' }));
    expect(screen.getByTestId('plan-coverage').textContent).toContain("Growth's 20,000 credits");
    expect(screen.getByTestId('plan-coverage').textContent).toContain('≈ 83');
    // AI on the Free plan isn't possible.
    fireEvent.click(screen.getByRole('radio', { name: 'Free' }));
    fireEvent.click(screen.getByTestId('ai-rate'));
    expect(screen.getByText(/AI voice agents need a paid plan/)).toBeTruthy();
    expect(screen.queryByTestId('plan-coverage')).toBeNull();
  });
});

describe('Admin AI usage', () => {
  it('shows minutes, credits, provider cost and margin for the range', async () => {
    api.get.mockResolvedValue({
      data: {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
        sessions: 3,
        minutes: 12.5,
        creditsCharged: 188,
        creditsShortfall: 0,
        inputTokens: 40_000,
        outputTokens: 20_000,
        providerCostPaise: 3_168,
        creditValuePaise: 45,
        creditValueSource: 'topup',
        revenuePaise: 8_460,
        marginPaise: 5_292,
        marginPercent: 62.55,
        usdInrRate: 88,
        currency: 'INR',
      },
    });
    render(<AiUsagePanel />);

    const summary = await screen.findByTestId('ai-usage-summary');
    expect(summary.textContent).toContain('12.5');
    expect(summary.textContent).toContain('188');
    expect(summary.textContent).toContain('₹31.68');
    expect(summary.textContent).toContain('₹52.92');
    expect(summary.textContent).toContain('62.55%');
    expect(api.get).toHaveBeenCalledWith('/admin/billing/ai-usage', {
      params: { from: expect.stringMatching(/^\d{4}-\d{2}-01$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
  });
});
