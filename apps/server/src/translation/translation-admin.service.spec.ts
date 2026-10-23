import { TranslationAdminService } from './translation-admin.service';

function setup() {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) },
    feature: { count: jest.fn().mockResolvedValue(8), upsert: jest.fn().mockResolvedValue({}) },
    translationRateOverride: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        { userId: 'u1', voiceCreditsPerMinute: 300, captionsCreditsPerMinute: null, postCallReportCredits: null, note: null, updatedAt: new Date(), updatedById: 'a', user: { id: 'u1', email: 'e', name: 'n', companyName: 'c' } },
      ]),
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'o1', ...create })),
      delete: jest.fn().mockResolvedValue({}),
    },
    translationSession: {
      findMany: jest.fn().mockResolvedValue([
        { route: 'sarvam', sourceLanguage: 'hi', targetLanguage: 'en', voiceSeconds: 600, captionsSeconds: 0, creditsCharged: 4500, providerCostPaise: 1500 },
        { route: 'openai-translate', sourceLanguage: 'en', targetLanguage: 'hi', voiceSeconds: 600, captionsSeconds: 0, creditsCharged: 100, providerCostPaise: 3000 },
      ]),
    },
    translationReport: { aggregate: jest.fn().mockResolvedValue({ _sum: { creditsCharged: 200 }, _count: 2 }) },
    topUpPackage: { findMany: jest.fn().mockResolvedValue([{ pricePaise: 1000, credits: 100 }]) },
  };
  const audit = { log: jest.fn() };
  const config = { get: jest.fn().mockResolvedValue({ translationMarginWarnPercent: 40, translationProviderCostsPaise: {} }) };
  return { prisma, audit, service: new TranslationAdminService(prisma, config as never, audit as never) };
}

describe('TranslationAdminService', () => {
  it('registers the TRANSLATION feature on boot without touching plans', async () => {
    const t = setup();
    await t.service.onModuleInit();
    expect(t.prisma.feature.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'TRANSLATION' }, update: {} }));
  });

  it('lists overrides in the UI shape', async () => {
    const rows = await setup().service.listOverrides();
    expect(rows[0]).toMatchObject({ userId: 'u1', voiceCreditsPerMinute: 300, user: { email: 'e', name: 'n', companyName: 'c' } });
  });

  it('upserts an override with validation and audit', async () => {
    const t = setup();
    await t.service.putOverride('u1', { voiceCreditsPerMinute: 300, note: ' deal ' }, 'admin');
    expect(t.prisma.translationRateOverride.upsert.mock.calls[0][0].create).toMatchObject({ voiceCreditsPerMinute: 300, note: 'deal', updatedById: 'admin' });
    expect(t.audit.log).toHaveBeenCalledWith(expect.objectContaining({ entity: 'TranslationRateOverride', actorId: 'admin' }));
    await expect(t.service.putOverride('u1', { voiceCreditsPerMinute: 0 }, 'admin')).rejects.toMatchObject({ status: 400 });
  });

  it('delete 404s when there is nothing to delete', async () => {
    await expect(setup().service.deleteOverride('u1', 'admin')).rejects.toMatchObject({ status: 404 });
  });

  it('computes margin by route and pair and flags low margins', async () => {
    const out = await setup().service.margin(new Date(0), new Date());
    expect(out.warnPercent).toBe(40);
    const sarvam = out.byRoute.find((r) => r.route === 'sarvam')!;
    // 4500 credits × ₹0.10 = ₹450 revenue, ₹15 cost
    expect(sarvam).toMatchObject({ revenueCredits: 4500, revenueInr: 450, providerCostInr: 15, warn: false });
    const openai = out.byRoute.find((r) => r.route === 'openai-translate')!;
    expect(openai.warn).toBe(true);
    expect(out.byPair.map((p) => p.pair).sort()).toEqual(['en-hi', 'hi-en']);
    expect(out.reports.revenueCredits).toBe(200);
  });
});
