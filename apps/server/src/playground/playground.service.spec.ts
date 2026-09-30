import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PlaygroundService } from './playground.service';

describe('PlaygroundService capacity and abuse controls', () => {
  const build = (counts = [0, 0, 0, 0, 0]) => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      call: {
        count: jest.fn().mockImplementation((args) => {
          if (args.where.creatorIdentity) return Promise.resolve(counts[1]);
          if (args.where.creatorIpKey) return Promise.resolve(counts[2]);
          return Promise.resolve(counts[0]);
        }),
        create: jest.fn().mockResolvedValue({ id: 'uuid-call' }),
      },
      playgroundAttempt: {
        count: jest
          .fn()
          .mockResolvedValueOnce(counts[3])
          .mockResolvedValueOnce(counts[4]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project' }),
        create: jest.fn(),
      },
      callSession: { create: jest.fn().mockResolvedValue({}) },
      callEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = { $transaction: jest.fn((callback) => callback(tx)) };
    return { service: new PlaygroundService(prisma), tx };
  };

  afterEach(() => {
    delete process.env.PLAYGROUND_ENABLED;
  });

  it('creates a PLAYGROUND call with a server expiry and two participant slots', async () => {
    const { service, tx } = build();
    const before = Date.now();
    const result = await service.createDemoCall(
      { userId: 'user-1' },
      'VIDEO',
      '127.0.0.1',
    );
    const call = tx.call.create.mock.calls[0][0].data;
    expect(call.source).toBe('PLAYGROUND');
    expect(call.maxParticipants).toBe(2);
    expect(call.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
    expect(call.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(result.callerToken).not.toBe(result.receiverToken);
    expect(tx.callSession.create.mock.calls[0][0].data.expiresAt).toEqual(
      call.expiresAt,
    );
  });

  it('selects a deserializable column from every advisory lock query', async () => {
    // pg_advisory_xact_lock() returns void, which Prisma's $queryRaw cannot
    // deserialize (P2010 on a real database; mocks hide it).
    const { service, tx } = build();
    await service.createDemoCall({ userId: 'user-1' }, 'VIDEO', '127.0.0.1');
    const sql = tx.$queryRaw.mock.calls.map((call: any[]) =>
      (call[0] as string[]).join('?'),
    );
    for (const query of sql.filter((q: string) =>
      q.includes('pg_advisory_xact_lock'),
    )) {
      expect(query).toMatch(/^SELECT 1 AS locked FROM pg_advisory_xact_lock\(/);
    }
    expect(sql.some((q: string) => q.includes('pg_advisory_xact_lock'))).toBe(
      true,
    );
  });

  it('enforces one active call per identity with 409', async () => {
    const { service } = build([0, 1, 0, 0, 0]);
    await expect(
      service.createDemoCall({ userId: 'user-1' }, 'VIDEO', '127.0.0.1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces the global capacity without blocking customer call paths', async () => {
    process.env.PLAYGROUND_MAX_ACTIVE_CALLS_GLOBAL = '1';
    const { service } = build([1, 0, 0, 0, 0]);
    await expect(
      service.createDemoCall({ userId: 'user-1' }, 'VIDEO', '127.0.0.1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    delete process.env.PLAYGROUND_MAX_ACTIVE_CALLS_GLOBAL;
  });

  it('returns 429 at the rolling IP quota', async () => {
    const { service } = build([0, 0, 0, 5, 0]);
    await expect(
      service.createDemoCall({ userId: 'user-1' }, 'VIDEO', '127.0.0.1'),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('honors the operational kill switch', async () => {
    process.env.PLAYGROUND_ENABLED = 'false';
    const { service } = build();
    await expect(
      service.createDemoCall({ userId: 'user-1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('enforces one active call per IP even for a different identity (409)', async () => {
    const { service, tx } = build([0, 0, 1, 0, 0]);
    await expect(
      service.createDemoCall({ userId: 'someone-else' }, 'VIDEO', '127.0.0.1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.call.create).not.toHaveBeenCalled();
  });

  it('enforces the daily per-IP limit (429)', async () => {
    const { service, tx } = build([0, 0, 0, 0, 20]);
    const error = await service
      .createDemoCall({ userId: 'user-1' }, 'VIDEO', '127.0.0.1')
      .catch((e: unknown) => e);
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(429);
    expect(tx.call.create).not.toHaveBeenCalled();
  });

  it('never allows a demo call longer than 60 seconds, whatever the env says', async () => {
    process.env.PLAYGROUND_CALL_DURATION_SECONDS = '600';
    try {
      const { service, tx } = build();
      await service.createDemoCall({ userId: 'user-1' }, 'VIDEO', '127.0.0.1');
      const call = tx.call.create.mock.calls[0][0].data;
      expect(call.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    } finally {
      delete process.env.PLAYGROUND_CALL_DURATION_SECONDS;
    }
  });
});
