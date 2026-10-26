import { TranslationAccessService } from './translation-access.service';

describe('TranslationAccessService', () => {
  let config: any;
  let entitled: boolean;
  let available: number;
  let override: any;
  let service: TranslationAccessService;

  beforeEach(() => {
    config = {
      translationMinimumCredits: null,
      translationVoiceCreditsPerMinute: 450,
      translationCaptionsCreditsPerMinute: 60,
    };
    entitled = true;
    available = 1000;
    override = null;
    const prisma: any = {
      translationRateOverride: { findUnique: jest.fn(async () => override) },
    };
    service = new TranslationAccessService(
      prisma,
      { hasFeature: jest.fn(async (_u: string, f: string) => f === 'TRANSLATION' && entitled) } as any,
      { get: jest.fn(async () => config) } as any,
      { getSummary: jest.fn(async () => ({ available: available + 5000, paidAvailable: available })) } as any,
    );
  });

  it('mode off is always allowed', async () => {
    entitled = false;
    expect(await service.canStart('u', 'off')).toEqual({ ok: true });
  });

  it('entitled with credits → ok', async () => {
    expect(await service.canStart('u', 'voice')).toEqual({ ok: true });
  });

  it('entitled without the minimum → TRANSLATION_INSUFFICIENT_CREDITS', async () => {
    available = 449;
    expect(await service.canStart('u', 'voice')).toMatchObject({ ok: false, code: 'TRANSLATION_INSUFFICIENT_CREDITS' });
    expect(await service.canStart('u', 'captions')).toMatchObject({ ok: true });
  });

  it('minimum: BillingConfig value, else a minute of the (overridden) rate', async () => {
    expect(await service.minimumCreditsToStart('voice')).toBe(450);
    override = { voiceCreditsPerMinute: 300 };
    expect(await service.minimumCreditsToStart('voice', 'u')).toBe(300);
    config.translationMinimumCredits = 25;
    expect(await service.minimumCreditsToStart('voice', 'u')).toBe(25);
  });

  it('not entitled → TRANSLATION_NOT_IN_PLAN (no free trial)', async () => {
    entitled = false;
    expect(await service.canStart('u', 'voice')).toEqual({ ok: false, code: 'TRANSLATION_NOT_IN_PLAN' });
  });

  it('free credits never count towards the start minimum', async () => {
    available = 0; // 5,000 free credits in the wallet, no paid ones
    expect(await service.canStart('u', 'captions')).toEqual({ ok: false, code: 'TRANSLATION_INSUFFICIENT_CREDITS' });
  });
});
