import { TranslationReportStatus } from '@prisma/client';

import { TranslationReportService, talkRatio } from './translation-report.service';
import { ActiveReportSummarizer } from './summarizer.provider';

const T0 = new Date('2026-10-22T10:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);

function phrase(over: Record<string, unknown> = {}) {
  return {
    id: 'p',
    callId: 'call-1',
    phraseId: 'caller-1',
    speaker: 'caller',
    sourceLanguage: 'hi',
    targetLanguage: 'en',
    original: 'namaste',
    translated: 'hello',
    startedAt: at(0),
    endedAt: at(3),
    translatedAudioAt: null,
    guardStatus: 'ok',
    guardReasons: [],
    expiresAt: at(86_400),
    createdAt: at(0),
    ...over,
  };
}

function setup(opts: {
  settings?: Record<string, unknown>;
  config?: unknown;
  phrases?: ReturnType<typeof phrase>[];
  report?: Record<string, unknown> | null;
  summarize?: jest.Mock;
  override?: Record<string, unknown> | null;
} = {}) {
  const phrases = opts.phrases ?? [
    phrase(),
    phrase({
      phraseId: 'receiver-1',
      speaker: 'receiver',
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      startedAt: at(4),
      endedAt: at(5),
      guardStatus: 'uncertain',
      guardReasons: ['term_mismatch:amount'],
    }),
  ];
  let report: Record<string, unknown> | null = opts.report ?? null;
  const prisma = {
    call: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'call-1',
        projectId: 'proj-1',
        translationConfig: opts.config ?? null,
        translationReport: report ? { id: 'r1' } : null,
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        projectId: 'proj-1',
        callerLanguage: 'hi',
        receiverLanguage: 'en',
        translationConfig: opts.config ?? null,
        project: { ownerId: 'owner-1' },
      }),
    },
    translationPhrase: {
      count: jest.fn().mockResolvedValue(phrases.length),
      findMany: jest.fn().mockResolvedValue(phrases),
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    translationSession: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { replays: 1, repeats: 2 } }),
    },
    translationRateOverride: {
      findUnique: jest.fn().mockResolvedValue(opts.override ?? null),
    },
    translationReport: {
      create: jest.fn().mockImplementation(({ data }) => {
        report = { id: 'r1', ...data };
        return Promise.resolve(report);
      }),
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(report)),
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(report)),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => {
        report = { ...report, ...data };
        return Promise.resolve(report);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const settings = {
    get: jest.fn().mockResolvedValue({
      postCallReportEnabled: true,
      sentimentEnabled: true,
      transcriptRetentionDays: 30,
      industry: null,
      ...opts.settings,
    }),
  };
  const billingConfig = { get: jest.fn().mockResolvedValue({ postCallReportCredits: 100 }) };
  const billing = {
    chargeReport: jest.fn().mockResolvedValue({ debited: 100, shortfall: 0, duplicate: false }),
  };
  const webhooks = { fireForCall: jest.fn().mockResolvedValue(undefined) };
  const notifications = { createNotification: jest.fn().mockResolvedValue(null) };
  const summarize =
    opts.summarize ??
    jest.fn().mockResolvedValue({
      summary: { hi: { keyPoints: ['a'], decisions: [], actionItems: [] } },
      topics: ['loan'],
      tone: [{ speaker: 'caller', topic: 'loan', tone: 'possibly worried', quotes: ['x'] }],
    });
  const service = new TranslationReportService(
    prisma as never,
    settings as never,
    billingConfig as never,
    billing as never,
    webhooks as never,
    notifications as never,
    { name: 'test', isConfigured: () => true, summarize } as never,
  );
  return { service, prisma, settings, billing, webhooks, notifications, summarize, get: () => report };
}

describe('TranslationReportService', () => {
  it('skips when the project has not opted in', async () => {
    const t = setup({ settings: { postCallReportEnabled: false } });
    expect(await t.service.createPending('call-1')).toBeNull();
    expect(t.prisma.translationReport.create).not.toHaveBeenCalled();
  });

  it('skips when the call opted out or has no phrases', async () => {
    const a = setup({ config: { postCallReport: false } });
    expect(await a.service.createPending('call-1')).toBeNull();
    const b = setup({ phrases: [] });
    expect(await b.service.createPending('call-1')).toBeNull();
  });

  it('builds, charges, notifies and fires the webhook', async () => {
    const t = setup();
    expect(await t.service.createPending('call-1')).toBe('r1');
    const created = t.prisma.translationReport.create.mock.calls[0][0].data;
    expect(created.status).toBe(TranslationReportStatus.PENDING);
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    expect(await t.service.build('call-1')).toBe(TranslationReportStatus.READY);
    expect(t.summarize).toHaveBeenCalledWith(
      expect.objectContaining({ includeTone: true, languages: { caller: 'hi', receiver: 'en' } }),
    );
    expect(t.billing.chargeReport).toHaveBeenCalledWith('call-1', 'owner-1', 100);
    const r = t.get()!;
    expect(r.status).toBe('READY');
    expect(r.creditsCharged).toBe(100);
    const signals = r.signals as Record<string, any>;
    expect(signals.talkRatio).toEqual({ caller: 0.75, receiver: 0.25 });
    expect(signals.flaggedMoments).toHaveLength(1);
    expect(signals.flaggedMoments[0].reasons).toEqual(['term_mismatch:amount']);
    expect(signals.replays).toBe(1);
    expect(signals.repeats).toBe(2);
    expect(signals.tone).toHaveLength(1);
    expect(t.webhooks.fireForCall).toHaveBeenCalledWith('call-1', 'call.translation.report_ready', { status: 'ready' });
    expect(t.notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TRANSLATION_REPORT_READY', userId: 'owner-1' }),
    );
  });

  it('never includes tone for healthcare (call context overrides project)', async () => {
    const t = setup({ config: { context: { industry: 'healthcare' } }, settings: { industry: 'saas' } });
    await t.service.createPending('call-1');
    await t.service.build('call-1');
    expect(t.summarize).toHaveBeenCalledWith(expect.objectContaining({ includeTone: false, industry: 'healthcare' }));
    expect((t.get()!.signals as Record<string, unknown>).tone).toBeUndefined();
  });

  it('uses the per-customer report price override', async () => {
    const t = setup({ override: { postCallReportCredits: 40 } });
    await t.service.createPending('call-1');
    await t.service.build('call-1');
    expect(t.billing.chargeReport).toHaveBeenCalledWith('call-1', 'owner-1', 40);
  });

  it('marks FAILED with a stable code and does not charge when the summary fails', async () => {
    const t = setup({ summarize: jest.fn().mockRejectedValue(new Error('boom')) });
    await t.service.createPending('call-1');
    expect(await t.service.build('call-1')).toBe(TranslationReportStatus.FAILED);
    expect(t.get()!.error).toBe('TRANSLATION_REPORT_SUMMARY_FAILED');
    expect(t.billing.chargeReport).not.toHaveBeenCalled();
    expect(t.webhooks.fireForCall).toHaveBeenCalledWith('call-1', 'call.translation.report_ready', { status: 'failed' });
  });

  it('getReport 404s with TRANSLATION_REPORT_NOT_FOUND', async () => {
    const t = setup();
    await expect(t.service.getReport('call-1', 'proj-1')).rejects.toMatchObject({
      response: { code: 'TRANSLATION_REPORT_NOT_FOUND' },
    });
  });

  it('getReport returns the transcript once ready', async () => {
    const t = setup();
    await t.service.createPending('call-1');
    await t.service.build('call-1');
    const out = await t.service.getReport('call-1', 'proj-1');
    expect(out.status).toBe('ready');
    expect(out.transcript).toHaveLength(2);
    expect(out.transcript[0]).toMatchObject({ phraseId: 'caller-1', speaker: 'caller', guard: { status: 'ok' } });
  });

  it('purges expired phrases and reports', async () => {
    const t = setup();
    expect(await t.service.purgeExpired(T0)).toEqual({ phrases: 3, reports: 1 });
    expect(t.prisma.translationPhrase.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: T0 } } });
  });

  it('talkRatio falls back to text length when timings are missing', () => {
    const r = talkRatio([
      phrase({ endedAt: null, original: 'aaaa' }),
      phrase({ speaker: 'receiver', endedAt: null, original: 'aaaa' }),
    ] as never);
    expect(r).toEqual({ caller: 0.5, receiver: 0.5 });
  });
});

describe('ActiveReportSummarizer', () => {
  it('uses OpenAI when configured, else the extractive fallback', async () => {
    let configured = false;
    const openai = { name: 'openai', isConfigured: () => configured, summarize: jest.fn().mockResolvedValue('o') };
    const fallback = { name: 'extractive', isConfigured: () => true, summarize: jest.fn().mockResolvedValue('e') };
    const s = new ActiveReportSummarizer(openai as never, fallback as never);
    expect(s.name).toBe('extractive');
    expect(await s.summarize({} as never)).toBe('e');
    configured = true;
    expect(s.name).toBe('openai');
    expect(await s.summarize({} as never)).toBe('o');
  });
});
