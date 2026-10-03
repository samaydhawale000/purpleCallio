import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { Server, Socket } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PurpleCallioMeeting } from '../src/meeting/meeting';


type Role = 'CALLER' | 'RECEIVER';

const CALL_ID = 'call-1';

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static nextId = 0;

  readonly id = ++FakePeerConnection.nextId;
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  readonly createOfferCalls: number[] = [];
  readonly createAnswerCalls: number[] = [];
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  readonly calls: string[] = [];
  ontrack: ((e: unknown) => void) | null = null;
  onicecandidate: ((e: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  iceConnectionState: RTCIceConnectionState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  /** Local candidate type of the selected pair, or null for "no pair yet". */
  selectedCandidateType: string | null = 'host';

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  addTrack() {}
  getSenders() {
    return [];
  }

  async createOffer() {
    this.createOfferCalls.push(Date.now());
    this.calls.push('createOffer');
    return { type: 'offer' as const, sdp: `offer-sdp-${this.id}-${this.createOfferCalls.length}` };
  }

  async createAnswer() {
    this.createAnswerCalls.push(Date.now());
    this.calls.push('createAnswer');
    return { type: 'answer' as const, sdp: `answer-sdp-${this.id}` };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
    // Trickle one ICE candidate per local description.
    setTimeout(() => this.onicecandidate?.({ candidate: { candidate: `cand-${this.id}-${desc.type}`, sdpMid: '0' } }), 0);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.calls.push(`setRemoteDescription:${desc.type}`);
    this.remoteDescription = { type: desc.type, sdp: desc.sdp };
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.calls.push('addIceCandidate');
    this.addedCandidates.push({ candidate: candidate.candidate, sdpMid: candidate.sdpMid });
  }

  async getStats() {
    const reports = new Map<string, Record<string, unknown>>();
    if (this.selectedCandidateType) {
      reports.set('pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local' });
      reports.set('local', { id: 'local', type: 'local-candidate', candidateType: this.selectedCandidateType });
    }
    return reports;
  }

  setIceState(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.connectionState = state === 'completed' ? 'connected' : (state as RTCPeerConnectionState);
    this.oniceconnectionstatechange?.();
  }

  close() {
    this.signalingState = 'closed';
  }
}

class FakeSessionDescription {
  type: RTCSdpType;
  sdp?: string;
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type;
    this.sdp = init.sdp;
  }
}

class FakeIceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate;
    this.sdpMid = init.sdpMid;
  }
}

const fakeStream = () =>
  ({
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
  }) as unknown as MediaStream;

/** Minimal CallGateway mirror. */
class FakeGateway {
  readonly io: Server;
  url = '';
  /** Every client→server event received, in order. */
  readonly log: Array<{ event: string; role?: Role; socketId: string }> = [];
  private readonly http = createServer();
  private readonly sessions = new Map<string, { role: Role; participantId: string }>();
  private readonly room = new Set<string>();

  constructor(
    private readonly tokens: Record<string, { role: Role; participantId: string }>,
  ) {
    this.io = new Server(this.http);
    this.io.on('connection', (socket) => this.onConnection(socket));
  }

  async start() {
    await new Promise<void>((r) => this.http.listen(0, r));
    this.url = `http://localhost:${(this.http.address() as AddressInfo).port}`;
  }

  async stop() {
    await new Promise<void>((r) => this.io.close(() => r()));
  }

  count(event: string, role?: Role) {
    return this.log.filter((e) => e.event === event && (!role || e.role === role)).length;
  }

  socketFor(role: Role): Socket | undefined {
    for (const [id, s] of this.sessions) if (s.role === role) return this.io.sockets.sockets.get(id);
    return undefined;
  }

  /** Room-wide broadcast, as the gateway does for lifecycle events. */
  broadcast(event: string, payload: unknown) {
    this.io.to(CALL_ID).emit(event, payload);
  }

  roomSize() {
    return this.room.size;
  }

  private authenticate(socket: Socket, token: unknown) {
    const existing = this.sessions.get(socket.id);
    if (existing) return { success: true, role: existing.role };
    const session = typeof token === 'string' ? this.tokens[token] : undefined;
    if (!session) return { success: false };
    this.sessions.set(socket.id, session);
    socket.emit('connected', { callId: CALL_ID, participantId: session.participantId, role: session.role });
    return { success: true, role: session.role };
  }

  private onConnection(socket: Socket) {
    // Record what the client sent. `onAny` runs before socket.io's deferred
    // dispatch, so it also sees packets the server later ignores because a
    // DISCONNECT arrived in the same tick (e.g. `leave-call` from leave()).
    socket.onAny((event: string) =>
      this.log.push({ event, role: this.sessions.get(socket.id)?.role, socketId: socket.id }),
    );

    const handshakeToken = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof handshakeToken === 'string') this.authenticate(socket, handshakeToken);

    socket.on('authenticate', (body: { token: string }, ack?: (r: unknown) => void) => {
      ack?.(this.authenticate(socket, body?.token));
    });

    socket.on('join-call', async (body: { callId: string }, ack?: (r: unknown) => void) => {
      const session = this.sessions.get(socket.id);
      if (!session) return ack?.({ success: false, error: 'Not authenticated' });
      if (body.callId !== CALL_ID) return ack?.({ success: false, error: 'Call access denied' });
      // The gateway re-checks the call in the database before joining.
      await new Promise((r) => setTimeout(r, 5));
      await socket.join(CALL_ID);
      this.room.add(socket.id);
      const participants = [...this.room].map((id) => {
        const s = this.sessions.get(id)!;
        return { participantId: s.participantId, role: s.role, media: { camera: false, microphone: false, screenShare: false } };
      });
      socket.emit('call.state', { callId: CALL_ID, participants });
      this.io.to(CALL_ID).emit('participant.joined', {
        callId: CALL_ID,
        participantId: session.participantId,
        participants: this.room.size,
      });
      ack?.({ success: true, participants: this.room.size, state: { callId: CALL_ID, participants } });
    });

    socket.on('leave-call', () => {
      this.leaveRoom(socket);
    });

    socket.on('call.started', () => {
      this.io.to(CALL_ID).emit('call.started', { callId: CALL_ID });
    });

    for (const event of ['offer', 'answer', 'ice-candidate'] as const) {
      socket.on(event, (payload: unknown) => {
        // isAuthorized(requireJoined=true): relay only from room members.
        if (!this.room.has(socket.id)) return;
        const target = [...this.sessions.keys()].find((id) => id !== socket.id);
        if (target) this.io.to(target).emit(event, payload);
      });
    }

    socket.on('disconnect', () => {
      this.leaveRoom(socket);
      this.sessions.delete(socket.id);
    });
  }

  private leaveRoom(socket: Socket) {
    const session = this.sessions.get(socket.id);
    if (!this.room.delete(socket.id) || !session) return;
    void socket.leave(CALL_ID);
    this.io.to(CALL_ID).emit('participant.left', {
      callId: CALL_ID,
      participantId: session.participantId,
      participants: this.room.size,
    });
  }
}

const pcOf = (meeting: PurpleCallioMeeting) => (meeting as any).pc as FakePeerConnection;

describe('PurpleCallioMeeting signaling flow', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let gateway: FakeGateway;
  const meetings: PurpleCallioMeeting[] = [];

  const makeMeeting = (token: string) => {
    const meeting = new PurpleCallioMeeting({
      token,
      callId: CALL_ID,
      signalUrl: gateway.url,
      iceServers: [],
      overrideIceServers: true,
    });
    meetings.push(meeting);
    return meeting;
  };

  const startGateway = async (
    tokens: Record<string, { role: Role; participantId: string }> = {
      'caller-token': { role: 'CALLER', participantId: 'alice' },
      'receiver-token': { role: 'RECEIVER', participantId: 'bob' },
    },
  ) => {
    gateway = new FakeGateway(tokens);
    await gateway.start();
  };

  /** Offer → answer → ICE both ways has completed. */
  const waitForNegotiation = async (caller: PurpleCallioMeeting, receiver: PurpleCallioMeeting) => {
    await vi.waitFor(
      () => {
        expect(pcOf(caller).remoteDescription?.type).toBe('answer');
        expect(pcOf(receiver).remoteDescription?.type).toBe('offer');
        expect(pcOf(caller).addedCandidates.length).toBeGreaterThan(0);
        expect(pcOf(receiver).addedCandidates.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  };

  /** Lets any stray (duplicate) signaling settle before asserting counts. */
  const settle = () => new Promise((r) => setTimeout(r, 100));

  beforeEach(() => {
    FakePeerConnection.instances = [];
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    vi.stubGlobal('RTCSessionDescription', FakeSessionDescription);
    vi.stubGlobal('RTCIceCandidate', FakeIceCandidate);
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => fakeStream() } },
    });
  });

  afterEach(async () => {
    await Promise.all(meetings.splice(0).map((m) => m.leave()));
    await gateway?.stop();
    vi.unstubAllGlobals();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });

  it('join() authenticates and joins the call room with no external `connected` listener', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    const states: string[] = [];
    caller.onConnectionStateChanged((s) => states.push(s));

    await caller.join();

    expect(caller.connectionState()).toBe('joined');
    expect(gateway.count('join-call', 'CALLER')).toBe(1);
    expect(gateway.roomSize()).toBe(1);
    expect(caller.snapshot().participantId).toBe('alice');
    expect(caller.participants().map((p) => p.participantId)).toEqual(['alice']);
    expect(states).toEqual(['connecting', 'authenticating', 'connected', 'joining', 'joined']);
    // Alone in the room: nothing to negotiate yet.
    await settle();
    expect(pcOf(caller).createOfferCalls).toHaveLength(0);
  });

  it('CALLER offers exactly once when the RECEIVER joins second; RECEIVER answers and ICE flows', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    const receiver = makeMeeting('receiver-token');

    await caller.join();
    await receiver.join();
    await waitForNegotiation(caller, receiver);
    await settle();

    expect(pcOf(caller).createOfferCalls).toHaveLength(1);
    expect(pcOf(receiver).createOfferCalls).toHaveLength(0);
    expect(pcOf(receiver).createAnswerCalls).toHaveLength(1);
    expect(gateway.count('offer')).toBe(1);
    expect(gateway.count('offer', 'RECEIVER')).toBe(0);
    expect(gateway.count('answer', 'RECEIVER')).toBe(1);
    // `call.started` is never needed to negotiate.
    expect(gateway.count('call.started')).toBe(0);
  });

  it('CALLER offers exactly once when it joins after the RECEIVER', async () => {
    await startGateway();
    const receiver = makeMeeting('receiver-token');
    const caller = makeMeeting('caller-token');

    await receiver.join();
    await settle();
    expect(pcOf(receiver).createOfferCalls).toHaveLength(0);

    await caller.join();
    await waitForNegotiation(caller, receiver);
    await settle();

    expect(pcOf(caller).createOfferCalls).toHaveLength(1);
    expect(pcOf(receiver).createOfferCalls).toHaveLength(0);
    expect(gateway.count('offer')).toBe(1);
    expect(gateway.count('call.started')).toBe(0);
  });

  it('still offers once when caller and receiver share the same participantId', async () => {
    // Developers can create a call where callerId === receiverId (e.g. one
    // test user in two tabs). Room presence, not identity, drives the offer.
    await startGateway({
      'caller-token': { role: 'CALLER', participantId: 'same-user' },
      'receiver-token': { role: 'RECEIVER', participantId: 'same-user' },
    });
    const caller = makeMeeting('caller-token');
    const receiver = makeMeeting('receiver-token');

    await caller.join();
    await receiver.join();
    await waitForNegotiation(caller, receiver);
    await settle();

    expect(pcOf(caller).createOfferCalls).toHaveLength(1);
    expect(pcOf(receiver).createOfferCalls).toHaveLength(0);
  });

  it('ignores duplicate participant.joined and repeated call.started events', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    const receiver = makeMeeting('receiver-token');
    const started = vi.fn();
    caller.on('call.started', started);

    await caller.join();
    await receiver.join();
    await waitForNegotiation(caller, receiver);

    for (let i = 0; i < 3; i++) {
      gateway.broadcast('participant.joined', { callId: CALL_ID, participantId: 'bob', participants: 2 });
      gateway.broadcast('call.state', {
        callId: CALL_ID,
        participants: [
          { participantId: 'alice', role: 'CALLER' },
          { participantId: 'bob', role: 'RECEIVER' },
        ],
      });
      gateway.broadcast('call.started', { callId: CALL_ID });
    }
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(3));
    await settle();

    expect(pcOf(caller).createOfferCalls).toHaveLength(1);
    expect(pcOf(receiver).createOfferCalls).toHaveLength(0);
    expect(gateway.count('offer')).toBe(1);
  });

  it('call.started alone never triggers an offer', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    await caller.join();

    gateway.broadcast('call.started', { callId: CALL_ID });
    gateway.broadcast('call.started', { callId: CALL_ID });
    await settle();

    expect(pcOf(caller).createOfferCalls).toHaveLength(0);
    expect(gateway.count('offer')).toBe(0);
  });

  it('repeated join() calls (component re-renders) share one session and one offer', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    const receiver = makeMeeting('receiver-token');

    await Promise.all([caller.join(), caller.join(), caller.join()]);
    await Promise.all([receiver.join(), receiver.join()]);
    await caller.join();
    await receiver.join();
    await waitForNegotiation(caller, receiver);
    await settle();

    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(gateway.count('join-call', 'CALLER')).toBe(1);
    expect(gateway.count('join-call', 'RECEIVER')).toBe(1);
    expect(gateway.count('offer')).toBe(1);
  });

  it('a CALLER reconnect rejoins the room without a second offer', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    const receiver = makeMeeting('receiver-token');
    await caller.join();
    await receiver.join();
    await waitForNegotiation(caller, receiver);

    const states: string[] = [];
    caller.onConnectionStateChanged((s) => states.push(s));
    // Drop the transport (not a server-initiated disconnect) so socket.io
    // reconnects on its own.
    gateway.socketFor('CALLER')!.conn.close();

    await vi.waitFor(() => expect(gateway.count('join-call', 'CALLER')).toBe(2), { timeout: 5000 });
    await vi.waitFor(() => expect(caller.connectionState()).toBe('joined'));
    await settle();

    expect(states).toEqual(['disconnected', 'connected', 'joined']);
    expect(gateway.roomSize()).toBe(2);
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(pcOf(caller).createOfferCalls).toHaveLength(1);
    expect(pcOf(receiver).createOfferCalls).toHaveLength(0);
    expect(pcOf(receiver).createAnswerCalls).toHaveLength(1);
    expect(gateway.count('offer')).toBe(1);
  }, 10_000);

  it('a RECEIVER reconnect does not make the CALLER offer again', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    const receiver = makeMeeting('receiver-token');
    await caller.join();
    await receiver.join();
    await waitForNegotiation(caller, receiver);

    gateway.socketFor('RECEIVER')!.conn.close();

    await vi.waitFor(() => expect(gateway.count('join-call', 'RECEIVER')).toBe(2), { timeout: 5000 });
    await vi.waitFor(() => expect(receiver.connectionState()).toBe('joined'));
    await settle();

    expect(pcOf(caller).createOfferCalls).toHaveLength(1);
    expect(pcOf(receiver).createOfferCalls).toHaveLength(0);
    expect(gateway.count('offer')).toBe(1);
  }, 10_000);

  it('join() while a joined session is reconnecting does not start a second session', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    const receiver = makeMeeting('receiver-token');
    await caller.join();
    await receiver.join();
    await waitForNegotiation(caller, receiver);

    gateway.socketFor('CALLER')!.conn.close();
    await vi.waitFor(() => expect(caller.connectionState()).toBe('disconnected'));
    // e.g. a React effect re-running join() on a state change.
    await caller.join();

    await vi.waitFor(() => expect(caller.connectionState()).toBe('joined'), { timeout: 5000 });
    await settle();

    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(gateway.count('join-call', 'CALLER')).toBe(2);
    expect(gateway.count('offer')).toBe(1);
  }, 10_000);

  it('queues ICE candidates that arrive before the offer and flushes them before answering', async () => {
    await startGateway();
    const receiver = makeMeeting('receiver-token');
    await receiver.join();

    const receiverSocket = gateway.socketFor('RECEIVER')!;
    receiverSocket.emit('ice-candidate', { candidate: { candidate: 'early-1', sdpMid: '0' } });
    receiverSocket.emit('ice-candidate', { candidate: { candidate: 'early-2', sdpMid: '0' } });
    receiverSocket.emit('ice-candidate', { candidate: { candidate: 'early-1', sdpMid: '0' } }); // duplicate
    await settle();
    expect(pcOf(receiver).addedCandidates).toHaveLength(0);

    receiverSocket.emit('offer', { offer: { type: 'offer', sdp: 'remote-offer' } });
    await vi.waitFor(() => expect(pcOf(receiver).createAnswerCalls).toHaveLength(1));

    expect(pcOf(receiver).addedCandidates.map((c) => c.candidate)).toEqual(['early-1', 'early-2']);
    expect(pcOf(receiver).calls).toEqual([
      'setRemoteDescription:offer',
      'addIceCandidate',
      'addIceCandidate',
      'createAnswer',
    ]);
    await vi.waitFor(() => expect(gateway.count('answer', 'RECEIVER')).toBe(1));
  });

  it('rejects join() and ends in `error` when authentication fails', async () => {
    await startGateway();
    const meeting = makeMeeting('bad-token');

    await expect(meeting.join()).rejects.toThrow(/Authentication failed/);
    expect(meeting.connectionState()).toBe('error');
    expect(gateway.count('join-call')).toBe(0);
  });

  it('leave() emits leave-call, closes the peer connection and disconnects', async () => {
    await startGateway();
    const caller = makeMeeting('caller-token');
    const receiver = makeMeeting('receiver-token');
    await caller.join();
    await receiver.join();
    await waitForNegotiation(caller, receiver);

    const left = vi.fn();
    receiver.on('participant.left', left);
    const pc = pcOf(caller);
    await caller.leave();

    expect(pc.signalingState).toBe('closed');
    expect(caller.connectionState()).toBe('disconnected');
    await vi.waitFor(() => expect(gateway.count('leave-call', 'CALLER')).toBe(1));
    await vi.waitFor(() => expect(left).toHaveBeenCalledWith(expect.objectContaining({ participantId: 'alice' })));
    expect(gateway.roomSize()).toBe(1);
  });
});

describe('PurpleCallioMeeting WebRTC telemetry', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let fetchMock: ReturnType<typeof vi.fn>;
  let meeting: PurpleCallioMeeting;

  const posts = () =>
    fetchMock.mock.calls.map(([url, init]) => ({
      url: url as string,
      auth: (init as RequestInit).headers && ((init as RequestInit).headers as Record<string, string>).Authorization,
      body: JSON.parse((init as RequestInit).body as string),
    }));

  /** A meeting with a live fake peer connection, without a signaling server. */
  const setup = async (config: { apiUrl?: string } = {}) => {
    meeting = new PurpleCallioMeeting({
      token: 'session-token',
      callId: 'call/1',
      signalUrl: 'https://signal.example',
      iceServers: [],
      overrideIceServers: true,
      ...config,
    });
    await (meeting as any).initLocalMedia();
    return pcOf(meeting);
  };

  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    FakePeerConnection.instances = [];
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => fakeStream() } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });

  it('reports P2P transport and ICE success once when ICE connects', async () => {
    const pc = await setup({ apiUrl: 'https://api.example/api/' });

    pc.setIceState('connected');
    pc.setIceState('completed');
    pc.setIceState('connected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(posts()).toEqual(
      expect.arrayContaining([
        {
          url: 'https://api.example/api/calls/call%2F1/webrtc-transport',
          auth: 'Bearer session-token',
          body: { transport: 'P2P', candidateType: 'host' },
        },
        {
          url: 'https://api.example/api/calls/call%2F1/webrtc-ice',
          auth: 'Bearer session-token',
          body: { outcome: 'SUCCESS', iceConnectionState: 'connected', connectionState: 'connected' },
        },
      ]),
    );
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('classifies a relay candidate as TURN and falls back to signalUrl when apiUrl is unset', async () => {
    const pc = await setup();
    pc.selectedCandidateType = 'relay';

    pc.setIceState('connected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(posts()).toContainEqual({
      url: 'https://signal.example/calls/call%2F1/webrtc-transport',
      auth: 'Bearer session-token',
      body: { transport: 'TURN', candidateType: 'relay' },
    });
  });

  it('reports a hard failure, then the recovery, but not a transient disconnect', async () => {
    const pc = await setup();

    pc.setIceState('disconnected');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    pc.setIceState('failed');
    pc.setIceState('failed');
    pc.setIceState('connected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await flush();

    const ice = posts().filter((p) => p.url.endsWith('/webrtc-ice')).map((p) => p.body.outcome);
    expect(ice).toEqual(['FAILED', 'SUCCESS']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries the transport report when no candidate pair has been selected yet', async () => {
    const pc = await setup();
    pc.selectedCandidateType = null;

    pc.setIceState('connected');
    await flush();
    await flush();
    expect(posts().filter((p) => p.url.endsWith('/webrtc-transport'))).toHaveLength(0);

    pc.selectedCandidateType = 'srflx';
    pc.setIceState('completed');
    await vi.waitFor(() =>
      expect(posts().filter((p) => p.url.endsWith('/webrtc-transport')).map((p) => p.body)).toEqual([
        { transport: 'P2P', candidateType: 'srflx' },
      ]),
    );
  });

  it('without apiUrl, falls through to signalUrl + /api when the origin root is the web app', async () => {
    // Standard Nginx deployment: `/` is the Next.js site (HTML 404 for API
    // paths), REST is under `/api`, Socket.IO at the origin.
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('https://signal.example/api/')
        ? { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }) }
        : { ok: false, status: 404, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }) },
    );
    const pc = await setup();

    pc.setIceState('connected');
    await vi.waitFor(() =>
      expect(posts().filter((p) => p.url.startsWith('https://signal.example/api/'))).toHaveLength(2),
    );
    await flush();

    const urls = posts().map((p) => p.url);
    expect(urls).toContain('https://signal.example/api/calls/call%2F1/webrtc-transport');
    expect(urls).toContain('https://signal.example/api/calls/call%2F1/webrtc-ice');

    // The working base is remembered: a later report goes straight to /api.
    fetchMock.mockClear();
    pc.setIceState('failed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(posts()[0].url).toBe('https://signal.example/api/calls/call%2F1/webrtc-ice');
  });

  it('without apiUrl, keeps the origin when it answers as the API (JSON), e.g. a bare local server', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, headers: new Headers({ 'content-type': 'application/json' }) });
    const pc = await setup();

    pc.setIceState('connected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();

    expect(posts().every((p) => p.url.startsWith('https://signal.example/calls/'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('without apiUrl, falls through to /api when the browser rejects the origin root on CORS', async () => {
    // In a browser the web app's 404 preflight has no CORS headers, so
    // fetch() rejects with a TypeError instead of resolving to a 404.
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.startsWith('https://signal.example/api/')) throw new TypeError('Failed to fetch');
      return { ok: true, status: 201, headers: new Headers({ 'content-type': 'application/json' }) };
    });
    const pc = await setup();

    pc.setIceState('connected');
    await vi.waitFor(() =>
      expect(posts().filter((p) => p.url.startsWith('https://signal.example/api/'))).toHaveLength(2),
    );
    expect(posts().map((p) => p.url)).toEqual(
      expect.arrayContaining([
        'https://signal.example/api/calls/call%2F1/webrtc-transport',
        'https://signal.example/api/calls/call%2F1/webrtc-ice',
      ]),
    );
  });

  it('without apiUrl, finds TURN credentials under /api when the root fails CORS', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== 'https://signal.example/api/turn/credentials') throw new TypeError('Failed to fetch');
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ iceServers: [{ urls: 'turn:turn.example' }] }),
      };
    });
    meeting = new PurpleCallioMeeting({ token: 'session-token', callId: 'call/1', signalUrl: 'https://signal.example' });

    await expect((meeting as any).fetchBackendIceServers()).resolves.toEqual([{ urls: 'turn:turn.example' }]);
  });

  it('with an explicit apiUrl, a network error is not retried elsewhere', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const pc = await setup({ apiUrl: 'https://rest.example' });

    pc.setIceState('connected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();

    expect(fetchMock.mock.calls.every(([url]) => (url as string).startsWith('https://rest.example/calls/'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('without apiUrl, finds TURN credentials under /api too', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === 'https://signal.example/api/turn/credentials'
        ? {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ iceServers: [{ urls: 'turn:turn.example' }] }),
          }
        : { ok: false, status: 404, headers: new Headers({ 'content-type': 'text/html' }) },
    );
    meeting = new PurpleCallioMeeting({ token: 'session-token', callId: 'call/1', signalUrl: 'https://signal.example/' });

    await expect((meeting as any).fetchBackendIceServers()).resolves.toEqual([{ urls: 'turn:turn.example' }]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://signal.example/turn/credentials',
      'https://signal.example/api/turn/credentials',
    ]);
  });

  it('with an explicit apiUrl, never probes another base', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, headers: new Headers({ 'content-type': 'text/html' }) });
    const pc = await setup({ apiUrl: 'https://rest.example/v1' });

    pc.setIceState('connected');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flush();

    expect(posts().every((p) => p.url.startsWith('https://rest.example/v1/calls/'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never lets a telemetry failure surface to the app', async () => {
    const pc = await setup();
    fetchMock.mockRejectedValue(new Error('network down'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      pc.setIceState('connected');
      // Two reports, each trying the origin and then /api.
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('does not report for a peer connection that has been torn down', async () => {
    const pc = await setup();
    await meeting.leave();

    pc.setIceState('connected');
    await flush();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
