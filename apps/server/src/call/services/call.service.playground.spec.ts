import { CallService } from './call.service';

describe('CallService playground expiration cleanup', () => {
  it('ends expired and idle calls, removes session state and disconnects room sockets', async () => {
    const prisma: any = {
      call: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'call-expired' }, { id: 'call-idle' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      callEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const sessions = {
      deleteByCallId: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const gateway = { terminateCall: jest.fn() };
    const service = new CallService(
      prisma,
      sessions as any,
      gateway as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.expirePlaygroundCalls();

    const query = prisma.call.findMany.mock.calls[0][0].where;
    expect(query.source).toBe('PLAYGROUND');
    expect(query.OR[0].expiresAt.lte).toBeInstanceOf(Date);
    expect(query.OR[1].events.none.event).toBe('PARTICIPANT_JOINED');
    expect(sessions.deleteByCallId).toHaveBeenCalledTimes(2);
    expect(gateway.terminateCall).toHaveBeenCalledWith(
      'call-expired',
      'call.expired',
    );
  });

  it('ends active Playground sessions when the operational kill switch is off', async () => {
    process.env.PLAYGROUND_ENABLED = 'false';
    const prisma: any = {
      call: {
        findMany: jest.fn().mockResolvedValue([{ id: 'call-live' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      callEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const sessions = {
      deleteByCallId: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const gateway = { terminateCall: jest.fn() };
    const service = new CallService(
      prisma,
      sessions as any,
      gateway as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    try {
      await service.expirePlaygroundCalls();
      expect(prisma.call.findMany.mock.calls[0][0].where.OR).toBeUndefined();
      expect(prisma.callEvent.create).toHaveBeenCalledWith({
        data: { callId: 'call-live', event: 'CALL_ENDED' },
      });
      expect(gateway.terminateCall).toHaveBeenCalledWith(
        'call-live',
        'call.ended',
      );
    } finally {
      delete process.env.PLAYGROUND_ENABLED;
    }
  });
});
