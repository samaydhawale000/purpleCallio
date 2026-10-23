import { TranslationEstimateService, effectiveRates } from './translation-estimate.service';

const config = {
  translationVoiceCreditsPerMinute: 450,
  translationCaptionsCreditsPerMinute: 60,
  translationIndicVoiceCreditsPerMinute: 300,
  postCallReportCredits: 100,
} as never;

function setup(override: Record<string, unknown> | null = null, topUps = [{ pricePaise: 10000, credits: 100 }]) {
  const prisma: any = {
    translationRateOverride: { findUnique: jest.fn().mockResolvedValue(override) },
    topUpPackage: { findMany: jest.fn().mockResolvedValue(topUps) },
  };
  return new TranslationEstimateService(prisma, { get: jest.fn().mockResolvedValue(config) } as never);
}

describe('TranslationEstimateService', () => {
  it('estimates two directions per call, rounded up once', async () => {
    const out = await setup().estimate({ mode: 'voice', minutes: '10', calls: '100' });
    expect(out).toMatchObject({ mode: 'voice', ratePerMinute: 450, creditsPerCall: 9000, totalCredits: 900000, approxInrPerCall: 9000 });
    expect(out.note).toEqual(expect.any(String));
  });

  it('uses the Indic voice rate for Indian pairs', async () => {
    expect((await setup().estimate({ mode: 'voice', minutes: '1', pair: 'hi-mr' })).ratePerMinute).toBe(300);
    expect((await setup().estimate({ mode: 'voice', minutes: '1', pair: 'hi-en' })).ratePerMinute).toBe(450);
  });

  it('applies the signed-in user override', async () => {
    const out = await setup({ captionsCreditsPerMinute: 40 }).estimate({ mode: 'captions', minutes: '1' }, 'u1');
    expect(out.ratePerMinute).toBe(40);
    expect(out.personalized).toBe(true);
  });

  it('rejects bad input with a code', async () => {
    await expect(setup().estimate({ mode: 'off' })).rejects.toMatchObject({ response: { code: 'TRANSLATION_INVALID_REQUEST' } });
    await expect(setup().estimate({ minutes: '-1' })).rejects.toMatchObject({ status: 400 });
  });

  it('effectiveRates: a voice override wins over the Indic rate', () => {
    expect(effectiveRates(config, { voiceCreditsPerMinute: 200, captionsCreditsPerMinute: null, postCallReportCredits: null })).toMatchObject({
      voiceRate: 200,
      indicVoiceRate: 200,
      captionsRate: 60,
      reportCredits: 100,
    });
  });
});
