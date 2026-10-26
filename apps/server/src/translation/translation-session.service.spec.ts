import { Logger } from '@nestjs/common';

import { TranslationLimitError, TranslationSessionService } from './translation-session.service';

describe('TranslationSessionService', () => {
  let rows: any[];
  let config: any;
  let override: any;
  let service: TranslationSessionService;
  let prisma: any;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    rows = [];
    override = null;
    config = {
      translationVoiceCreditsPerMinute: 450,
      translationCaptionsCreditsPerMinute: 60,
      translationIndicVoiceCreditsPerMinute: null,
    };
    const match = (r: any, where: any) =>
      Object.entries(where).every(([k, v]: any) =>
        v && typeof v === 'object' && !(v instanceof Date)
          ? 'not' in v
            ? r[k] !== v.not
            : 'lt' in v
              ? r[k] < v.lt
              : true
          : r[k] === v,
      );
    prisma = {
      translationRateOverride: { findUnique: jest.fn(async () => override) },
      $queryRaw: jest.fn(async () => [{ locked: 1 }]),
      translationSession: {
        findMany: jest.fn(async ({ where }: any) => {
          const hit = rows.filter((r) => match(r, where));
          return [...new Map(hit.map((r) => [r.callId, { callId: r.callId, ...r }])).values()];
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `ts_${rows.length + 1}`, updatedAt: new Date(), ...data };
          rows.push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = rows.filter((r) => match(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
      },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    service = new TranslationSessionService(prisma, { get: jest.fn(async () => config) } as any);
  });

  afterEach(() => {
    delete process.env.TRANSLATION_MAX_CONCURRENT_CALLS_PER_ACCOUNT;
  });

  const input = (callId = 'call_1', source = 'hi', target = 'en') => ({
    callId,
    projectId: 'p',
    ownerId: 'owner',
    direction: 'caller_to_receiver' as const,
    sourceLanguage: source,
    targetLanguage: target,
    mode: 'voice' as const,
    route: 'soniox',
  });

  it('locks the rates at start (admin changes apply to new sessions only)', async () => {
    const first = await service.start(input());
    config.translationVoiceCreditsPerMinute = 999;
    expect(first.voiceRate).toBe(450);
    expect(first.captionsRate).toBe(60);
    expect(rows[0].voiceRate).toBe(450);
    expect(rows[0].mode).toBe('VOICE');
    expect(rows[0].status).toBe('ACTIVE');
  });

  it('one rate for every language pair; a customer override wins', async () => {
    expect(await service.rates('o')).toEqual({ voiceRate: 450, captionsRate: 60 });
    override = { voiceCreditsPerMinute: 100, captionsCreditsPerMinute: 10 };
    expect(await service.rates('o')).toEqual({ voiceRate: 100, captionsRate: 10 });
  });

  it('counts concurrency per call, excluding the same call', async () => {
    process.env.TRANSLATION_MAX_CONCURRENT_CALLS_PER_ACCOUNT = '1';
    await service.start(input('call_1'));
    await service.start(input('call_1', 'en', 'hi')); // second direction of the same call
    await expect(service.start(input('call_2'))).rejects.toBeInstanceOf(TranslationLimitError);
  });

  it('end is idempotent and writes metrics', async () => {
    const row = await service.start(input());
    const end = { reason: 'call_ended', voiceSeconds: 61.4, captionsSeconds: 0, metrics: { phrases: 3, flags: 1 } };
    expect(await service.end(row.id, end)).toBe(true);
    expect(await service.end(row.id, end)).toBe(false);
    expect(rows[0]).toMatchObject({ status: 'ENDED', voiceSeconds: 61, phrases: 3, flags: 1, endReason: 'call_ended' });
  });

  it('sweeps stale ACTIVE sessions at their last checkpoint', async () => {
    process.env.TRANSLATION_ENABLED = 'true';
    const row = await service.start(input());
    rows[0].updatedAt = new Date(Date.now() - 10 * 60_000);
    rows[0].voiceSeconds = 30;
    await service.sweepStaleSessions();
    expect(rows[0]).toMatchObject({ id: row.id, status: 'ENDED', endReason: 'heartbeat_lost', voiceSeconds: 30 });
    delete process.env.TRANSLATION_ENABLED;
  });
});
