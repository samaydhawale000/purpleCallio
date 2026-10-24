import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AiCallsService, aggregateAnalytics } from './ai-calls.service';
import { AiTranscriptService } from './ai-transcript.service';

const OWNER = 'user_a';
const STRANGER = 'user_b';
const NOW = new Date('2026-10-17T12:00:00Z');
const at = (iso: string) => new Date(`2026-10-${iso}Z`);

function session(overrides: Record<string, unknown>) {
  return {
    id: 'session_1',
    callId: 'call_1',
    agentId: 'agent_1',
    agent: { name: 'Ava' },
    agentVersionId: 'version_1',
    ownerId: OWNER,
    participantId: 'user_1',
    participantName: 'Sam',
    status: 'ENDED',
    terminationReason: 'participant',
    connectedAt: at('16T10:00:00'),
    endedAt: at('16T10:02:00'),
    durationSeconds: 120,
    maxDurationSeconds: 600,
    creditsCharged: 30,
    toolCallCount: 1,
    metadata: null,
    createdAt: at('16T09:59:50'),
    ...overrides,
  };
}

function createFakePrisma(rows: any[]) {
  const inRange = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
      if (key === 'createdAt') {
        return row.createdAt >= cond.gte && row.createdAt < cond.lt;
      }
      return row[key] === cond;
    });
  return {
    aiCallSession: {
      count: jest.fn(async ({ where }: any) => rows.filter((r) => inRange(r, where)).length),
      findMany: jest.fn(async ({ where, skip = 0, take }: any) =>
        rows
          .filter((r) => inRange(r, where))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(skip, take === undefined ? undefined : skip + take),
      ),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => inRange(r, where)) ?? null),
    },
    callEvent: {
      findMany: jest.fn(async () => [
        { event: 'AI_SESSION_CREATED', participantId: 'user_1', metadata: null, createdAt: at('16T09:59:50') },
      ]),
    },
    aiToolInvocation: {
      findMany: jest.fn(async () => [
        { id: 'inv_1', toolId: 'tool_1', toolName: 'lookup_order', status: 'SUCCESS', latencyMs: 120, errorCode: null, createdAt: at('16T10:01:00') },
      ]),
    },
    aiConversationMessage: {
      findMany: jest.fn(async ({ where }: any) =>
        where.sessionId === 'session_1'
          ? [{ role: 'USER', content: 'Hello', createdAt: at('16T10:00:05') }]
          : [],
      ),
    },
  } as any;
}

function service(rows: any[]) {
  const prisma = createFakePrisma(rows);
  return { prisma, calls: new AiCallsService(prisma, new AiTranscriptService(prisma)) };
}

describe('AiCallsService', () => {
  it('lists only the caller’s calls, newest first, with the summary fields', async () => {
    const { calls } = service([
      session({ id: 's_old', createdAt: at('10T08:00:00') }),
      session({ id: 's_new', createdAt: at('16T08:00:00') }),
      session({ id: 's_foreign', ownerId: STRANGER }),
    ]);

    const result = await calls.list(OWNER, { to: '2026-10-17' });

    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.sessionId)).toEqual(['s_new', 's_old']);
    expect(result.items[0]).toMatchObject({
      agentName: 'Ava',
      participantId: 'user_1',
      durationSeconds: 120,
      status: 'ENDED',
      terminationReason: 'participant',
      creditsCharged: 30,
      toolCallCount: 1,
    });
  });

  it('filters by agent and pages', async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      session({ id: `s_${i}`, createdAt: new Date(NOW.getTime() - (i + 1) * 60_000) }),
    );
    rows.push(session({ id: 's_other_agent', agentId: 'agent_2', createdAt: NOW }));
    const { calls } = service(rows);

    const page2 = await calls.list(OWNER, {
      agentId: 'agent_1',
      page: '2',
      from: '2026-10-01',
      to: '2026-10-18',
    });

    expect(page2.total).toBe(30);
    expect(page2.items).toHaveLength(5);
    expect(page2.items.every((i) => i.agentId === 'agent_1')).toBe(true);
  });

  it('returns the detail with events, tool invocations and the transcript', async () => {
    const { calls } = service([session({})]);

    const detail = await calls.detail(OWNER, 'session_1');

    expect(detail.events.map((e) => e.event)).toEqual(['AI_SESSION_CREATED']);
    expect(detail.toolInvocations).toEqual([
      expect.objectContaining({ toolName: 'lookup_order', status: 'SUCCESS' }),
    ]);
    expect(detail.transcriptStored).toBe(true);
    expect(detail.transcript).toEqual([
      { role: 'user', content: 'Hello', createdAt: at('16T10:00:05') },
    ]);
  });

  it('404s on another account’s call', async () => {
    const { calls, prisma } = service([session({ ownerId: STRANGER })]);

    await expect(calls.detail(OWNER, 'session_1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.callEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.aiConversationMessage.findMany).not.toHaveBeenCalled();
  });

  it('only aggregates the caller’s sessions in the range', async () => {
    const { calls } = service([
      session({ id: 'mine' }),
      session({ id: 'foreign', ownerId: STRANGER }),
      session({ id: 'too_old', createdAt: at('01T00:00:00') }),
    ]);

    const result = await calls.analytics(
      OWNER,
      { from: '2026-10-10', to: '2026-10-17' },
      NOW,
    );

    expect(result.totalSessions).toBe(1);
    expect(result.minutesPerDay).toHaveLength(8);
  });

  it('rejects inverted and over-long ranges', async () => {
    const { calls } = service([]);
    await expect(
      calls.analytics(OWNER, { from: '2026-10-17', to: '2026-10-01' }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      calls.analytics(OWNER, { from: '2024-01-01', to: '2026-10-01' }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('aggregateAnalytics', () => {
  const from = at('15T00:00:00');
  const to = at('17T00:00:00');

  it('sums minutes, credits and tool calls and counts outcomes', () => {
    const result = aggregateAnalytics(
      [
        session({ durationSeconds: 120, creditsCharged: 30, toolCallCount: 2 }),
        session({ durationSeconds: 60, creditsCharged: 15, toolCallCount: 0 }),
        // Never answered: counts as a session, not toward the average.
        session({ status: 'FAILED', connectedAt: null, endedAt: at('16T11:00:00'), durationSeconds: 0, creditsCharged: null, toolCallCount: 0 }),
        session({ status: 'EXPIRED', connectedAt: null, endedAt: null, durationSeconds: null, creditsCharged: null, toolCallCount: 0, createdAt: at('15T08:00:00') }),
      ] as any,
      from,
      to,
      NOW,
    );

    expect(result).toMatchObject({
      totalSessions: 4,
      totalMinutes: 3,
      averageDurationSeconds: 90,
      completed: 2,
      failed: 1,
      expired: 1,
      inProgress: 0,
      toolCalls: 2,
      creditsUsed: 45,
    });
  });

  it('buckets minutes per UTC day, including empty days', () => {
    const result = aggregateAnalytics(
      [
        session({ connectedAt: at('15T23:59:00'), durationSeconds: 90 }),
        session({ connectedAt: at('16T00:01:00'), durationSeconds: 30 }),
        session({ connectedAt: at('16T05:00:00'), durationSeconds: 60 }),
      ] as any,
      from,
      to,
      NOW,
    );

    expect(result.minutesPerDay).toEqual([
      { date: '2026-10-15', minutes: 1.5, sessions: 1 },
      { date: '2026-10-16', minutes: 1.5, sessions: 2 },
    ]);
  });

  it('finds peak concurrency; back-to-back calls do not overlap', () => {
    const call = (start: string, end: string | null) =>
      session({ connectedAt: at(start), endedAt: end ? at(end) : null, status: end ? 'ENDED' : 'ACTIVE' });

    const result = aggregateAnalytics(
      [
        call('16T10:00:00', '16T10:10:00'),
        call('16T10:05:00', '16T10:20:00'),
        call('16T10:08:00', '16T10:09:00'),
        call('16T10:10:00', '16T10:15:00'), // starts as the first ends
        call('16T11:00:00', null), // still live: runs until now
      ] as any,
      from,
      to,
      NOW,
    );

    expect(result.peakConcurrency).toBe(3);
    expect(result.inProgress).toBe(1);
  });

  it('is all zeros with no sessions', () => {
    const result = aggregateAnalytics([], from, to, NOW);
    expect(result).toMatchObject({
      totalSessions: 0,
      totalMinutes: 0,
      averageDurationSeconds: 0,
      peakConcurrency: 0,
    });
  });
});
