import { BillingConfigService } from './billing-config.service';

const current = {
  id: 'cfg',
  key: 'default',
  topUpExpiryPolicy: 'NEVER',
  topUpExpiryDays: null,
  translationVoiceCreditsPerMinute: 450,
  translationCaptionsCreditsPerMinute: 60,
  translationIndicVoiceCreditsPerMinute: null,
  postCallReportCredits: 100,
  updatedAt: new Date('2026-10-22T00:00:00Z'),
};

function setup() {
  const prisma: any = {
    billingConfig: {
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...current, ...data })),
    },
    translationSession: { findMany: jest.fn().mockResolvedValue([{ ownerId: 'u1' }, { ownerId: 'u2' }]) },
  };
  const audit = { log: jest.fn() };
  const notifications = { createNotification: jest.fn().mockResolvedValue(null) };
  return { prisma, audit, notifications, service: new BillingConfigService(prisma, audit as never, notifications as never) };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('BillingConfigService translation fields', () => {
  it('accepts and audits valid values', async () => {
    const t = setup();
    await t.service.update(
      {
        translationCaptionsCreditsPerMinute: 50,
        translationIndicVoiceCreditsPerMinute: null,
        translationMinimumCredits: 0,
        translationTrialMinutes: 0,
        translationProviderCostsPaise: { 'openai-translate': 300, sarvam: 0 },
        translationMarginWarnPercent: 100,
        translationDefaultMaxMinutes: 600,
        translationMaxBudgetCredits: 1,
      },
      'admin',
    );
    const data = t.prisma.billingConfig.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ translationCaptionsCreditsPerMinute: 50, translationIndicVoiceCreditsPerMinute: null, translationMaxBudgetCredits: 1 });
    expect(t.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'BILLING_CONFIG_UPDATED' }));
  });

  it.each([
    [{ translationVoiceCreditsPerMinute: 0 }],
    [{ translationCaptionsCreditsPerMinute: 1.5 }],
    [{ translationVoiceCreditsPerMinute: null }],
    [{ translationTrialMinutes: -1 }],
    [{ translationMarginWarnPercent: 101 }],
    [{ translationDefaultMaxMinutes: 0 }],
    [{ translationProviderCostsPaise: { sarvam: -1 } }],
    [{ translationProviderCostsPaise: [1] }],
    [{ translationProviderCostsPaise: { 'Bad Key': 1 } }],
  ])('rejects %j', async (input) => {
    await expect(setup().service.update(input as never, 'admin')).rejects.toMatchObject({ status: 400 });
  });

  it('notifies recent translation users when a customer rate changes', async () => {
    const t = setup();
    await t.service.update({ translationVoiceCreditsPerMinute: 500 }, 'admin');
    await flush();
    expect(t.prisma.translationSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ['ownerId'], where: { startedAt: { gte: expect.any(Date) } } }),
    );
    expect(t.notifications.createNotification).toHaveBeenCalledTimes(2);
    const n = t.notifications.createNotification.mock.calls[0][0];
    expect(n.type).toBe('TRANSLATION_RATE_CHANGED');
    expect(n.message).toMatch(/450 → 500/);
    expect(n.message).toMatch(/started from now on/);
  });

  it('does not notify for non-price fields or unchanged rates', async () => {
    const t = setup();
    await t.service.update({ translationMarginWarnPercent: 30 }, 'admin');
    await t.service.update({ translationVoiceCreditsPerMinute: 450 }, 'admin');
    await flush();
    expect(t.notifications.createNotification).not.toHaveBeenCalled();
  });
});
