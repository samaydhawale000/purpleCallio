import { CallService } from './call.service';
import { CallSource, CallType } from '@prisma/client';

describe('CallService AI agent calls', () => {
  it('endCall leaves AI calls to AiSessionService and bills nothing', async () => {
    const call = {
      id: 'call-ai',
      source: CallSource.AI_AGENT,
      project: { ownerId: 'user-1' },
      callerId: 'cust-1',
      receiverId: 'agent:a1',
      type: CallType.AUDIO,
      startedAt: new Date(Date.now() - 60_000),
      status: 'ACCEPTED',
    };
    const prisma = {
      call: {
        findUnique: jest.fn().mockResolvedValue(call),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(call),
      },
      callEvent: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const gateway = { terminateCall: jest.fn() };
    const webhooks = { fireForCall: jest.fn() };
    const usage = { recordCallUsage: jest.fn() };
    const segments = { rebuildSegmentsForCall: jest.fn() };
    const rating = { persistRatedCosts: jest.fn() };
    const callSessions = { deleteByCallId: jest.fn() };
    const service = new CallService(
      prisma as never,
      callSessions as never,
      gateway as never,
      webhooks as never,
      usage as never,
      segments as never,
      rating as never,
      { hasFeature: jest.fn().mockResolvedValue(true) } as never,
    );

    await expect(service.endCall(call.id)).resolves.toBe(call);

    expect(prisma.call.updateMany).not.toHaveBeenCalled();
    expect(prisma.callEvent.create).not.toHaveBeenCalled();
    expect(usage.recordCallUsage).not.toHaveBeenCalled();
    expect(segments.rebuildSegmentsForCall).not.toHaveBeenCalled();
    expect(rating.persistRatedCosts).not.toHaveBeenCalled();
    expect(webhooks.fireForCall).not.toHaveBeenCalled();
    expect(gateway.terminateCall).not.toHaveBeenCalled();
    expect(callSessions.deleteByCallId).not.toHaveBeenCalled();
  });
});
