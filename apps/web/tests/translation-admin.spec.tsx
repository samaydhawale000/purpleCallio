import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api, nav } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  nav: { push: vi.fn(), replace: vi.fn(), search: '' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => '/admin/billing',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('../app/lib/api', () => ({ api }));

import { CreditRatesTab } from '../app/admin/billing/_components/CreditRatesTab';
import { TranslationTab } from '../app/admin/billing/_components/TranslationTab';
import AdminBillingPage from '../app/admin/billing/page';
import { AdminAccessContext } from '../app/lib/admin-access';

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
  translationVoiceCreditsPerMinute: 450,
  translationCaptionsCreditsPerMinute: 60,
  translationMinimumCredits: null,
  postCallReportCredits: 100,
  signupFreeCredits: 500,
  signupFreeCreditsValidityDays: 30,
  translationProviderCostsPaise: { 'openai-translate': 300, 'soniox-voice': 150 },
  translationMarginWarnPercent: 40,
  translationDefaultMaxMinutes: 60,
  translationMaxBudgetCredits: 10000000,
};

const margin = {
  byRoute: [
    { route: 'openai-translate', minutes: 100, revenueCredits: 45000, revenueInr: 450, providerCostInr: 300, marginPercent: 33.3, warn: true },
    { route: 'sarvam-voice', minutes: 50, revenueCredits: 22500, revenueInr: 225, providerCostInr: 75, marginPercent: 66.7, warn: false },
  ],
  byPair: [],
  warnPercent: 40,
  usdInrRate: 95.16,
  defaultProviderCostsPaisePerMinute: { 'soniox-captions': 20, 'soniox-voice': 76 },
};

const overrides = [
  { userId: 'u1', user: { id: 'u1', email: 'ops@acme.com', name: 'Acme', companyName: 'Acme' }, voiceCreditsPerMinute: 400, captionsCreditsPerMinute: null, postCallReportCredits: null, note: 'Annual deal' },
];

function routes() {
  api.get.mockImplementation((url: string) => {
    if (url === '/admin/billing/credit-rates') return Promise.resolve({ data: config });
    if (url === '/admin/translation/margin') return Promise.resolve({ data: margin });
    if (url === '/admin/translation/overrides') return Promise.resolve({ data: overrides });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = '';
  routes();
});

describe('Credit rates — Live Translate group', () => {
  it('shows translation rates with a worked example and saves them (blank optional = null)', async () => {
    api.patch.mockResolvedValue({ data: config });
    render(<CreditRatesTab />);

    const group = await screen.findByTestId('translation-rates');
    expect(group.textContent).toContain('A 10-min call ≈ 4,500 credits one side, 9,000 both sides.');
    expect(screen.queryByLabelText(/Indian-language voice/)).toBeNull();
    expect(screen.getByText(/apply to new translation sessions only/)).toBeTruthy();
    expect(screen.getByText(/Customers are notified/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Voice translation \(credits \/ min\)/), { target: { value: '500' } });
    fireEvent.click(screen.getByText('Save credit rates'));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][0]).toBe('/admin/billing/credit-rates');
    expect(api.patch.mock.calls[0][1]).toMatchObject({
      translationVoiceCreditsPerMinute: 500,
      translationCaptionsCreditsPerMinute: 60,
      translationMinimumCredits: null,
      postCallReportCredits: 100,
      aiCreditsPerMinute: 15,
      signupFreeCredits: 500,
      signupFreeCreditsValidityDays: 30,
    });
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty('translationTrialMinutes');
    expect(screen.queryByLabelText(/Free trial minutes/)).toBeNull();
  });

  it('free credits for new accounts: calls only, blank validity = never expire', async () => {
    api.patch.mockResolvedValue({ data: config });
    render(<CreditRatesTab />);
    const panel = await screen.findByTestId('signup-credits');
    expect(screen.getByText(/pay for audio, video and screen share only/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Free credits for new accounts/), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText(/^Valid for \(days\)/), { target: { value: '' } });
    expect(panel).toBeTruthy();
    fireEvent.click(screen.getByText('Save credit rates'));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1]).toMatchObject({ signupFreeCredits: 1000, signupFreeCreditsValidityDays: null });
  });

  it('rejects a zero voice rate', async () => {
    render(<CreditRatesTab />);
    fireEvent.change(await screen.findByLabelText(/^Voice translation \(credits \/ min\)/), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Save credit rates'));
    expect(await screen.findByText('Voice translation must be a whole number of at least 1.')).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('Admin Live Translate tab', () => {
  it('shows provider costs, low-margin warnings and overrides; saves guardrails', async () => {
    api.patch.mockResolvedValue({ data: config });
    render(<TranslationTab />);

    const report = await screen.findByTestId('margin-report');
    expect(within(report).getByText('Low margin')).toBeTruthy();
    expect(within(report).getByRole('alert').textContent).toContain('below the 40% margin warning');
    expect(await screen.findByText('ops@acme.com')).toBeTruthy();

    expect(((await screen.findByLabelText('Cost for soniox-voice (paise)')) as HTMLInputElement).value).toBe('150');
    expect(screen.queryByLabelText('Cost for soniox-captions (paise)')).toBeNull(); // automatic, not frozen
    await waitFor(() => expect(screen.getByTestId('live-soniox-costs').textContent).toContain('₹95.16/$ today'));
    expect(screen.getByTestId('live-soniox-costs').textContent).toContain('voice 76 paise/min');
    expect(screen.queryByLabelText('Cost for openai-translate (paise)')).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Margin warning below \(\%\)/), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Live Translate settings' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1]).toEqual({
      translationProviderCostsPaise: { 'soniox-voice': 150 },
      translationMarginWarnPercent: 35,
      translationDefaultMaxMinutes: 60,
      translationMaxBudgetCredits: 10000000,
    });
  });

  it('adds a per-customer override with PUT', async () => {
    api.put.mockResolvedValue({ data: {} });
    render(<TranslationTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Add override/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Customer ID/), { target: { value: 'u2' } });
    fireEvent.change(within(dialog).getByLabelText('Captions (credits / min)'), { target: { value: '40' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save override' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/admin/translation/overrides/u2', {
        voiceCreditsPerMinute: null,
        captionsCreditsPerMinute: 40,
        postCallReportCredits: null,
        note: null,
      }),
    );
  });

  it('is read-only for admins without billing write access', async () => {
    render(
      <AdminAccessContext.Provider value={{ billing: 'READ' }}>
        <TranslationTab />
      </AdminAccessContext.Provider>,
    );
    expect(await screen.findByText('ops@acme.com')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add override/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit override/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Live Translate settings' })).toBeNull();
    expect(((await screen.findByLabelText(/^Margin warning below \(\%\)/)) as HTMLInputElement).disabled).toBe(true);
  });

  it('is reachable from the billing console tab list', async () => {
    nav.search = 'tab=translation';
    render(<AdminBillingPage />);
    expect(screen.getByRole('tab', { name: 'Live Translate' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByTestId('margin-report')).toBeTruthy();
  });
});
