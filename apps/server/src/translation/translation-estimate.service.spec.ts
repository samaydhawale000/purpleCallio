import { TranslationEstimateService, effectiveRates } from './translation-estimate.service';

const config = {
  translationVoiceCreditsPerMinute: 450,
  translationCaptionsCreditsPerMinute: 60,
  postCallReportCredits: 100,
} as never;

function setup(override: Record<string, unknown> | null = null, published: { creditPricePaise: number } | null = { creditPricePaise: 20 }) {
  const prisma: any = {
    translationRateOverride: { findUnique: jest.fn().mockResolvedValue(override) },
    creditPricingVersion: { findFirst: jest.fn().mockResolvedValue(published) },
  };
  return new TranslationEstimateService(prisma, { get: jest.fn().mockResolvedValue(config) } as never);
}

describe('TranslationEstimateService', () => {
  it('defaults to both people translating, rounded up once, ₹ at the published price', async () => {
    const out = await setup().estimate({ mode: 'voice', minutes: '10', calls: '100' });
    expect(out).toMatchObject({
      mode: 'voice', ratePerMinute: 450, listeners: 2, creditsPerCall: 9000, totalCredits: 900000,
      approxInrPerMinute: 90, approxInrPerCall: 1800, approxInrTotal: 180000,
    });
    expect(out.note).toEqual(expect.any(String));
  });

  it('one person translating costs 1× the rate', async () => {
    const out = await setup().estimate({ mode: 'captions', minutes: '10', listeners: '1' });
    expect(out).toMatchObject({ listeners: 1, creditsPerCall: 600 });
    await expect(setup().estimate({ listeners: '3' })).rejects.toMatchObject({ status: 400 });
  });

  it('values 90,000 credits at the published price, not legacy top-ups', async () => {
    const out = await setup().estimate({ mode: 'captions', minutes: '15', calls: '50', listeners: '2' });
    expect(out.totalCredits).toBe(90000);
    expect(out.approxInrTotal).toBe(18000);
    expect((await setup(null, null).estimate({})).approxInrPerCall).toBeNull();
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

  it('effectiveRates: an override wins field by field', () => {
    expect(effectiveRates(config, { voiceCreditsPerMinute: 200, captionsCreditsPerMinute: null, postCallReportCredits: null })).toMatchObject({
      voiceRate: 200,
      captionsRate: 60,
      reportCredits: 100,
    });
  });
});
