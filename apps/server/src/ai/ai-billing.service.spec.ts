import { BillingConfigService } from '../billing/billing-config.service';
import { UsageBillingService } from '../billing/usage-billing.service';
import { AiAccessService } from './ai-access.service';
import {
  AiBillingService,
  aiCreditsFor,
  maxSecondsForBalance,
} from './ai-billing.service';
import { AiPricingService } from './ai-pricing.service';
import { AiSessionService } from './ai-session.service';

const NOW = new Date('2026-10-17T12:00:00Z');
const PERIOD_START = new Date('2026-10-01T00:00:00Z');
const OWNER = 'user_ai';
const HUMAN = 'user_human';
const AGENT = '11111111-1111-4111-8111-111111111111';
const AI_RATE = 15;

const AI_ENV = [
  'AI_ENABLED',
  'AI_USD_INR_RATE',
  'AI_CREDIT_VALUE_PAISE',
  'AI_MAX_DURATION_CAP_SECONDS',
];

// ── In-memory Prisma ────────────────────────────────────
const OPS = ['in', 'notIn', 'not', 'gt', 'gte', 'lt', 'lte'];

function same(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return a === b;
}

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return cond.some((w: any) => matches(row, w));
    const value = row[key] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      // A compound unique key (companyId_billingCycleStart) is a nested where.
      if (!OPS.some((op) => op in cond)) return matches(row, cond);
      if ('in' in cond && !cond.in.some((v: unknown) => same(v, value)))
        return false;
      if ('notIn' in cond && cond.notIn.some((v: unknown) => same(v, value)))
        return false;
      if ('not' in cond && same(value, cond.not)) return false;
      if ('gt' in cond && !(value !== null && value > cond.gt)) return false;
      if ('gte' in cond && !(value !== null && value >= cond.gte)) return false;
      if ('lt' in cond && !(value !== null && value < cond.lt)) return false;
      if ('lte' in cond && !(value !== null && value <= cond.lte)) return false;
      return true;
    }
    return same(value, cond);
  });
}

function apply(row: any, data: any) {
  for (const [key, value] of Object.entries(data ?? {})) {
    row[key] =
      value !== null && typeof value === 'object' && 'increment' in value
        ? (row[key] ?? 0) + (value as { increment: number }).increment
        : value;
  }
  row.updatedAt = new Date();
  return row;
}

function createFakePrisma() {
  const tables: Record<string, any[]> = {};
  let seq = 0;
  const model = (name: string) => {
    const rows = (tables[name] ??= []);
    return {
      rows,
      findUnique: async ({ where }: any) =>
        rows.find((r) => matches(r, where)) ?? null,
      findFirst: async ({ where }: any = {}) =>
        rows.find((r) => matches(r, where)) ?? null,
      findUniqueOrThrow: async ({ where }: any) => {
        const row = rows.find((r) => matches(r, where));
        if (!row) throw new Error(`${name} not found`);
        return row;
      },
      findMany: async ({ where, take }: any = {}) =>
        rows.filter((r) => matches(r, where)).slice(0, take ?? rows.length),
      count: async ({ where }: any = {}) =>
        rows.filter((r) => matches(r, where)).length,
      create: async ({ data }: any) => {
        const row = {
          id: `${name}_${++seq}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => matches(r, where));
        if (!row) throw new Error(`${name} not found`);
        return apply(row, data);
      },
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => apply(r, data));
        return { count: hit.length };
      },
      aggregate: async ({ where, _sum }: any) => {
        const hit = rows.filter((r) => matches(r, where));
        const sum: Record<string, number | null> = {};
        for (const field of Object.keys(_sum ?? {})) {
          const values = hit.map((r) => r[field]).filter((v) => v != null);
          sum[field] = values.length
            ? values.reduce((a: number, b: number) => a + b, 0)
            : null;
        }
        return { _sum: sum, _count: hit.length };
      },
    };
  };

  const store: any = {
    aiAgent: model('aiAgent'),
    aiAgentVersion: model('aiAgentVersion'),
    aiAgentTool: model('aiAgentTool'),
    aiCallSession: model('aiCallSession'),
    billingConfig: model('billingConfig'),
    billingRate: model('billingRate'),
    call: model('call'),
    callEvent: model('callEvent'),
    callUsage: model('callUsage'),
    creditPricingVersion: model('creditPricingVersion'),
    usage: model('usage'),
    user: model('user'),
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(store),
  };
  return { store, tables };
}

// ── Wallet + ledger (CreditService semantics: idempotent, never negative) ──
class FakeCredits {
  balances = new Map<string, number>();
  granted = new Map<string, number>();
  ledger: any[] = [];

  fund(userId: string, credits: number) {
    this.balances.set(userId, (this.balances.get(userId) ?? 0) + credits);
    this.granted.set(userId, (this.granted.get(userId) ?? 0) + credits);
  }

  balance(userId: string) {
    return this.balances.get(userId) ?? 0;
  }

  async withWallet(userId: string, fn: any, tx?: any) {
    return fn(tx ?? this.store, {
      id: `wallet_${userId}`,
      balance: this.balance(userId),
      reserved: 0,
    });
  }

  async debit(input: any) {
    const existing = this.ledger.find(
      (t) => t.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      return {
        debited: -existing.amount,
        shortfall: existing.metadata.shortfall,
        duplicate: true,
      };
    }
    const available = this.balance(input.userId);
    if (input.amount > available && !input.allowPartial) {
      throw new Error('InsufficientCreditsError');
    }
    const debited = Math.min(input.amount, available);
    const shortfall = input.amount - debited;
    this.balances.set(input.userId, available - debited);
    this.ledger.push({
      userId: input.userId,
      type: input.type,
      amount: -debited,
      balanceBefore: available,
      balanceAfter: available - debited,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      metadata: { ...input.metadata, requested: input.amount, shortfall },
    });
    return { debited, shortfall, duplicate: false };
  }

  async getSummary(userId: string) {
    const balance = this.balance(userId);
    const granted = this.granted.get(userId) ?? 0;
    return {
      granted,
      balance,
      available: balance,
      usedPercent: granted ? ((granted - balance) / granted) * 100 : 0,
    };
  }

  constructor(private store: any) {}
}

function createWorld() {
  const { store, tables } = createFakePrisma();
  store.billingConfig.rows.push({
    key: 'default',
    audioCreditsPerMinute: 1,
    videoCreditsPerMinute: 4,
    screenShareCreditsPerMinute: 1,
    aiCreditsPerMinute: AI_RATE,
    minimumCreditsToStartCall: 1,
    lowCreditThresholds: [80, 90, 100],
  });
  const credits = new FakeCredits(store);
  const config = new BillingConfigService(store, {} as never);
  const subscriptions = {
    getActiveSubscription: jest.fn(async (userId: string) => ({
      id: `sub_${userId}`,
      planType: 'PAID',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
    })),
    serialize: (sub: any) => ({ id: sub.id, planType: sub.planType }),
  };
  // Per-media caps read the ledger's media keys, like EntitlementService.
  const entitlements = {
    mediaCreditsUsed: jest.fn(async (userId: string) => {
      const rows = credits.ledger.filter(
        (t) => t.userId === userId && t.type === 'USAGE_DEBIT',
      );
      const sum = (key: string) =>
        rows.reduce((a, t) => a + Number(t.metadata[key] ?? 0), 0);
      return {
        audioCredits: sum('audioCredits'),
        videoCredits: sum('videoCredits'),
        screenShareCredits: sum('screenShareCredits'),
      };
    }),
  };
  const notify = { creditsThreshold: jest.fn(async () => undefined) };
  const usageBilling = new UsageBillingService(
    store,
    config,
    credits as never,
    subscriptions as never,
    entitlements as never,
    notify as never,
  );
  const pricing = new AiPricingService();
  const billing = new AiBillingService(
    store,
    config,
    credits as never,
    subscriptions as never,
    usageBilling,
    pricing,
  );
  const access = new AiAccessService(
    subscriptions as never,
    credits as never,
    config,
    { user: { findUnique: jest.fn().mockResolvedValue({ prepaidSince: null }) } } as never,
  );
  const sessions = new AiSessionService(store, access, billing);
  return {
    store,
    tables,
    credits,
    notify,
    usageBilling,
    billing,
    pricing,
    access,
    sessions,
  };
}

type World = ReturnType<typeof createWorld>;

async function seedSession(
  world: World,
  overrides: Record<string, unknown> = {},
) {
  const callId = `call_${world.tables.aiCallSession.length + 1}`;
  await world.store.call.create({
    data: { id: callId, status: 'ACCEPTED', source: 'AI_AGENT' },
  });
  return world.store.aiCallSession.create({
    data: {
      callId,
      agentId: AGENT,
      agentVersionId: 'version_1',
      projectId: 'project_ai',
      ownerId: OWNER,
      provider: 'gemini',
      model: 'gemini-3.8-live',
      status: 'ACTIVE',
      connectedAt: new Date(NOW.getTime() - 61_000),
      lastHeartbeatAt: NOW,
      maxDurationSeconds: 1800,
      inputTokens: 0,
      outputTokens: 0,
      durationSeconds: null,
      creditsCharged: null,
      creditsShortfall: null,
      usageRecordedAt: null,
      providerCostPaise: null,
      ...overrides,
    },
  });
}

describe('AI billing', () => {
  let world: World;

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    process.env.AI_ENABLED = 'true';
    world = createWorld();
  });

  afterEach(() => {
    jest.useRealTimers();
    AI_ENV.forEach((name) => delete process.env[name]);
  });

  describe('debit amount and rounding', () => {
    it.each([
      [0, 15, 0],
      [1, 15, 1],
      [60, 15, 15],
      [61, 15, 16],
      [90, 15, 23],
      [600, 15, 150],
      [61, 4, 5],
    ])(
      '%i s at %i credits/min is %i credits (fractional minutes, rounded up once like human calls)',
      (seconds, rate, expected) => {
        expect(aiCreditsFor(seconds, rate)).toBe(expected);
      },
    );

    it('debits the wallet at finalize with the usage type and an AI_SESSION reference', async () => {
      world.credits.fund(OWNER, 1000);
      const session = await seedSession(world);

      await world.sessions.finalize(session.id, { reason: 'participant' });

      expect(world.credits.ledger).toHaveLength(1);
      const [entry] = world.credits.ledger;
      expect(entry).toMatchObject({
        userId: OWNER,
        type: 'USAGE_DEBIT',
        amount: -16,
        referenceType: 'AI_SESSION',
        referenceId: session.id,
        idempotencyKey: `ai-session:${session.id}`,
        metadata: {
          sessionId: session.id,
          aiSeconds: 61,
          aiMinutes: 1.02,
          aiCredits: 16,
          aiCreditsPerMinute: AI_RATE,
          shortfall: 0,
        },
      });
      // AI debits never count against the plan's audio/video/screen caps.
      expect(entry.metadata).not.toHaveProperty('audioCredits');
      expect(world.credits.balance(OWNER)).toBe(984);

      const row = world.tables.aiCallSession[0];
      expect(row).toMatchObject({
        status: 'ENDED',
        durationSeconds: 61,
        creditsCharged: 16,
        creditsShortfall: null,
      });
      expect(row.usageRecordedAt).toEqual(NOW);
      expect(
        world.tables.callEvent.find((e) => e.event === 'AI_BILLING_RECORDED')
          ?.metadata,
      ).toEqual({
        sessionId: session.id,
        durationSeconds: 61,
        credits: 16,
        creditsCharged: 16,
        shortfall: 0,
      });
    });

    it('a call that never connected is recorded with 0 credits and no ledger entry', async () => {
      world.credits.fund(OWNER, 100);
      const session = await seedSession(world, { connectedAt: null });

      await world.sessions.finalize(session.id, {
        reason: 'provider_unavailable',
        status: 'FAILED',
        noDuration: true,
      });

      expect(world.credits.ledger).toHaveLength(0);
      expect(world.credits.balance(OWNER)).toBe(100);
      expect(world.tables.aiCallSession[0]).toMatchObject({
        creditsCharged: 0,
        usageRecordedAt: NOW,
      });
    });
  });

  describe('idempotency', () => {
    it('finalizing twice (and every other end path) debits once', async () => {
      world.credits.fund(OWNER, 1000);
      const session = await seedSession(world);

      await world.sessions.finalize(session.id, { reason: 'participant' });
      await world.sessions.finalize(session.id, { reason: 'participant' });
      await world.sessions.end(session.id, 'api');
      jest.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
      await world.billing.billUnrecordedSessions();

      expect(world.credits.ledger).toHaveLength(1);
      expect(world.credits.balance(OWNER)).toBe(984);
    });

    it('a stale copy of the session (usageRecordedAt unset in memory) cannot debit again', async () => {
      world.credits.fund(OWNER, 1000);
      const session = await seedSession(world);
      await world.sessions.finalize(session.id, { reason: 'participant' });
      const stale = {
        ...world.tables.aiCallSession[0],
        usageRecordedAt: null,
      };

      await expect(world.billing.recordSession(stale)).resolves.toBe(false);
      await expect(world.billing.recordSession(stale)).resolves.toBe(false);

      expect(world.credits.ledger).toHaveLength(1);
    });

    it('the sweep bills a session whose finalize hook failed', async () => {
      world.credits.fund(OWNER, 1000);
      await seedSession(world, {
        status: 'ENDED',
        durationSeconds: 120,
        endedAt: new Date(NOW.getTime() - 5 * 60_000),
      });

      await world.billing.billUnrecordedSessions();
      await world.billing.billUnrecordedSessions();

      expect(world.credits.ledger).toHaveLength(1);
      expect(world.credits.ledger[0].amount).toBe(-30);
    });
  });

  describe('running out of credits', () => {
    it('takes what is left, never goes negative and records the shortfall', async () => {
      world.credits.fund(OWNER, 10);
      const session = await seedSession(world, {
        connectedAt: new Date(NOW.getTime() - 120_000),
      });

      await world.sessions.finalize(session.id, { reason: 'max_duration' });

      expect(world.credits.balance(OWNER)).toBe(0);
      expect(world.credits.ledger[0]).toMatchObject({
        amount: -10,
        metadata: { requested: 30, shortfall: 20 },
      });
      expect(world.tables.aiCallSession[0]).toMatchObject({
        creditsCharged: 10,
        creditsShortfall: 20,
      });
    });

    it('reuses the low-credit threshold notifications (same period key as human calls)', async () => {
      world.credits.fund(OWNER, 100);
      const session = await seedSession(world, {
        connectedAt: new Date(NOW.getTime() - 6 * 60_000),
      });

      await world.sessions.finalize(session.id, { reason: 'participant' });

      expect(world.credits.balance(OWNER)).toBe(10);
      expect(world.notify.creditsThreshold).toHaveBeenCalledTimes(1);
      expect(world.notify.creditsThreshold).toHaveBeenCalledWith(
        OWNER,
        90,
        `sub_${OWNER}:${PERIOD_START.toISOString()}`,
      );
    });
  });

  describe('starting a session', () => {
    const create = () =>
      world.sessions.createApiSession({ id: 'project_ai', ownerId: OWNER }, {
        agentId: AGENT,
        participant: { id: 'cust_1' },
      } as never);

    beforeEach(async () => {
      await world.store.user.create({ data: { id: OWNER, status: 'ACTIVE' } });
      await world.store.aiAgent.create({
        data: {
          id: AGENT,
          projectId: 'project_ai',
          name: 'Support',
          status: 'ACTIVE',
          deletedAt: null,
          currentVersionId: 'version_1',
        },
      });
      await world.store.aiAgentVersion.create({
        data: {
          id: 'version_1',
          maxDurationSeconds: 600,
          provider: 'gemini',
          model: 'gemini-3.8-live',
        },
      });
    });

    const errorCode = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'OK';
      } catch (e: any) {
        return e?.getResponse?.()?.code ?? e?.constructor?.name;
      }
    };

    it('caps maxDurationSeconds at whole minutes the balance pays for', async () => {
      world.credits.fund(OWNER, 50); // 3 minutes at 15/min (+5 spare)

      await create();

      expect(world.tables.aiCallSession[0].maxDurationSeconds).toBe(180);
      expect(maxSecondsForBalance(50, 15)).toBe(180);
      expect(maxSecondsForBalance(14, 15)).toBe(0);
    });

    it('keeps the agent max when the balance covers more', async () => {
      world.credits.fund(OWNER, 100_000);

      await create();

      expect(world.tables.aiCallSession[0].maxDurationSeconds).toBe(600);
    });

    it('rejects with AI_INSUFFICIENT_CREDITS below one AI minute', async () => {
      world.credits.fund(OWNER, AI_RATE - 1);

      await expect(errorCode(create())).resolves.toBe(
        'AI_INSUFFICIENT_CREDITS',
      );
      expect(world.tables.aiCallSession).toHaveLength(0);
      expect(world.tables.call).toHaveLength(0);
    });

    it('requires max(minimumCreditsToStartCall, aiCreditsPerMinute)', async () => {
      world.store.billingConfig.rows[0].minimumCreditsToStartCall = 40;
      world.credits.fund(OWNER, 39);
      await expect(world.access.hasCreditsToStart(OWNER)).resolves.toBe(false);
      await expect(errorCode(create())).resolves.toBe(
        'AI_INSUFFICIENT_CREDITS',
      );

      world.credits.fund(OWNER, 1);
      await expect(world.access.hasCreditsToStart(OWNER)).resolves.toBe(true);
      await expect(errorCode(create())).resolves.toBe('OK');
    });
  });

  describe('provider cost (admin only)', () => {
    it('prices token counts per model in paise at AI_USD_INR_RATE', () => {
      const usage = {
        provider: 'gemini',
        model: 'gemini-3.8-live',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      };
      // ($3 + $12) × ₹88 = ₹1,320
      expect(world.pricing.providerCostPaise(usage)).toBe(132_000);
      process.env.AI_USD_INR_RATE = '80';
      expect(world.pricing.providerCostPaise(usage)).toBe(120_000);
      process.env.AI_USD_INR_RATE = 'nonsense';
      expect(world.pricing.providerCostPaise(usage)).toBe(132_000);
    });

    it('falls back to the provider default and returns null for unknown providers', () => {
      const small = { inputTokens: 10_000, outputTokens: 5_000 };
      // ($0.03 + $0.06) × ₹88 = ₹7.92
      expect(
        world.pricing.providerCostPaise({
          provider: 'gemini',
          model: null,
          ...small,
        }),
      ).toBe(792);
      expect(
        world.pricing.providerCostPaise({
          provider: 'mystery',
          model: 'x',
          ...small,
        }),
      ).toBeNull();
    });

    it('is saved on the session at finalize and summarized with margin for admins', async () => {
      world.credits.fund(OWNER, 1000);
      world.store.creditPricingVersion.findFirst = async () => ({ creditPricePaise: 45 });
      const session = await seedSession(world, {
        connectedAt: new Date(NOW.getTime() - 120_000),
      });
      await world.sessions.finalize(session.id, {
        reason: 'participant',
        usage: { inputTokens: 10_000, outputTokens: 5_000 },
      });
      expect(world.tables.aiCallSession[0].providerCostPaise).toBe(792);

      const summary = await world.billing.adminSummary(
        PERIOD_START,
        new Date('2026-11-01T00:00:00Z'),
      );
      expect(summary).toMatchObject({
        sessions: 1,
        minutes: 2,
        creditsCharged: 30,
        providerCostPaise: 792,
        creditValuePaise: 45,
        creditValueSource: 'published',
        revenuePaise: 1350,
        marginPaise: 558,
        marginPercent: 41.33,
      });

      // Without a published price, AI_CREDIT_VALUE_PAISE applies.
      world.store.creditPricingVersion.findFirst = async () => null;
      process.env.AI_CREDIT_VALUE_PAISE = '100';
      const fromEnv = await world.billing.adminSummary(
        PERIOD_START,
        new Date('2026-11-01T00:00:00Z'),
      );
      expect(fromEnv).toMatchObject({
        creditValueSource: 'env',
        revenuePaise: 3000,
        marginPaise: 2208,
      });
    });

    it('is not part of the customer usage payload', async () => {
      world.credits.fund(OWNER, 1000);
      const session = await seedSession(world);
      await world.sessions.finalize(session.id, {
        reason: 'participant',
        usage: { inputTokens: 10_000, outputTokens: 5_000 },
      });

      const current = await world.usageBilling.getCurrentUsage(OWNER);
      expect(current.ai).toEqual({ sessions: 1, minutes: 1.02, credits: 16 });
      expect(JSON.stringify(current)).not.toMatch(/providerCost|Paise/);
    });
  });

  describe('invariant: an account with no AI usage', () => {
    /** Human-call billing for HUMAN, optionally with AI activity elsewhere. */
    async function run(withAi: boolean) {
      const w = createWorld();
      w.credits.fund(HUMAN, 500);
      if (withAi) {
        w.credits.fund(OWNER, 500);
        const live = await seedSession(w);
        await seedSession(w, {
          status: 'ENDED',
          durationSeconds: 45,
          endedAt: new Date(NOW.getTime() - 10 * 60_000),
        });
        await w.sessions.finalize(live.id, { reason: 'participant' });
      }
      await w.usageBilling.recordCallUsage(HUMAN, 'human_call_1', {
        audioMinutes: 3.5,
        videoMinutes: 0,
        screenShareMinutes: 0,
        participants: 2,
        endedAt: NOW,
      });
      if (withAi) {
        await w.billing.billUnrecordedSessions();
        await w.sessions.sweepStaleSessions();
        await w.sessions.expireSessions();
      }
      await w.usageBilling.recordCallUsage(HUMAN, 'human_call_2', {
        audioMinutes: 0,
        videoMinutes: 2.2,
        screenShareMinutes: 1.1,
        participants: 2,
        endedAt: NOW,
      });
      if (withAi) await w.billing.billUnrecordedSessions();

      const strip = (row: any) => {
        const { id, usageId, createdAt, updatedAt, ...rest } = row;
        void id;
        void usageId;
        void createdAt;
        void updatedAt;
        return rest;
      };
      const current = await w.usageBilling.getCurrentUsage(HUMAN);
      const { ai, ...rest } = current;
      return {
        world: w,
        ai,
        snapshot: {
          balance: w.credits.balance(HUMAN),
          ledger: w.credits.ledger.filter((t) => t.userId === HUMAN),
          usage: w.tables.usage.filter((u) => u.companyId === HUMAN).map(strip),
          callUsage: w.tables.callUsage.map(strip),
          current: { ...rest, cycle: rest.cycle },
          notifications: w.notify.creditsThreshold.mock.calls.filter(
            (c: unknown[]) => c[0] === HUMAN,
          ),
        },
      };
    }

    it('has identical balances, ledger and usage numbers with AI billing in place', async () => {
      const baseline = await run(false);
      const withAi = await run(true);

      // AI activity really happened in the second world...
      expect(
        withAi.world.credits.ledger.filter(
          (t) => t.referenceType === 'AI_SESSION',
        ),
      ).toHaveLength(2);
      // ...and changed nothing for the account that didn't use it.
      expect(withAi.snapshot).toEqual(baseline.snapshot);
      expect(baseline.snapshot.balance).toBe(500 - 4 - 9 - 2);
      expect(withAi.ai).toEqual({ sessions: 0, minutes: 0, credits: 0 });
      expect(baseline.ai).toEqual({ sessions: 0, minutes: 0, credits: 0 });
      // AI calls write no human-call billing rows.
      expect(withAi.world.tables.callUsage).toHaveLength(2);
      expect(
        withAi.world.tables.usage.filter((u) => u.companyId === OWNER),
      ).toHaveLength(0);
    });
  });
});
