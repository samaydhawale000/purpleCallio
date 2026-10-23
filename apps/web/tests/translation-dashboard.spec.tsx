import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { api, nav } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  nav: { push: vi.fn(), replace: vi.fn(), params: { callId: 'call-1' } as Record<string, string>, pathname: '/dashboard/translation' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useParams: () => nav.params,
  usePathname: () => nav.pathname,
}));
vi.mock('../app/lib/api', () => ({ api }));

import { checkLexiconCsv, humanizeGuardReason, translatedCallCredits } from '../app/lib/translation';
import { buildSettingsPatch, toForm } from '../app/dashboard/translation/_components/settings-form';
import OverviewPage from '../app/dashboard/translation/page';
import SettingsPage from '../app/dashboard/translation/settings/page';
import LexiconsPage from '../app/dashboard/translation/lexicons/page';
import ReportPage from '../app/dashboard/translation/calls/[callId]/page';
import { TranslationUsageSection } from '../app/dashboard/translation/_components/TranslationUsageSection';

const P = '/dashboard/translation/projects/p1';
const projects = [{ id: 'p1', name: 'Clinic app' }];

const settings = {
  projectId: 'p1',
  replayEnabled: false,
  postCallReportEnabled: true,
  sentimentEnabled: true,
  transcriptRetentionDays: 30,
  industry: null,
  defaultLexiconId: null,
  defaultMaxMinutes: null,
  dailyBudgetCredits: null,
  monthlyBudgetCredits: null,
  alertThresholds: [50, 80, 100],
  onLimit: 'captions_then_off',
};

const metrics = {
  totals: { calls: 12, sessions: 24, voiceMinutes: 90, captionsMinutes: 30, credits: 42000, avgCreditsPerCallMinute: 350, approxInrPerCallMinute: 3.5 },
  latency: { firstAudioMsP50: 820, firstAudioMsP95: 1900, captionDelayMsP50: 400, captionDelayMsP95: 900 },
  reliability: { providerFailures: 1, fallbacks: 2, droppedFrames: 5, failedSessions: 0 },
  guard: { phrases: 200, flags: 6, flagRate: 0.03, byReason: { 'term_mismatch:amount': 4, poor_audio: 2 }, replays: 3, repeats: 1, lexiconHits: 17 },
  byPair: [{ pair: 'mr-en', route: 'sarvam', sessions: 10, minutes: 60, firstAudioMsP50: 700, flagRate: 0.02 }],
  benchmarks: [{ pair: 'hi-en', route: 'openai-translate', termPreservation: null, note: 'pending Phase 0' }],
};

function routes(map: Record<string, unknown>) {
  api.get.mockImplementation((url: string) => {
    if (url in map) {
      const v = map[url];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve({ data: v });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.params = { callId: 'call-1' };
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('lib/translation helpers', () => {
  it('humanizes MeaningGuard reasons without percentages', () => {
    expect(humanizeGuardReason('term_mismatch:amount')).toBe('An amount may not match');
    expect(humanizeGuardReason('low_asr_confidence')).toBe('Speech was hard to make out');
    expect(humanizeGuardReason('something_new:here')).toBe('Something new here');
    expect(humanizeGuardReason('poor_audio')).not.toMatch(/%|confiden/i);
  });

  it('prices a two-way translated call per listener direction', () => {
    expect(translatedCallCredits(10, 450)).toBe(9000);
    expect(translatedCallCredits(0, 450)).toBe(0);
  });

  it('validates lexicon CSV', () => {
    expect(checkLexiconCsv('term,kind,lang:hi\nInvoice,TRANSLATE_AS,चालान')).toEqual({ rows: 1, languages: ['hi'] });
    expect(checkLexiconCsv('kind,term\nx,y')).toEqual({ error: 'The first column must be "term".' });
    expect(checkLexiconCsv('term,kind')).toEqual({ error: 'The CSV has a header but no terms.' });
  });

  it('forces tone off for healthcare and validates budgets', () => {
    const f = toForm({ ...settings, industry: 'healthcare' } as never);
    expect(f.sentimentEnabled).toBe(false);
    const body = buildSettingsPatch({ ...f, sentimentEnabled: true });
    expect(body).toMatchObject({ sentimentEnabled: false, industry: 'healthcare' });
    expect(buildSettingsPatch({ ...f, dailyBudgetCredits: '500', monthlyBudgetCredits: '100' })).toBe(
      'The daily budget cannot be more than the monthly budget.',
    );
    expect(buildSettingsPatch({ ...f, alertThresholds: '50, 150' })).toMatch(/between 1 and 100/);
  });
});

describe('Live Translate overview', () => {
  it('shows observability metrics with humanized flags and a pending benchmark state', async () => {
    routes({ '/projects': projects, [`${P}/metrics`]: metrics });
    render(<OverviewPage />);

    expect(await screen.findByTestId('translation-metrics')).toBeTruthy();
    expect(screen.getByTestId('tile-first-audio').textContent).toContain('820 ms');
    expect(screen.getByTestId('tile-first-audio').textContent).toContain('1.9 s');
    expect(screen.getByTestId('tile-cost').textContent).toContain('350 credits');
    expect(screen.getByTestId('tile-cost').textContent).toContain('₹3.50');
    const reasons = screen.getByTestId('guard-reasons');
    expect(within(reasons).getByText('An amount may not match')).toBeTruthy();
    expect(reasons.textContent).not.toMatch(/accurate %|confidence/i);
    expect(screen.getByTestId('benchmarks').textContent).toMatch(/pending Phase 0/i);
    expect(api.get).toHaveBeenCalledWith(`${P}/metrics`, { params: expect.objectContaining({ from: expect.any(String), to: expect.any(String) }) });
  });

  it('shows a stable error message when metrics fail', async () => {
    routes({ '/projects': projects, [`${P}/metrics`]: Object.assign(new Error('x'), { response: { status: 403, data: { code: 'TRANSLATION_NOT_IN_PLAN' } } }) });
    render(<OverviewPage />);
    expect(await screen.findByText('Live Translate is not included in your plan. Upgrade to use it.')).toBeTruthy();
  });

  it('asks for a project when there are none', async () => {
    routes({ '/projects': [] });
    render(<OverviewPage />);
    expect(await screen.findByText('Create a project first')).toBeTruthy();
  });
});

describe('Live Translate settings', () => {
  it('explains replay, disables tone for healthcare and saves the patch', async () => {
    routes({ '/projects': projects, [`${P}/settings`]: settings, [`${P}/lexicons`]: [{ id: 'l1', name: 'Clinic terms', industry: null }] });
    api.patch.mockImplementation((_url: string, body: unknown) => Promise.resolve({ data: { ...settings, ...(body as object) } }));
    render(<SettingsPage />);

    const replay = (await screen.findByLabelText("Let listeners replay the speaker's original audio")) as HTMLInputElement;
    expect(replay.checked).toBe(false);
    expect(screen.getByText(/Replay enabled/)).toBeTruthy();

    const tone = screen.getByLabelText('Include possible tone in reports') as HTMLInputElement;
    expect(tone.checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Industry'), { target: { value: 'healthcare' } });
    expect(tone.checked).toBe(false);
    expect(tone.disabled).toBe(true);
    expect(screen.getByText(/always off for healthcare/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Default lexicon (PurpleLex)'), { target: { value: 'l1' } });
    fireEvent.change(screen.getByLabelText('Monthly budget (credits)'), { target: { value: '20000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Settings saved')).toBeTruthy();
    expect(api.patch).toHaveBeenCalledWith(
      `${P}/settings`,
      expect.objectContaining({ industry: 'healthcare', sentimentEnabled: false, defaultLexiconId: 'l1', monthlyBudgetCredits: 20000, dailyBudgetCredits: null }),
    );
  });

  it('estimates cost through /translation/estimate', async () => {
    routes({
      '/projects': projects,
      [`${P}/settings`]: settings,
      [`${P}/lexicons`]: [],
      '/translation/estimate': { mode: 'voice', ratePerMinute: 450, creditsPerCall: 9000, totalCredits: 900000, approxInrPerCall: 90, note: '' },
    });
    render(<SettingsPage />);
    const estimator = await screen.findByTestId('cost-estimator');
    fireEvent.click(within(estimator).getByRole('button', { name: 'Estimate' }));
    const result = await screen.findByTestId('estimate-result');
    expect(result.textContent).toContain('9,000 credits');
    expect(result.textContent).toContain('₹90.00');
    expect(api.get).toHaveBeenCalledWith('/translation/estimate', { params: { mode: 'voice', minutes: 10, calls: 100 } });
  });
});

describe('PurpleLex lexicons', () => {
  it('creates a lexicon from a pack and saves edited terms', async () => {
    const lex = { id: 'l9', name: 'Healthcare', industry: 'healthcare' };
    routes({
      '/projects': projects,
      [`${P}/lexicons`]: [],
      [`${P}/lexicons/packs`]: [{ industry: 'healthcare', name: 'Healthcare', termCount: 40 }],
      [`${P}/lexicons/l9`]: { ...lex, terms: [{ id: 't1', term: 'BP', kind: 'DO_NOT_TRANSLATE', translations: null, pronunciation: null, caseSensitive: true }] },
    });
    api.post.mockResolvedValue({ data: lex });
    api.put.mockResolvedValue({ data: lex });
    render(<LexiconsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Use the Healthcare pack' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${P}/lexicons/from-pack`, { industry: 'healthcare' }));

    expect(((await screen.findByLabelText('Term 1')) as HTMLInputElement).value).toBe('BP');
    fireEvent.change(screen.getByLabelText('Add a translation language'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add language' }));
    fireEvent.click(screen.getByRole('button', { name: /Add term/ }));
    fireEvent.change(screen.getByLabelText('Term 2'), { target: { value: 'invoice' } });
    fireEvent.change(screen.getByLabelText('Rule for invoice'), { target: { value: 'TRANSLATE_AS' } });

    // A "Translate as" term needs a translation.
    fireEvent.click(screen.getByRole('button', { name: 'Save terms' }));
    expect(await screen.findByText('Add at least one translation for "invoice".')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('invoice in hi'), { target: { value: 'चालान' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save terms' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][0]).toBe(`${P}/lexicons/l9/terms`);
    expect(api.put.mock.calls[0][1]).toEqual([
      { term: 'BP', kind: 'DO_NOT_TRANSLATE', caseSensitive: true },
      { term: 'invoice', kind: 'TRANSLATE_AS', caseSensitive: false, translations: { hi: 'चालान' } },
    ]);
  });

  it('rejects a CSV without a term column before calling the server', async () => {
    const lex = { id: 'l1', name: 'Brand', industry: null, termCount: 0 };
    routes({ '/projects': projects, [`${P}/lexicons`]: [lex], [`${P}/lexicons/packs`]: [], [`${P}/lexicons/l1`]: { ...lex, terms: [] } });
    render(<LexiconsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^Brand/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Import CSV/ }));
    fireEvent.change(screen.getByLabelText('Paste CSV'), { target: { value: 'name,kind\nx,y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import terms' }));
    expect(await screen.findByText('The first column must be "term".')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('Call report', () => {
  const report = {
    status: 'ready',
    creditsCharged: 100,
    createdAt: '2026-10-22T10:00:00Z',
    transcript: [
      { phraseId: 'caller-1', speaker: 'caller', sourceLanguage: 'en', targetLanguage: 'mr', original: 'The fee is 500 rupees', translated: 'फी 5000 रुपये आहे', startedAt: '2026-10-22T10:00:00Z', guardStatus: 'uncertain', guardReasons: ['term_mismatch:amount'] },
      { phraseId: 'receiver-1', speaker: 'receiver', sourceLanguage: 'mr', targetLanguage: 'en', original: 'ठीक आहे', translated: 'Okay', startedAt: '2026-10-22T10:00:05Z', guardStatus: 'ok', guardReasons: [] },
    ],
    summary: {
      en: { keyPoints: ['Fee discussed'], decisions: [], actionItems: [{ text: 'Send invoice', phraseId: 'caller-1' }] },
      mr: { keyPoints: ['फी चर्चा'], decisions: [], actionItems: [] },
    },
    signals: { talkRatio: { caller: 0.6, receiver: 0.4 }, topics: ['fees'], flaggedMoments: [{ phraseId: 'caller-1' }], replays: 1, repeats: 0, tone: [{ speaker: 'receiver', topic: 'fees', tone: 'hesitant', quotes: ['ठीक आहे'] }] },
  };

  it('shows summary per language, flagged phrases and possible tone', async () => {
    routes({ '/dashboard/translation/calls/call-1/report': report });
    render(<ReportPage />);

    const summary = await screen.findByTestId('report-summary');
    expect(within(summary).getByText('Fee discussed')).toBeTruthy();
    fireEvent.click(within(summary).getByRole('tab', { name: 'Marathi' }));
    expect(within(summary).getByText('फी चर्चा')).toBeTruthy();
    fireEvent.click(within(summary).getByRole('tab', { name: 'English' }));
    fireEvent.click(within(summary).getByRole('button', { name: 'Show in transcript' }));

    const transcript = screen.getByTestId('report-transcript');
    const flagged = transcript.querySelector('[data-flagged="true"]')!;
    expect(flagged.textContent).toContain('May not be accurate: An amount may not match');
    expect(transcript.querySelectorAll('[data-flagged="true"]').length).toBe(1);
    expect(screen.getByTestId('possible-tone').textContent).toMatch(/possible tone hesitant/i);
    expect(screen.getByTestId('report-signals').textContent).toContain('Caller 60% · Receiver 40%');
    expect(document.body.textContent).not.toMatch(/\d+% accurate|confidence/i);
  });

  it('omits tone when the report has none', async () => {
    routes({ '/dashboard/translation/calls/call-1/report': { ...report, signals: { ...report.signals, tone: undefined } } });
    render(<ReportPage />);
    await screen.findByTestId('report-signals');
    expect(screen.queryByTestId('possible-tone')).toBeNull();
  });

  it('explains a missing report', async () => {
    routes({
      '/dashboard/translation/calls/call-1/report': Object.assign(new Error('404'), { response: { status: 404, data: { code: 'TRANSLATION_REPORT_NOT_FOUND' } } }),
    });
    render(<ReportPage />);
    expect(await screen.findByText(/No report exists for this call/)).toBeTruthy();
  });
});

describe('Usage page CostGuard breakdown', () => {
  it('splits credits across call, captions, voice, AI and reports', async () => {
    routes({
      '/dashboard/translation/usage': {
        callMinutes: { minutes: 100, credits: 200 },
        captions: { minutes: 10, credits: 1200 },
        voice: { minutes: 20, credits: 18000 },
        aiAgent: { minutes: 5, credits: 75 },
        reports: { count: 2, credits: 200 },
      },
    });
    render(<TranslationUsageSection />);
    const box = await screen.findByTestId('costguard-breakdown');
    expect(box.textContent).toContain('19,675 credits in total');
    expect(screen.getByTestId('breakdown-voice').textContent).toContain('18,000 credits');
    expect(screen.getByTestId('breakdown-reports').textContent).toContain('2 reports');
    expect(box.textContent).not.toMatch(/₹/);
  });

  it('renders nothing when the endpoint is unavailable', async () => {
    routes({});
    const { container } = render(<TranslationUsageSection />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
