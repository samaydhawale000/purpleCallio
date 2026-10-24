import { TranslationSettingsService } from './translation-settings.service';

function setup(existing: Record<string, unknown> | null = { projectId: 'p1', alertThresholds: [50] }) {
  const prisma = {
    project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', ownerId: 'u1' }) },
    translationSettings: {
      findUnique: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockResolvedValue({ projectId: 'p1' }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ projectId: 'p1', ...data })),
    },
    translationLexicon: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const config = { get: jest.fn().mockResolvedValue({ translationMaxBudgetCredits: 1000 }) };
  return { prisma, service: new TranslationSettingsService(prisma as never, config as never) };
}

describe('TranslationSettingsService', () => {
  it('creates the row lazily', async () => {
    const t = setup(null);
    await t.service.get('p1');
    expect(t.prisma.translationSettings.upsert).toHaveBeenCalledWith({ where: { projectId: 'p1' }, create: { projectId: 'p1' }, update: {} });
  });

  it('clamps budgets to the admin ceiling and normalises thresholds', async () => {
    const t = setup();
    const out = await t.service.update('p1', {
      dailyBudgetCredits: 5000,
      monthlyBudgetCredits: 200,
      alertThresholds: [100, 50, 50, 80],
      replayEnabled: true,
      industry: 'Healthcare',
      onLimit: 'off',
    });
    expect(out.dailyBudgetCredits).toBe(1000);
    expect(out.monthlyBudgetCredits).toBe(200);
    expect(out.alertThresholds).toEqual([50, 80, 100]);
    expect(out.industry).toBe('healthcare');
  });

  it.each([
    [{ transcriptRetentionDays: 5 }],
    [{ replayEnabled: 'yes' }],
    [{ alertThresholds: [0] }],
    [{ onLimit: 'nope' }],
    [{ defaultMaxMinutes: 601 }],
    [{ dailyBudgetCredits: -1 }],
  ])('rejects %j with a code', async (body) => {
    await expect(setup().service.update('p1', body as never)).rejects.toMatchObject({
      response: { code: 'TRANSLATION_INVALID_SETTINGS' },
    });
  });

  it('rejects a default lexicon from another project', async () => {
    await expect(
      setup().service.update('p1', { defaultLexiconId: '0b6c6a0e-3f0e-4a59-9a8e-0d1f2e3a4b5c' }),
    ).rejects.toMatchObject({ response: { code: 'TRANSLATION_LEXICON_NOT_FOUND' } });
  });

  it('assertOwner forbids other users', async () => {
    await expect(setup().service.assertOwner('p1', 'u2')).rejects.toMatchObject({ status: 403 });
    await expect(setup().service.assertOwner('p1', 'u1')).resolves.toBeDefined();
  });
});
