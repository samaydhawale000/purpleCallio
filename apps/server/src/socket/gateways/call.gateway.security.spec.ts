import { CallGateway } from './call.gateway';
import { CallRoomService } from '../services/call-room.service';
import { CallSource, CallStatus } from '@prisma/client';

describe('CallGateway session authorization', () => {
  const callerToken = `bj_session_${'a'.repeat(64)}`;
  const makeGateway = (session: unknown) => {
    const roomService = new CallRoomService();
    const sessions = { getByToken: jest.fn().mockResolvedValue(session) };
    const gateway = new CallGateway(
      sessions as never,
      roomService,
      { recordEvent: jest.fn() } as never,
      {
        call: {
          findUnique: jest.fn().mockResolvedValue({
            source: CallSource.PLAYGROUND,
            status: CallStatus.RINGING,
            expiresAt: new Date(Date.now() + 60_000),
          }),
        },
      } as never,
    );
    const emitted: Array<[string, unknown]> = [];
    const sockets = new Map<string, unknown>();
    gateway.server = {
      sockets: { sockets, adapter: { rooms: new Map() } },
      to: jest.fn(() => ({
        emit: (event: string, data: unknown) => emitted.push([event, data]),
      })),
      in: jest.fn(() => ({ socketsLeave: jest.fn() })),
    } as any;
    return { gateway, sessions, roomService, emitted, sockets };
  };

  const playgroundSession = () => ({
    callerToken,
    receiverToken: `bj_session_${'b'.repeat(64)}`,
    expiresAt: new Date(Date.now() + 60_000),
    call: {
      id: 'call-a',
      callerId: 'alice',
      receiverId: 'bob',
      source: CallSource.PLAYGROUND,
      expiresAt: new Date(Date.now() + 60_000),
      status: CallStatus.RINGING,
      maxParticipants: 2,
    },
  });

  it('disconnects a socket presenting an invalid participant token', async () => {
    const { gateway, sessions } = makeGateway(null);
    const client = {
      id: 'socket-1',
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as any;
    await expect(
      gateway.authenticate(client as never, { token: 'invalid' }),
    ).resolves.toEqual({ success: false });
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(sessions.getByToken).not.toHaveBeenCalled();
  });

  it('allows unknown browser origins to attempt the transport while requiring participant auth', () => {
    const { gateway } = makeGateway(null);
    const client = {
      id: 'socket-origin',
      handshake: { headers: { origin: 'https://attacker.example' } },
      once: jest.fn(),
      disconnect: jest.fn(),
    };
    gateway.handleConnection(client as never);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(gateway['unauthenticatedSockets'].has(client.id)).toBe(true);
  });

  it('rejects expired tokens and calls before socket room access', async () => {
    const session = playgroundSession();
    session.call.expiresAt = new Date(Date.now() - 1);
    const { gateway } = makeGateway(session);
    const client = {
      id: 'socket-1',
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    await expect(
      gateway.authenticate(client as never, { token: callerToken }),
    ).resolves.toMatchObject({ error: 'PLAYGROUND_CALL_EXPIRED' });
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a token for a terminal Playground call', async () => {
    const session = playgroundSession();
    session.call.status = CallStatus.REJECTED;
    const { gateway } = makeGateway(session);
    const client = {
      id: 'socket-terminal',
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as any;
    await expect(
      gateway.authenticate(client as never, { token: callerToken }),
    ).resolves.toMatchObject({ error: 'PLAYGROUND_CALL_EXPIRED' });
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects reconnecting with a valid token after a customer call ended', async () => {
    const session = playgroundSession();
    session.call.source = CallSource.CUSTOMER;
    session.call.status = CallStatus.ENDED;
    const { gateway } = makeGateway(session);
    const client = {
      id: 'socket-ended',
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as any;
    await expect(
      gateway.authenticate(client as never, { token: callerToken }),
    ).resolves.toMatchObject({ error: 'CALL_ENDED' });
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('does not join a customer room if the call ends during room join', async () => {
    const session = playgroundSession();
    session.call.source = CallSource.CUSTOMER;
    const { gateway, roomService } = makeGateway(session);
    gateway['prisma'] = {
      call: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            source: CallSource.CUSTOMER,
            status: CallStatus.ACCEPTED,
            expiresAt: null,
          })
          .mockResolvedValueOnce({
            source: CallSource.CUSTOMER,
            status: CallStatus.ENDED,
            expiresAt: null,
          }),
      },
    } as any;
    const client = {
      id: 'socket-racing-end',
      emit: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    } as any;
    await gateway.authenticate(client as never, { token: callerToken });

    await expect(
      gateway.joinCall(client as never, { callId: session.call.id }),
    ).resolves.toMatchObject({ success: false, error: 'CALL_ENDED' });
    expect(client.leave).toHaveBeenCalledWith(session.call.id);
    expect(roomService.getParticipantCount(session.call.id)).toBe(0);
  });

  it('does not let an unauthenticated socket join any call room', async () => {
    const { gateway } = makeGateway(null);
    await expect(
      gateway.joinCall({ id: 'socket-1' } as never, { callId: 'call-a' }),
    ).resolves.toMatchObject({ success: false });
  });

  it('returns a canonical participant snapshot when an authorized participant joins', async () => {
    const session = playgroundSession();
    const { gateway, roomService } = makeGateway(session);
    const client = {
      id: 'socket-1',
      emit: jest.fn(),
      join: jest.fn(),
      disconnect: jest.fn(),
    } as any;
    await gateway.authenticate(client as never, { token: callerToken });

    const result = await gateway.joinCall(client as never, {
      callId: session.call.id,
    });

    expect(result).toMatchObject({
      success: true,
      state: {
        callId: 'call-a',
        participants: [{ participantId: 'alice', role: 'CALLER' }],
      },
    });
    expect(client.emit).toHaveBeenCalledWith('call.state', result.state);
    expect(roomService.getParticipantCount('call-a')).toBe(1);
  });

  it('replaces the previous socket when a participant token reconnects', async () => {
    const session = playgroundSession();
    const { gateway, sockets } = makeGateway(session);
    const first = {
      id: 'socket-1',
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    const second = {
      id: 'socket-2',
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    sockets.set(first.id, first);
    sockets.set(second.id, second);
    await gateway.authenticate(first as never, { token: callerToken });
    await gateway.authenticate(second as never, { token: callerToken });
    expect(first.disconnect).toHaveBeenCalledWith(true);
    expect(second.emit).toHaveBeenCalledWith(
      'connected',
      expect.objectContaining({ callId: 'call-a' }),
    );
  });

  it('notifies the remaining participant when an authenticated socket disconnects', () => {
    const { gateway, roomService, emitted } = makeGateway(playgroundSession());
    const caller = {
      socketId: 'socket-caller',
      callId: 'call-a',
      role: 'CALLER',
      token: callerToken,
      participantId: 'alice',
      source: 'CUSTOMER',
      expiresAt: null,
      maxParticipants: null,
    };
    const receiverToken = `bj_session_${'b'.repeat(64)}`;
    const receiver = {
      socketId: 'socket-receiver',
      callId: 'call-a',
      role: 'RECEIVER',
      token: receiverToken,
      participantId: 'bob',
      source: 'CUSTOMER',
      expiresAt: null,
      maxParticipants: null,
    };
    gateway['authenticatedSockets'].set(callerToken, caller as never);
    gateway['authenticatedSockets'].set(receiverToken, receiver as never);
    roomService.joinRoom('call-a', caller.socketId);
    roomService.joinRoom('call-a', receiver.socketId);
    roomService.addParticipant('call-a', {
      socketId: caller.socketId,
      participantId: 'alice',
      role: 'CALLER',
      media: { camera: false, microphone: false, screenShare: false },
    });
    roomService.addParticipant('call-a', {
      socketId: receiver.socketId,
      participantId: 'bob',
      role: 'RECEIVER',
      media: { camera: false, microphone: false, screenShare: false },
    });

    gateway.handleDisconnect({ id: caller.socketId } as never);

    expect(emitted).toContainEqual([
      'participant.left',
      { participantId: 'alice', callId: 'call-a' },
    ]);
  });
});
