import { TranslationMetricsService, aggregate, parsePair, parseRange, weightedPercentile } from './translation-metrics.service';

const row = (over: Record<string, unknown> = {}) => ({
  callId: 'c1',
  sourceLanguage: 'hi',
  targetLanguage: 'en',
  route: 'sarvam',
  mode: 'VOICE',
  status: 'ENDED',
  voiceSeconds: 120,
  captionsSeconds: 0,
  creditsCharged: 900,
  phrases: 10,
  firstAudioMsP50: 800,
  firstAudioMsP95: 1500,
  captionDelayMsP50: 400,
  captionDelayMsP95: 900,
  droppedFrames: 1,
  providerFailures: 0,
  fallbacks: 1,
  flags: 2,
  flagReasons: { 'term_mismatch:amount': 2 },
  replays: 1,
  repeats: 0,
  lexiconHits: 3,
  ...over,
});

describe('metrics helpers', () => {
  it('parses pairs including regions', () => {
    expect(parsePair('hi-en')).toEqual({ source: 'hi', target: 'en' });
    expect(parsePair('en-IN-hi')).toEqual({ source: 'en-IN', target: 'hi' });
    expect(parsePair(undefined)).toBeNull();
    expect(() => parsePair('hindi')).toThrow();
  });

  it('parses ranges (to inclusive for dates) and caps them', () => {
    const r = parseRange('2026-10-01', '2026-10-01');
    expect(r.to.getTime() - r.from.getTime()).toBe(86_400_000);
    expect(() => parseRange('2026-10-02', '2026-10-01')).toThrow();
    expect(() => parseRange('2024-01-01', '2026-01-01')).toThrow();
  });

  it('weighted percentile', () => {
    expect(weightedPercentile([{ value: 100, weight: 9 }, { value: 1000, weight: 1 }], 0.5)).toBe(100);
    expect(weightedPercentile([{ value: 100, weight: 9 }, { value: 1000, weight: 1 }], 0.95)).toBe(1000);
    expect(weightedPercentile([{ value: null, weight: 1 }], 0.5)).toBeNull();
  });

  it('aggregates sessions per PROTOCOL §5 without provider cost', () => {
    const out = aggregate(
      [row(), row({ sourceLanguage: 'en', targetLanguage: 'hi', route: 'openai-translate', flags: 0, flagReasons: null, status: 'FAILED' })] as never,
      100,
    );
    expect(out.totals).toMatchObject({ calls: 1, sessions: 2, voiceMinutes: 4, credits: 1800 });
    // call-minute = longest direction (2 min) → 900 credits/min, ₹900/min at 100 paise
    expect(out.totals.avgCreditsPerCallMinute).toBe(900);
    expect(out.totals.approxInrPerCallMinute).toBe(900);
    expect(out.guard).toMatchObject({ phrases: 20, flags: 2, flagRate: 0.1, byReason: { 'term_mismatch:amount': 2 } });
    expect(out.reliability.failedSessions).toBe(1);
    expect(out.byPair).toHaveLength(2);
    expect(JSON.stringify(out)).not.toMatch(/providerCost/i);
    expect(out.benchmarks[0].note).toBe('pending Phase 0');
  });
});

describe('TranslationMetricsService', () => {
  it('filters by project, pair and route', async () => {
    const prisma: any = {
      translationSession: { findMany: jest.fn().mockResolvedValue([row()]) },
      topUpPackage: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const out = await new TranslationMetricsService(prisma).metrics('p1', { pair: 'hi-en', route: 'sarvam' });
    const where = prisma.translationSession.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ projectId: 'p1', route: 'sarvam', sourceLanguage: { startsWith: 'hi' }, targetLanguage: { startsWith: 'en' } });
    expect(out.totals.approxInrPerCallMinute).toBeNull();
  });

  it('builds the usage breakdown', async () => {
    const prisma: any = {
      callUsage: { aggregate: jest.fn().mockResolvedValue({ _sum: { audioMinutes: 10, videoMinutes: 5, screenShareMinutes: 0, creditsCharged: 30 }, _count: 2 }) },
      translationSession: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { voiceSeconds: 120, captionsSeconds: 60, creditsCharged: 960, trialSecondsUsed: 0 }, _count: 2 }),
        findMany: jest.fn().mockResolvedValue([
          { voiceSeconds: 120, captionsSeconds: 0, voiceRate: 450, captionsRate: 60 },
          { voiceSeconds: 0, captionsSeconds: 60, voiceRate: 450, captionsRate: 60 },
        ]),
      },
      aiCallSession: { aggregate: jest.fn().mockResolvedValue({ _sum: { durationSeconds: 300, creditsCharged: 75 }, _count: 1 }) },
      translationReport: { aggregate: jest.fn().mockResolvedValue({ _sum: { creditsCharged: 100 }, _count: 1 }) },
      topUpPackage: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const out = await new TranslationMetricsService(prisma).usageBreakdown('u1', {});
    expect(out.callMinutes).toEqual({ minutes: 15, credits: 30 });
    expect(out.voice).toEqual({ minutes: 2, credits: 900 });
    expect(out.captions).toEqual({ minutes: 1, credits: 60 });
    expect(out.aiAgent).toEqual({ minutes: 5, credits: 75 });
    expect(out.reports).toEqual({ count: 1, credits: 100 });
    expect(out.totalCredits).toBe(30 + 960 + 75 + 100);
    expect(out.period.from).toBeInstanceOf(Date);
  });
});
