import { GoneException, UnauthorizedException } from '@nestjs/common';
import { CallSessionGuard } from './call-session.guard';
import { CallSource, CallStatus } from '@prisma/client';

describe('CallSessionGuard playground enforcement', () => {
  const activeSession = () => ({
    id: 'session',
    callId: 'call-a',
    callerToken: 'token-a',
    receiverToken: 'token-b',
    expiresAt: new Date(Date.now() + 60_000),
    call: {
      source: CallSource.PLAYGROUND,
      status: CallStatus.RINGING,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const context = (callId = 'call-a') =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer token-a' },
          params: { id: callId },
        }),
      }),
    }) as any;

  it('allows a valid token scoped to its playground call', async () => {
    const sessions = {
      getByToken: jest.fn().mockResolvedValue(activeSession()),
    };
    const guard = new CallSessionGuard(sessions as any);
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it('rejects a token used against another call ID', async () => {
    const sessions = {
      getByToken: jest.fn().mockResolvedValue(activeSession()),
    };
    const guard = new CallSessionGuard(sessions as any);
    await expect(guard.canActivate(context('call-b'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects expired and terminal playground calls', async () => {
    const expired = activeSession();
    expired.call.expiresAt = new Date(Date.now() - 1);
    const guard = new CallSessionGuard({
      getByToken: jest.fn().mockResolvedValue(expired),
    } as any);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('rejects expired participant tokens', async () => {
    const expired = activeSession();
    expired.expiresAt = new Date(Date.now() - 1);
    const guard = new CallSessionGuard({
      getByToken: jest.fn().mockResolvedValue(expired),
    } as any);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects valid customer tokens after the call ends', async () => {
    const session = {
      ...activeSession(),
      call: {
        source: CallSource.CUSTOMER,
        status: CallStatus.ENDED,
        expiresAt: null,
      },
    };
    const guard = new CallSessionGuard({
      getByToken: jest.fn().mockResolvedValue(session),
    } as any);
    await expect(guard.canActivate(context())).rejects.toMatchObject({
      response: { code: 'CALL_ENDED' },
    });
  });

  it('rejects a valid customer token after its call has ended', async () => {
    const session = {
      ...activeSession(),
      call: {
        source: CallSource.CUSTOMER,
        status: CallStatus.ENDED,
        expiresAt: null,
      },
    };
    const guard = new CallSessionGuard({
      getByToken: jest.fn().mockResolvedValue(session),
    } as any);
    await expect(guard.canActivate(context())).rejects.toMatchObject({
      response: { code: 'CALL_ENDED' },
    });
  });

  it('blocks active Playground sessions while the kill switch is off', async () => {
    process.env.PLAYGROUND_ENABLED = 'false';
    const guard = new CallSessionGuard({
      getByToken: jest.fn().mockResolvedValue(activeSession()),
    } as any);
    try {
      await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
        GoneException,
      );
    } finally {
      delete process.env.PLAYGROUND_ENABLED;
    }
  });
});
