import { CallService } from './call.service';
import { CallSource, CallType } from '@prisma/client';

const NOW = new Date('2026-10-28T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function setup(calls: any[], roomCounts: Record<string, number> = {}) {
  const byId = new Map(calls.map((c) => [c.id, c]));
  const prisma = {
    call: {
      findMany: jest.fn().mockResolvedValue(calls),
      findUnique: jest.fn(({ where }) =>
        Promise.resolve({
          ...byId.get(where.id),
          source: CallSource.CUSTOMER,
          project: { ownerId: 'owner-1' },
          callerId: 'caller-1',
          receiverId: 'receiver-1',
          type: CallType.VIDEO,
          status: 'ACCEPTED',
        }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'ENDED' }),
    },
    callEvent: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ id: 'started' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const gateway = {
    terminateCall: jest.fn(),
    getRoomParticipantCount: jest.fn((id: string) => roomCounts[id] ?? 0),
  };
  const usage = { recordCallUsage: jest.fn().mockResolvedValue({}) };
  const service = new CallService(
    prisma as never,
    {} as never,
    gateway as never,
    { fireForCall: jest.fn() } as never,
    usage as never,
    { rebuildSegmentsForCall: jest.fn().mockResolvedValue([]) } as never,
    {
      persistRatedCosts: jest.fn().mockResolvedValue({
        segments: [{ participantCount: 2 }],
        totals: { audioMins: 0, videoMins: 6, screenShareMins: 0 },
      }),
    } as never,
    { hasFeature: jest.fn().mockResolvedValue(true) } as never,
  );
  // Pretend the server has been up long enough for clients to reconnect.
  (service as any).bootedAt = NOW.getTime() - 60 * 60_000;
  return { service, prisma, gateway, usage };
}

const call = (id: string, startedAt: Date, lastEventAt: Date | null) => ({
  id,
  startedAt,
  createdAt: startedAt,
  events: lastEventAt ? [{ createdAt: lastEventAt }] : [],
});

describe('CallService.endAbandonedCalls', () => {
  it('ends a call nobody is connected to at its last activity, not now', async () => {
    const leftAt = ago(15 * 60 * 60_000); // left 15 hours ago, never ended
    const { service, prisma, usage } = setup([call('stuck', ago(15.1 * 60 * 60_000), leftAt)]);

    expect(await service.endAbandonedCalls(NOW)).toEqual(['stuck']);

    expect(prisma.call.updateMany).toHaveBeenCalledWith({
      where: { id: 'stuck', status: { not: 'ENDED' } },
      data: { status: 'ENDED', endedAt: leftAt },
    });
    // The CALL_ENDED event closes the usage segments, so it is backdated too.
    expect(prisma.callEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ callId: 'stuck', event: 'CALL_ENDED', createdAt: leftAt }),
    });
    expect(usage.recordCallUsage).toHaveBeenCalledWith('owner-1', 'stuck', expect.objectContaining({ endedAt: leftAt }));
  });

  it('leaves calls alone while someone is still connected', async () => {
    const { service, prisma } = setup([call('live', ago(3 * 60 * 60_000), ago(2 * 60 * 60_000))], { live: 1 });
    expect(await service.endAbandonedCalls(NOW)).toEqual([]);
    expect(prisma.call.updateMany).not.toHaveBeenCalled();
  });

  it('gives participants the grace period to reconnect', async () => {
    const { service } = setup([call('blip', ago(10 * 60_000), ago(30_000))]);
    expect(await service.endAbandonedCalls(NOW)).toEqual([]);
  });

  it('falls back to the start time when a call has no events', async () => {
    const start = ago(5 * 60_000);
    const { service, prisma } = setup([call('quiet', start, null)]);
    await service.endAbandonedCalls(NOW);
    expect(prisma.call.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ENDED', endedAt: start } }),
    );
  });

  it('only looks at answered customer calls (not playground or AI)', async () => {
    const { service, prisma } = setup([]);
    await service.endAbandonedCalls(NOW);
    expect(prisma.call.findMany.mock.calls[0][0].where).toEqual({
      status: 'ACCEPTED',
      source: { notIn: [CallSource.PLAYGROUND, CallSource.AI_AGENT] },
    });
  });

  it('waits after a restart so clients can reconnect first', async () => {
    const { service, prisma } = setup([call('stuck', ago(60 * 60_000), ago(30 * 60_000))]);
    (service as any).bootedAt = NOW.getTime() - 30_000;
    expect(await service.endAbandonedCalls(NOW)).toEqual([]);
    expect(prisma.call.findMany).not.toHaveBeenCalled();
  });
});
