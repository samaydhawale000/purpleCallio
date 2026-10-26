import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';

import { AiSessionService } from './ai-session.service';

const OWNER = 'user_a';
const STRANGER = 'user_b';
const PROJECT = 'project_a';
const OTHER_PROJECT = 'project_b';
const AGENT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-16T12:00:00Z');

const AI_ENV = [
  'AI_ENABLED',
  'AI_MAX_CONCURRENT_SESSIONS_PER_ACCOUNT',
  'AI_GLOBAL_MAX_CONCURRENT_SESSIONS',
  'AI_DAILY_MINUTES_PER_ACCOUNT',
  'AI_MONTHLY_MINUTES_PER_ACCOUNT',
  'AI_SESSION_TTL_SECONDS',
  'PUBLIC_API_URL',
];

/** Prisma-style where matcher for the operators AiSessionService uses. */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return cond.some((w: any) => matches(row, w));
    if (key === 'project') return matches(row.project, cond);
    const value = row[key] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('notIn' in cond && cond.notIn.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if ('gt' in cond && !(value > cond.gt)) return false;
      if ('gte' in cond && !(value >= cond.gte)) return false;
      if ('lte' in cond && !(value <= cond.lte)) return false;
      return true;
    }
    return value === cond;
  });
}

/**
 * In-memory fake. Advisory locks are real mutexes held until the
 * transaction callback settles, so parallel creates genuinely serialize
 * only if the service takes the lock before counting.
 */
function createFakePrisma() {
  let idCounter = 0;
  const projects = [
    { id: PROJECT, ownerId: OWNER },
    { id: OTHER_PROJECT, ownerId: STRANGER },
  ];
  const users = [
    { id: OWNER, status: 'ACTIVE', name: 'Asha' },
    { id: STRANGER, status: 'ACTIVE', name: 'Ben' },
  ];
  const agents: any[] = [
    {
      id: AGENT,
      projectId: PROJECT,
      name: 'Support bot',
      status: 'ACTIVE',
      currentVersionId: 'version_1',
      deletedAt: null,
    },
  ];
  const versions = [
    {
      id: 'version_1',
      agentId: AGENT,
      provider: 'gemini',
      model: 'gemini-live',
      maxDurationSeconds: 600,
    },
  ];
  const tools = [
    {
      id: 'tool_1',
      agentId: AGENT,
      name: 'lookup_order',
      description: 'Find an order',
      parametersSchema: { type: 'object', properties: {} },
      endpointUrl: 'https://api.acme.com/order',
      method: 'POST',
      enabled: true,
      requiresConfirmation: false,
      timeoutMs: 8000,
      signingSecret: 'bj_tool_secret',
      createdAt: new Date(1),
    },
    {
      id: 'tool_2',
      agentId: AGENT,
      name: 'refund',
      description: 'Refund',
      parametersSchema: {},
      endpointUrl: 'https://api.acme.com/refund',
      method: 'POST',
      enabled: false,
      requiresConfirmation: true,
      timeoutMs: 8000,
      signingSecret: 'bj_tool_secret_2',
      createdAt: new Date(2),
    },
  ];
  const sessions: any[] = [];
  const calls: any[] = [];
  const events: any[] = [];
  const lockOrder: string[] = [];
  const log: string[] = [];

  const locks = new Map<string, Promise<void>>();
  const acquire = async (key: string) => {
    while (locks.has(key)) await locks.get(key);
    let release!: () => void;
    locks.set(
      key,
      new Promise<void>((r) => (release = r)).then(() => {
        locks.delete(key);
      }),
    );
    return release;
  };

  const withProject = (agent: any) => ({
    ...agent,
    project: projects.find((p) => p.id === agent.projectId),
  });

  const store: any = {
    aiAgent: {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = agents.map(withProject).find((a) => matches(a, where));
        if (!row) return null;
        const { project: _project, ...agent } = row;
        return agent;
      }),
    },
    aiAgentVersion: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          versions.find((v) => v.id === where.id) ?? null,
      ),
    },
    aiAgentTool: {
      findMany: jest.fn(async ({ where }: any) =>
        tools.filter((t) => matches(t, where)),
      ),
    },
    user: {
      findUnique: jest.fn(
        async ({ where }: any) => users.find((u) => u.id === where.id) ?? null,
      ),
    },
    call: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `call_${++idCounter}`, endedAt: null, ...data };
        calls.push(row);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = calls.filter((c) => matches(c, where));
        rows.forEach((c) => Object.assign(c, data));
        return { count: rows.length };
      }),
    },
    callEvent: {
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
    },
    aiCallSession: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `session_${++idCounter}`,
          createdAt: new Date(),
          connectedAt: null,
          endedAt: null,
          terminationReason: null,
          durationSeconds: null,
          toolCallCount: 0,
          creditsCharged: null,
          inputTokens: 0,
          outputTokens: 0,
          providerSessionId: null,
          providerCostPaise: null,
          ...data,
        };
        sessions.push(row);
        return { ...row };
      }),
      count: jest.fn(async ({ where }: any) => {
        log.push('count');
        return sessions.filter((s) => matches(s, where)).length;
      }),
      aggregate: jest.fn(async ({ where }: any) => ({
        _sum: {
          durationSeconds: sessions
            .filter((s) => matches(s, where))
            .reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0),
          maxDurationSeconds: sessions
            .filter((s) => matches(s, where))
            .reduce((sum, s) => sum + (s.maxDurationSeconds ?? 0), 0),
        },
      })),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = sessions.find((s) => matches(s, where));
        return row ? { ...row } : null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const row = sessions.find((s) => matches(s, where));
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        sessions.filter((s) => matches(s, where)).map((s) => ({ ...s })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = sessions.filter((s) => matches(s, where));
        rows.forEach((s) => Object.assign(s, data));
        return { count: rows.length };
      }),
    },
  };

  store.$transaction = jest.fn(async (fn: any) => {
    const held: Array<() => void> = [];
    const tx = {
      ...store,
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values) => {
        const key =
          (values[0] as string | undefined) ??
          strings.join('?').match(/hashtext\('([^']+)'\)/)?.[1];
        lockOrder.push(key!);
        log.push(`lock:${key}`);
        held.push(await acquire(key!));
        return [{ locked: 1 }];
      }),
    };
    try {
      return await fn(tx);
    } finally {
      held.forEach((release) => release());
    }
  });

  return {
    store,
    projects,
    users,
    agents,
    sessions,
    calls,
    events,
    lockOrder,
    log,
  };
}

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e: any) {
    const response = e?.getResponse?.();
    return typeof response === 'object' && response?.code
      ? response.code
      : e?.constructor?.name;
  }
  return 'OK';
};

describe('AiSessionService', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let access: { hasPaidPlan: jest.Mock; hasCreditsToStart: jest.Mock };
  let service: AiSessionService;
  let paid: boolean;
  let credits: boolean;

  const project = { id: PROJECT, ownerId: OWNER };
  const create = (overrides: object = {}, proj = project) =>
    service.createApiSession(proj, {
      agentId: AGENT,
      participant: { id: 'cust_42', name: 'Ravi' },
      metadata: { orderId: 'A-1' },
      ...overrides,
    });

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    process.env.AI_ENABLED = 'true';
    fake = createFakePrisma();
    paid = true;
    credits = true;
    access = {
      hasPaidPlan: jest.fn(async () => paid),
      hasCreditsToStart: jest.fn(async () => credits),
    };
    service = new AiSessionService(fake.store, access as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    AI_ENV.forEach((name) => delete process.env[name]);
  });

  describe('create', () => {
    it('creates the Call, the session and a one-time token without provider details', async () => {
      process.env.PUBLIC_API_URL = 'https://api.purplecallio.test/';
      const result = await create();

      expect(Object.keys(result).sort()).toEqual(
        ['callId', 'connectUrl', 'expiresAt', 'sessionId', 'token'].sort(),
      );
      expect(result.token).toMatch(/^bj_ai_[A-Za-z0-9_-]{43}$/);
      expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 300_000));
      expect(result.connectUrl).toBe('https://api.purplecallio.test/ai');

      const [session] = fake.sessions;
      expect(session.tokenHash).toBe(
        createHash('sha256').update(result.token).digest('hex'),
      );
      expect(JSON.stringify(fake.sessions)).not.toContain(result.token);
      expect(session).toMatchObject({
        status: 'CREATED',
        agentId: AGENT,
        agentVersionId: 'version_1',
        projectId: PROJECT,
        ownerId: OWNER,
        provider: 'gemini',
        participantId: 'cust_42',
        participantName: 'Ravi',
        metadata: { orderId: 'A-1' },
        maxDurationSeconds: 600,
      });
      // Only enabled tools, and never their signing secrets.
      expect(session.toolsSnapshot).toEqual([
        expect.objectContaining({ id: 'tool_1', name: 'lookup_order' }),
      ]);
      expect(JSON.stringify(session.toolsSnapshot)).not.toContain('secret');

      expect(fake.calls[0]).toMatchObject({
        id: result.callId,
        source: 'AI_AGENT',
        type: 'AUDIO',
        status: 'INITIATED',
        callerId: 'cust_42',
        receiverId: `agent:${AGENT}`,
        receiverName: 'Support bot',
      });
      expect(fake.events.map((e) => e.event)).toEqual(['AI_SESSION_CREATED']);
    });

    it('runs each check in order with its own error code', async () => {
      fake.agents[0].status = 'DISABLED';
      fake.users[0].status = 'SUSPENDED';
      process.env.AI_ENABLED = 'false';
      paid = false;
      credits = false;
      process.env.AI_MAX_CONCURRENT_SESSIONS_PER_ACCOUNT = '1';
      fake.sessions.push({
        ownerId: OWNER,
        status: 'ACTIVE',
        createdAt: NOW,
        durationSeconds: null,
      });
      process.env.AI_DAILY_MINUTES_PER_ACCOUNT = '1';
      fake.sessions.push({
        ownerId: OWNER,
        status: 'ENDED',
        createdAt: NOW,
        durationSeconds: 60,
      });

      const otherProject = { id: OTHER_PROJECT, ownerId: STRANGER };
      expect(await errorCode(create({}, otherProject))).toBe(
        'AI_AGENT_NOT_FOUND',
      );
      expect(await errorCode(create())).toBe('AI_AGENT_DISABLED');
      fake.agents[0].status = 'ACTIVE';
      expect(await errorCode(create())).toBe('ForbiddenException'); // suspended
      fake.users[0].status = 'ACTIVE';
      expect(await errorCode(create())).toBe('AI_DISABLED');
      process.env.AI_ENABLED = 'true';
      expect(await errorCode(create())).toBe('AI_PAID_PLAN_REQUIRED');
      paid = true;
      expect(await errorCode(create())).toBe('AI_INSUFFICIENT_CREDITS');
      credits = true;
      expect(await errorCode(create())).toBe('AI_CONCURRENCY_LIMIT');
      fake.sessions[0].status = 'ENDED';
      expect(await errorCode(create())).toBe('AI_QUOTA_EXCEEDED');
      process.env.AI_DAILY_MINUTES_PER_ACCOUNT = '2';
      expect(await errorCode(create())).toBe('OK');
    });

    it('rejects a deleted agent as not found', async () => {
      fake.agents[0].deletedAt = NOW;
      expect(await errorCode(create())).toBe('AI_AGENT_NOT_FOUND');
    });

    it('blocks a Free-plan owner with AI_PAID_PLAN_REQUIRED', async () => {
      paid = false;
      const error = await create().catch((e) => e);
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({ code: 'AI_PAID_PLAN_REQUIRED' }),
      );
      expect(access.hasPaidPlan).toHaveBeenCalledWith(OWNER);
      expect(fake.sessions).toHaveLength(0);
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe('limits under the lock', () => {
    it('takes the owner lock, then the global lock, before counting', async () => {
      await create();
      expect(fake.log.slice(0, 3)).toEqual([
        `lock:purplecallio:ai:owner:${OWNER}`,
        'lock:purplecallio:ai:global',
        'count',
      ]);
    });

    it('lets only one of two parallel requests take the last account slot', async () => {
      process.env.AI_MAX_CONCURRENT_SESSIONS_PER_ACCOUNT = '1';
      const codes = await Promise.all([
        errorCode(create()),
        errorCode(create()),
      ]);
      expect(codes.sort()).toEqual(['AI_CONCURRENCY_LIMIT', 'OK']);
      expect(fake.sessions).toHaveLength(1);
    });

    it('counts other accounts toward the global limit', async () => {
      process.env.AI_GLOBAL_MAX_CONCURRENT_SESSIONS = '2';
      fake.sessions.push(
        { ownerId: STRANGER, status: 'CONNECTING', createdAt: NOW },
        {
          ownerId: STRANGER,
          status: 'CREATED',
          expiresAt: new Date(NOW.getTime() + 1000),
          createdAt: NOW,
        },
      );
      expect(await errorCode(create())).toBe('AI_CONCURRENCY_LIMIT');
    });

    it('holds the global cap under a burst and rejects the rest cleanly', async () => {
      process.env.AI_MAX_CONCURRENT_SESSIONS_PER_ACCOUNT = '100';
      process.env.AI_GLOBAL_MAX_CONCURRENT_SESSIONS = '5';
      const codes = await Promise.all(
        Array.from({ length: 40 }, () => errorCode(create())),
      );

      expect(codes.filter((c) => c === 'OK')).toHaveLength(5);
      expect(codes.filter((c) => c === 'AI_CONCURRENCY_LIMIT')).toHaveLength(
        35,
      );
      // Rejected requests leave no Call or session rows behind.
      expect(fake.sessions).toHaveLength(5);
      expect(fake.calls).toHaveLength(5);
    });

    it('does not count ended or never-connected expired sessions', async () => {
      process.env.AI_MAX_CONCURRENT_SESSIONS_PER_ACCOUNT = '1';
      fake.sessions.push(
        { ownerId: OWNER, status: 'ENDED', createdAt: NOW },
        {
          ownerId: OWNER,
          status: 'CREATED',
          expiresAt: new Date(NOW.getTime() - 1),
          createdAt: NOW,
        },
      );
      expect(await errorCode(create())).toBe('OK');
    });

    it('enforces the monthly quota from earlier days of the month', async () => {
      process.env.AI_MONTHLY_MINUTES_PER_ACCOUNT = '10';
      fake.sessions.push(
        {
          ownerId: OWNER,
          status: 'ENDED',
          createdAt: new Date('2026-10-02T09:00:00Z'),
          durationSeconds: 600,
        },
        // Last month doesn't count.
        {
          ownerId: OWNER,
          status: 'ENDED',
          createdAt: new Date('2026-09-30T09:00:00Z'),
          durationSeconds: 99_999,
        },
      );
      expect(await errorCode(create())).toBe('AI_QUOTA_EXCEEDED');
      process.env.AI_MONTHLY_MINUTES_PER_ACCOUNT = '11';
      expect(await errorCode(create())).toBe('OK');
    });

    it('caps the session duration at the remaining quota', async () => {
      process.env.AI_DAILY_MINUTES_PER_ACCOUNT = '3';
      fake.sessions.push({
        ownerId: OWNER,
        status: 'ENDED',
        createdAt: NOW,
        durationSeconds: 60,
      });
      await create();
      expect(fake.sessions[1].maxDurationSeconds).toBe(120);
    });

    it('counts the time running calls may still use against the quota', async () => {
      process.env.AI_DAILY_MINUTES_PER_ACCOUNT = '15';
      await create();
      expect(fake.sessions[0].maxDurationSeconds).toBe(600);
      await create();
      expect(fake.sessions[1].maxDurationSeconds).toBe(300);
      expect(await errorCode(create())).toBe('AI_QUOTA_EXCEEDED');
    });

    it('shares one balance between parallel calls, including finished unbilled ones', async () => {
      // The balance pays for 15 minutes.
      const billing = { maxSecondsByBalance: jest.fn(async () => 900) };
      service = new AiSessionService(fake.store, access as never, billing as never);
      fake.sessions.push({
        ownerId: OWNER,
        status: 'ENDED',
        createdAt: NOW,
        durationSeconds: 120,
        usageRecordedAt: null,
      });

      await create();
      expect(fake.sessions[1].maxDurationSeconds).toBe(600);
      await create();
      expect(fake.sessions[2].maxDurationSeconds).toBe(180);
      expect(await errorCode(create())).toBe('AI_INSUFFICIENT_CREDITS');
    });
  });

  describe('a plan that lapses mid-call', () => {
    it('blocks new sessions but never ends the running one', async () => {
      const { sessionId, token } = await create();
      fake.sessions[0].status = 'ACTIVE';
      paid = false;

      expect(await errorCode(create())).toBe('AI_PAID_PLAN_REQUIRED');
      await service.expireSessions();
      await expect(service.verifyToken(token)).resolves.toMatchObject({
        id: sessionId,
        status: 'ACTIVE',
      });
      expect(fake.sessions[0].status).toBe('ACTIVE');
      expect(fake.calls[0].status).toBe('INITIATED');
    });
  });

  describe('verifyToken', () => {
    it('accepts a fresh token', async () => {
      const { sessionId, token } = await create();
      await expect(service.verifyToken(token)).resolves.toMatchObject({
        id: sessionId,
      });
    });

    it('rejects an unknown or malformed token', async () => {
      await create();
      await expect(service.verifyToken('bj_ai_nope')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.verifyToken('bj_live_x')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token past AI_SESSION_TTL_SECONDS with AI_SESSION_EXPIRED', async () => {
      process.env.AI_SESSION_TTL_SECONDS = '60';
      const { token } = await create();
      jest.setSystemTime(new Date(NOW.getTime() + 60_000));
      expect(await errorCode(service.verifyToken(token))).toBe(
        'AI_SESSION_EXPIRED',
      );
      await service.expireSessions();
      expect(fake.sessions[0].status).toBe('EXPIRED');
      expect(await errorCode(service.verifyToken(token))).toBe(
        'AI_SESSION_EXPIRED',
      );
    });

    it('rejects an ended session with AI_SESSION_ENDED', async () => {
      const { sessionId, token } = await create();
      await service.end(sessionId, 'api');
      expect(await errorCode(service.verifyToken(token))).toBe(
        'AI_SESSION_ENDED',
      );
    });
  });

  describe('end', () => {
    it('is idempotent: one claim, one event, the Call ended once', async () => {
      const { sessionId, callId } = await create();
      jest.setSystemTime(new Date(NOW.getTime() + 5_000));

      const results = await Promise.all([
        service.end(sessionId, 'api'),
        service.end(sessionId, 'admin'),
      ]);
      await expect(service.end(sessionId, 'api')).resolves.toBe(false);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(fake.sessions[0]).toMatchObject({
        status: 'ENDED',
        endedAt: new Date(NOW.getTime() + 5_000),
        terminationReason: 'api',
      });
      expect(fake.calls[0]).toMatchObject({ id: callId, status: 'ENDED' });
      expect(
        fake.events.filter((e) => e.event === 'AI_SESSION_ENDED'),
      ).toHaveLength(1);
    });

    it('does not end an expired session', async () => {
      const { sessionId } = await create();
      fake.sessions[0].status = 'EXPIRED';
      await expect(service.end(sessionId, 'api')).resolves.toBe(false);
      expect(fake.sessions[0].status).toBe('EXPIRED');
    });

    it('scopes the API routes to the key project', async () => {
      const { sessionId } = await create();
      await expect(
        service.endForProject(OTHER_PROJECT, sessionId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getForProject(OTHER_PROJECT, sessionId),
      ).rejects.toThrow(NotFoundException);
      expect(fake.sessions[0].status).toBe('CREATED');

      const ended = await service.endForProject(PROJECT, sessionId);
      expect(ended).toMatchObject({ sessionId, status: 'ENDED' });
    });

    it('never returns the token hash or provider details from GET', async () => {
      const { sessionId } = await create();
      const view = await service.getForProject(PROJECT, sessionId);
      for (const hidden of [
        'tokenHash',
        'provider',
        'model',
        'providerSessionId',
        'providerCostPaise',
        'toolsSnapshot',
      ]) {
        expect(view).not.toHaveProperty(hidden);
      }
    });
  });

  describe('expireSessions', () => {
    it('expires only CREATED sessions past expiresAt and ends their Call', async () => {
      const stale = await create();
      jest.setSystemTime(new Date(NOW.getTime() + 301_000));
      const fresh = await create({ participant: { id: 'cust_43' } });

      await service.expireSessions();

      const byId = (id: string) => fake.sessions.find((s) => s.id === id);
      expect(byId(stale.sessionId)).toMatchObject({
        status: 'EXPIRED',
        terminationReason: 'expired',
      });
      expect(byId(fresh.sessionId).status).toBe('CREATED');
      expect(fake.calls.find((c) => c.id === stale.callId).status).toBe(
        'ENDED',
      );
      expect(
        fake.events.filter((e) => e.event === 'AI_SESSION_EXPIRED'),
      ).toEqual([expect.objectContaining({ callId: stale.callId })]);
    });

    it('does nothing while AI is disabled', async () => {
      await create();
      jest.setSystemTime(new Date(NOW.getTime() + 301_000));
      process.env.AI_ENABLED = 'false';
      await service.expireSessions();
      expect(fake.sessions[0].status).toBe('CREATED');
    });
  });
});
