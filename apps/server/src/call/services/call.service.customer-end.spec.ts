import { CallService } from './call.service';
import { CallSource, CallType } from '@prisma/client';

describe('CallService customer call termination', () => {
  it('terminates signaling sockets after the terminal status is claimed', async () => {
    const call = {
      id: 'call-1',
      source: CallSource.CUSTOMER,
      project: { ownerId: 'user-1' },
      callerId: 'caller-1',
      receiverId: 'receiver-1',
      type: CallType.AUDIO,
      startedAt: new Date(Date.now() - 60_000),
      status: 'ACCEPTED',
    };
    const prisma = {
      call: {
        findUnique: jest.fn().mockResolvedValue(call),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...call, status: 'ENDED' }),
      },
      callEvent: {
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue({ id: 'started-event' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const gateway = { terminateCall: jest.fn() };
    const service = new CallService(
      prisma as never,
      {} as never,
      gateway as never,
      { fireForCall: jest.fn() } as never,
      { recordCallUsage: jest.fn().mockResolvedValue({}) } as never,
      { rebuildSegmentsForCall: jest.fn().mockResolvedValue([]) } as never,
      {
        persistRatedCosts: jest.fn().mockResolvedValue({
          segments: [],
          totals: { audioMins: 1, videoMins: 0, screenShareMins: 0 },
        }),
      } as never,
      { hasFeature: jest.fn().mockResolvedValue(true) } as never,
    );

    await service.endCall(call.id);

    expect(gateway.terminateCall).toHaveBeenCalledWith(call.id, 'call.ended');
    expect(gateway.terminateCall.mock.invocationCallOrder[0]).toBeGreaterThan(
      prisma.call.updateMany.mock.invocationCallOrder[0],
    );
  });
});
