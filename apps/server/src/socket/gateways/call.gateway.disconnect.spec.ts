import { CallGateway } from './call.gateway';
import { CallRoomService } from '../services/call-room.service';
import { CallSource, CallStatus } from '@prisma/client';

const media = { camera: false, microphone: false, screenShare: false };

function setup() {
  const roomService = new CallRoomService();
  const segments = {
    recordEvent: jest.fn().mockResolvedValue({}),
    rebuildSegmentsForCall: jest.fn().mockResolvedValue([]),
  };
  const gateway = new CallGateway(
    {} as never,
    roomService,
    segments as never,
    {
      call: {
        findUnique: jest.fn().mockResolvedValue({ source: CallSource.CUSTOMER, status: CallStatus.ACCEPTED }),
      },
    } as never,
  );
  gateway.server = {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: jest.fn(() => ({ emit: jest.fn() })),
  } as any;

  const connect = (socketId: string, participantId: string, token: string) => {
    gateway['authenticatedSockets'].set(token, {
      socketId,
      callId: 'call-1',
      role: 'CALLER',
      token,
      participantId,
      source: 'CUSTOMER',
      expiresAt: null,
      maxParticipants: null,
    } as never);
    roomService.joinRoom('call-1', socketId);
    roomService.addParticipant('call-1', { socketId, participantId, role: 'CALLER', media });
  };
  return { gateway, roomService, segments, connect };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('CallGateway disconnect', () => {
  it('records PARTICIPANT_LEFT when a joined participant drops (tab closed)', async () => {
    const { gateway, segments, connect } = setup();
    connect('s1', 'alice', 'tok-1');

    gateway.handleDisconnect({ id: 's1' } as never);
    await flush();

    expect(segments.recordEvent).toHaveBeenCalledWith('call-1', 'PARTICIPANT_LEFT', 'alice');
  });

  it('does not record a leave while the participant is still on a newer socket', async () => {
    const { gateway, segments, connect } = setup();
    connect('old', 'alice', 'tok-old');
    connect('new', 'alice', 'tok-new');

    gateway.handleDisconnect({ id: 'old' } as never);
    await flush();

    expect(segments.recordEvent).not.toHaveBeenCalled();
  });

  it('does not record anything for a socket that never joined the call room', async () => {
    const { gateway, roomService, segments, connect } = setup();
    connect('s1', 'alice', 'tok-1');
    roomService.removeParticipant('s1'); // e.g. it already sent leave-call

    gateway.handleDisconnect({ id: 's1' } as never);
    await flush();

    expect(segments.recordEvent).not.toHaveBeenCalled();
  });
});
