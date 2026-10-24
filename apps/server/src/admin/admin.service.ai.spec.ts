import { CallSource } from '@prisma/client';

import { AdminService } from './admin.service';

// Their SDK dependencies ship ESM that jest can't load; unused here.
jest.mock('../oci/oci-monitoring.service', () => ({
  OciMonitoringService: class {},
}));
jest.mock('../turn/turn.service', () => ({ TurnService: class {} }));

describe('AdminService.endCall', () => {
  function build(call: object | null) {
    const prisma = {
      call: {
        findUnique: jest.fn().mockResolvedValue(call),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...call, status: 'ENDED' }),
      },
    };
    const callService = { endCall: jest.fn().mockResolvedValue({ id: 'c' }) };
    const aiSessions = { end: jest.fn().mockResolvedValue(true) };
    const service = new AdminService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      callService as never,
      {} as never,
      {} as never,
      {} as never,
      aiSessions as never,
    );
    return { service, callService, aiSessions };
  }

  it('ends AI calls through AiSessionService with reason admin', async () => {
    const { service, callService, aiSessions } = build({
      source: CallSource.AI_AGENT,
      aiSession: { id: 'session-1' },
    });
    await expect(service.endCall('call-ai')).resolves.toMatchObject({
      status: 'ENDED',
    });
    expect(aiSessions.end).toHaveBeenCalledWith('session-1', 'admin');
    expect(callService.endCall).not.toHaveBeenCalled();
  });

  it('still ends human calls through CallService', async () => {
    const { service, callService, aiSessions } = build({
      source: CallSource.CUSTOMER,
      aiSession: null,
    });
    await service.endCall('call-1');
    expect(callService.endCall).toHaveBeenCalledWith('call-1');
    expect(aiSessions.end).not.toHaveBeenCalled();
  });
});
