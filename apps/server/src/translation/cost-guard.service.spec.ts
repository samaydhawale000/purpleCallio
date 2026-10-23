import { CostGuardService, CostGuardState } from './cost-guard.service';

describe('CostGuardService', () => {
  let charged: number;
  let available: number;
  let alerts: Set<string>;
  let notifications: any;
  let webhooks: any;
  let service: CostGuardService;

  beforeEach(() => {
    charged = 0;
    available = 100_000;
    alerts = new Set();
    const prisma: any = {
      translationSession: { aggregate: jest.fn(async () => ({ _sum: { creditsCharged: charged } })) },
      translationBudgetAlert: {
        create: jest.fn(async ({ data }: any) => {
          const key = `${data.projectId}|${data.period}|${data.threshold}`;
          if (alerts.has(key)) throw Object.assign(new Error('dup'), { code: 'P2002' });
          alerts.add(key);
          return data;
        }),
      },
    };
    notifications = { createNotification: jest.fn(async () => null) };
    webhooks = { fireForCall: jest.fn(async () => undefined) };
    service = new CostGuardService(
      prisma,
      { getSummary: jest.fn(async () => ({ available })) } as any,
      notifications,
      webhooks,
    );
  });

  const state = (over: Partial<CostGuardState> = {}): CostGuardState => ({
    callId: 'call_1',
    projectId: 'p',
    ownerId: 'o',
    mode: 'voice',
    onLimit: 'captions_then_off',
    maxMinutes: 10,
    usedSeconds: 0,
    liveCredits: 0,
    creditsPerMinute: 900,
    trial: false,
    warned: new Set(),
    budgets: null,
    ...over,
  });

  it('call scope: warning once at 90 %, then pause — never a step-down', async () => {
    const s = state({ usedSeconds: 540 });
    expect(await service.evaluate(s)).toEqual([{ kind: 'warning', scope: 'call', remainingSeconds: 60 }]);
    expect(await service.evaluate(s)).toEqual([]);
    s.usedSeconds = 600;
    expect(await service.evaluate(s)).toEqual([{ kind: 'paused', scope: 'call', remainingSeconds: 0 }]);
    s.mode = 'off';
    expect(await service.evaluate(s)).toEqual([]);
  });

  it('credits: voice projection → step down; captions continue while they fit; then pause', async () => {
    available = 2000;
    const s = state({ liveCredits: 900, creditsPerMinute: 900 }); // projection 1800 = 90 %
    expect(await service.evaluate(s)).toEqual([
      { kind: 'warning', scope: 'credits', remainingSeconds: 13 },
    ]);
    s.liveCredits = 1100; // projection 2000 = 100 %
    expect(await service.evaluate(s)).toEqual([
      { kind: 'stepped_down', scope: 'credits', remainingSeconds: 60 },
    ]);
    // After the step-down the voice credits are billed; captions accrue at 120/min.
    available = 900;
    s.mode = 'captions';
    s.liveCredits = 0;
    s.creditsPerMinute = 120;
    expect(await service.evaluate(s)).toEqual([]);
    s.liveCredits = 700; // projection 820 ≥ 90 % of 900 → a captions warning
    expect(await service.evaluate(s)).toEqual([
      { kind: 'warning', scope: 'credits', remainingSeconds: 40 },
    ]);
    expect(await service.evaluate(s)).toEqual([]);
    s.liveCredits = 780; // projection 900 = 100 %
    expect(await service.evaluate(s)).toEqual([
      { kind: 'paused', scope: 'credits', remainingSeconds: 60 },
    ]);
  });

  it('onLimit off pauses voice directly on a money limit', async () => {
    available = 1000;
    expect(await service.evaluate(state({ onLimit: 'off', liveCredits: 100 }))).toEqual([
      { kind: 'paused', scope: 'credits', remainingSeconds: 60 },
    ]);
  });

  it('trial accounts are not checked against the wallet', async () => {
    available = 0;
    expect(await service.evaluate(state({ liveCredits: 5000, trial: true }))).toEqual([]);
  });

  it('budget: projection limit and one alert per threshold', async () => {
    charged = 800;
    const s = state({
      liveCredits: 0,
      creditsPerMinute: 100,
      budgets: { dailyBudgetCredits: 1000, monthlyBudgetCredits: null, alertThresholds: [50, 80, 100] },
    });
    expect((await service.evaluate(s))[0]).toMatchObject({ kind: 'warning', scope: 'budget' });
    await service.evaluate(s);
    expect(alerts.size).toBe(2);
    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(notifications.createNotification.mock.calls[0][0]).toMatchObject({
      type: 'TRANSLATION_BUDGET_THRESHOLD',
      userId: 'o',
    });
    expect(webhooks.fireForCall).toHaveBeenCalledWith(
      'call_1',
      'translation.budget.threshold',
      expect.objectContaining({ threshold: 80, usedCredits: 800, budgetCredits: 1000 }),
    );
    charged = 900;
    expect((await service.evaluate(s))[0]).toMatchObject({ kind: 'stepped_down', scope: 'budget' });
    charged = 1000;
    await service.evaluate(s);
    expect(alerts.size).toBe(3);
  });

  it('a second instance hitting the unique row does not notify again', async () => {
    alerts.add(`p|day:${new Date().toISOString().slice(0, 10)}|50`);
    charged = 600;
    await service.evaluate(state({ creditsPerMinute: 0, budgets: { dailyBudgetCredits: 1000, alertThresholds: [50] } }));
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});
