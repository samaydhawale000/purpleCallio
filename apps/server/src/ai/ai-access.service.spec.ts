import { AiAccessService } from './ai-access.service';

describe('AiAccessService', () => {
  function build(
    planType: string | null,
    available = 100,
    minimumCreditsToStartCall = 1,
  ) {
    const subscriptions = {
      getActiveSubscription: jest.fn().mockResolvedValue({
        planType,
        currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
      }),
    };
    const credits = { getSummary: jest.fn().mockResolvedValue({ available }) };
    const config = {
      get: jest.fn().mockResolvedValue({ minimumCreditsToStartCall }),
    };
    return new AiAccessService(
      subscriptions as never,
      credits as never,
      config as never,
    );
  }

  it.each([
    ['FREE', false],
    ['PAID', true],
    ['CUSTOM', true],
    [null, false],
  ])('hasPaidPlan for plan type %s is %s', async (planType, expected) => {
    await expect(build(planType).hasPaidPlan('user_a')).resolves.toBe(expected);
  });

  it('needs at least one minute of credits and the start minimum', async () => {
    await expect(build('PAID', 1).hasCreditsToStart('u')).resolves.toBe(true);
    await expect(build('PAID', 0).hasCreditsToStart('u')).resolves.toBe(false);
    await expect(build('PAID', 4, 5).hasCreditsToStart('u')).resolves.toBe(
      false,
    );
    await expect(build('PAID', 5, 5).hasCreditsToStart('u')).resolves.toBe(
      true,
    );
  });
});
