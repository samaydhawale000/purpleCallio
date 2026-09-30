import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';
import { CallRoomService } from '../services/call-room.service';

import { CallSessionService } from '../../call-session/services/call-session.service';
import { UsageSegmentService } from '../../billing/usage-segment.service';
import { socketOriginCallback } from '../../common/config/cors';
import { PrismaService } from '../../prisma/prisma.service';

type SocketAuthenticationResult = {
  success: boolean;
  role?: 'CALLER' | 'RECEIVER';
  error?: string;
};

const terminalCallStatuses = [
  'ENDED',
  'MISSED',
  'REJECTED',
  'CANCELLED',
  'BUSY',
];

@WebSocketGateway({
  maxHttpBufferSize: 1_000_000,
  cors: {
    origin: socketOriginCallback,
    credentials: false,
  },
})
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CallGateway.name);
  constructor(
    private readonly callSessionService: CallSessionService,
    private readonly roomService: CallRoomService,
    private readonly segmentService: UsageSegmentService,
    private readonly prisma: PrismaService,
  ) {}

  @WebSocketServer()
  server!: Server;

  private authenticatedSockets = new Map<
    string,
    {
      socketId: string;
      callId: string;
      role: 'CALLER' | 'RECEIVER';
      token: string;
      participantId: string;
      source: string;
      expiresAt: Date | null;
      maxParticipants: number | null;
    }
  >();
  private authenticationInFlight = new Map<
    string,
    { token: string; promise: Promise<SocketAuthenticationResult> }
  >();
  private connectionAttempts = new Map<string, number[]>();
  private unauthenticatedSockets = new Set<string>();
  private playgroundSocketEvents = new Map<string, number[]>();
  private socketAuthFailures = 0;

  private getParticipantBySocketId(socketId: string) {
    for (const participant of this.authenticatedSockets.values()) {
      if (participant.socketId === socketId) {
        return participant;
      }
    }
    return null;
  }

  private recordAuthFailure(reason: string) {
    this.socketAuthFailures++;
    if (this.socketAuthFailures === 1 || this.socketAuthFailures % 100 === 0) {
      this.logger.warn(
        `Socket authentication rejected reason=${reason} total=${this.socketAuthFailures}`,
      );
    }
  }

  private getOtherParticipant(senderSocketId: string) {
    const sender = this.getParticipantBySocketId(senderSocketId);
    if (!sender) return null;

    for (const participant of this.authenticatedSockets.values()) {
      if (
        participant.callId === sender.callId &&
        participant.socketId !== senderSocketId
      ) {
        return participant;
      }
    }
    return null;
  }

  emitToParticipant(
    callId: string,
    role: 'CALLER' | 'RECEIVER',
    event: string,
    data: any,
  ) {
    for (const participant of this.authenticatedSockets.values()) {
      if (participant.callId === callId && participant.role === role) {
        this.server.to(participant.socketId).emit(event, data);
        return;
      }
    }
  }

  handleConnection(client: Socket) {
    // Browser origins are intentionally dynamic for this public developer
    // transport. Every application event remains gated by a participant token.
    const unauthenticatedLimit = Number(
      process.env.SOCKET_MAX_UNAUTHENTICATED_CONNECTIONS ?? 100,
    );
    if (this.unauthenticatedSockets.size >= unauthenticatedLimit) {
      this.recordAuthFailure('unauthenticated_capacity');
      client.disconnect(true);
      return;
    }
    this.unauthenticatedSockets.add(client.id);
    const forwarded = client.handshake.headers['x-forwarded-for'];
    const ip =
      (Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded?.split(',')[0]?.trim()) ||
      client.handshake.address ||
      'unknown';
    const now = Date.now();
    const attempts = (this.connectionAttempts.get(ip) ?? []).filter(
      (time) => now - time < 60_000,
    );
    if (
      attempts.length >=
      Number(process.env.SOCKET_AUTH_ATTEMPTS_PER_MINUTE ?? 20)
    ) {
      this.recordAuthFailure('connection_rate_limit');
      client.emit('auth-error', { code: 'SOCKET_RATE_LIMITED' });
      client.disconnect(true);
      return;
    }
    attempts.push(now);
    this.connectionAttempts.set(ip, attempts);
    if (this.connectionAttempts.size > 10_000) {
      const oldestIp = Array.from(this.connectionAttempts.keys())[0];
      if (oldestIp) this.connectionAttempts.delete(oldestIp);
    }
    const authTimeout = setTimeout(() => {
      if (!this.getParticipantBySocketId(client.id)) client.disconnect(true);
    }, 10_000);
    authTimeout.unref();
    client.once('disconnect', () => clearTimeout(authTimeout));

    // Authenticate new SDKs from the Socket.IO handshake before call events
    // are accepted. The legacy `authenticate` event remains supported for
    // existing SDK releases.
    const handshakeAuth = client.handshake.auth as unknown as
      | { token?: unknown }
      | undefined;
    const handshakeToken = handshakeAuth?.token;
    if (typeof handshakeToken === 'string') {
      void this.authenticate(client, { token: handshakeToken });
    }
  }

  /** Live metrics for the admin health screen. */
  getMetrics() {
    return {
      // Total connected sockets (including unauthenticated).
      clients: this.server.sockets.sockets.size,
      // Authenticated participants currently in a call.
      inCall: this.authenticatedSockets.size,
      // Unique call rooms with at least one participant.
      rooms: this.roomService.getActiveRoomCount(),
      authFailures: this.socketAuthFailures,
    };
  }

  /** Number of sockets currently in a given call room. */
  getRoomParticipantCount(callId: string): number {
    return this.roomService.getParticipantCount(callId);
  }

  handleDisconnect(client: Socket) {
    this.unauthenticatedSockets.delete(client.id);
    this.playgroundSocketEvents.delete(client.id);
    for (const roomId of [...this.server.sockets.adapter.rooms.keys()]) {
      this.roomService.leaveRoom(roomId, client.id);
    }

    for (const [token, session] of this.authenticatedSockets.entries()) {
      if (session.socketId === client.id) {
        // Resolve the peer while this session is still present in the
        // authenticated index; getOtherParticipant uses that index.
        const other = this.getOtherParticipant(client.id);
        this.authenticatedSockets.delete(token);

        // Notify the other participant that this one left.
        this.roomService.removeParticipant(client.id);
        if (other) {
          this.server.to(other.socketId).emit('participant.left', {
            participantId: session.participantId,
            callId: session.callId,
          });
          const count = this.roomService.getParticipantCount(session.callId);
          this.server
            .to(session.callId)
            .emit('participant-left', { participants: count });
        }
        if (this.roomService.getParticipantCount(session.callId) === 0)
          this.closeEmptyPlayground(session.callId).catch(() => undefined);
      }
    }
    console.log('Socket Disconnected:', client.id);
  }

  private async closeEmptyPlayground(callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: { source: true, status: true },
    });
    if (call?.source !== 'PLAYGROUND' || call.status === 'ENDED') return;
    const update = await this.prisma.call.updateMany({
      where: {
        id: callId,
        source: 'PLAYGROUND',
        status: { in: ['INITIATED', 'RINGING', 'ACCEPTED'] },
      },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    if (!update.count) return;
    await this.prisma.callEvent.create({
      data: { callId, event: 'CALL_ENDED' },
    });
    await this.callSessionService.deleteByCallId(callId);
    this.terminateCall(callId, 'call.ended');
  }

  terminateCall(callId: string, event: 'call.expired' | 'call.ended') {
    this.server.to(callId).emit(event, { callId });
    for (const [token, session] of this.authenticatedSockets.entries()) {
      if (session.callId !== callId) continue;
      this.roomService.leaveRoom(callId, session.socketId);
      this.roomService.removeParticipant(session.socketId);
      this.authenticatedSockets.delete(token);
      this.playgroundSocketEvents.delete(session.socketId);
      this.server.sockets.sockets.get(session.socketId)?.disconnect(true);
    }
    this.server.in(callId).socketsLeave(callId);
  }

  private isAuthorized(
    clientId: string,
    callId?: string,
    requireJoined = true,
  ) {
    const session = this.getParticipantBySocketId(clientId);
    if (!session || (callId && session.callId !== callId)) return null;
    if (requireJoined && !this.roomService.getParticipant(clientId))
      return null;
    if (
      session.source === 'PLAYGROUND' &&
      (process.env.PLAYGROUND_ENABLED ?? 'true').toLowerCase() !== 'true'
    ) {
      this.terminateCall(session.callId, 'call.ended');
      return null;
    }
    if (
      session.source === 'PLAYGROUND' &&
      (!session.expiresAt || session.expiresAt.getTime() <= Date.now())
    ) {
      this.terminateCall(session.callId, 'call.expired');
      return null;
    }
    if (session.source === 'PLAYGROUND') {
      const now = Date.now();
      const events = (this.playgroundSocketEvents.get(clientId) ?? []).filter(
        (time) => now - time < 60_000,
      );
      if (
        events.length >=
        Number(process.env.PLAYGROUND_SOCKET_EVENTS_PER_MINUTE ?? 120)
      )
        return null;
      events.push(now);
      this.playgroundSocketEvents.set(clientId, events);
    }
    return session;
  }

  @SubscribeMessage('authenticate')
  async authenticate(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      token: string;
    },
  ) {
    const alreadyAuthenticated = this.getParticipantBySocketId(client.id);
    if (alreadyAuthenticated) {
      return alreadyAuthenticated.token === body?.token
        ? { success: true, role: alreadyAuthenticated.role }
        : { success: false, error: 'Already authenticated' };
    }
    const pending = this.authenticationInFlight.get(client.id);
    if (pending)
      return pending.token === body?.token
        ? pending.promise
        : { success: false, error: 'Authentication in progress' };
    const promise = this.authenticateParticipant(client, body);
    this.authenticationInFlight.set(client.id, { token: body?.token, promise });
    try {
      return await promise;
    } finally {
      if (this.authenticationInFlight.get(client.id)?.promise === promise) {
        this.authenticationInFlight.delete(client.id);
      }
    }
  }

  private async authenticateParticipant(
    client: Socket,
    body: { token: string },
  ): Promise<SocketAuthenticationResult> {
    if (
      typeof body?.token !== 'string' ||
      body.token.length !== 'bj_session_'.length + 64 ||
      !/^bj_session_[a-f0-9]{64}$/.test(body.token)
    ) {
      this.recordAuthFailure('malformed_token');
      client.emit('auth-error', { code: 'INVALID_TOKEN' });
      client.disconnect(true);
      return { success: false };
    }
    const session = await this.callSessionService.getByToken(body.token);
    if (!session) {
      this.recordAuthFailure('invalid_token');
      client.emit('auth-error', { code: 'INVALID_TOKEN' });
      client.disconnect(true);
      return { success: false };
    }
    if (session.expiresAt <= new Date()) {
      this.recordAuthFailure('expired_token');
      client.emit('auth-error', { code: 'TOKEN_EXPIRED' });
      client.disconnect(true);
      return { success: false, error: 'TOKEN_EXPIRED' };
    }
    if (
      session.call.source === 'PLAYGROUND' &&
      ((process.env.PLAYGROUND_ENABLED ?? 'true').toLowerCase() !== 'true' ||
        !session.call.expiresAt ||
        session.call.expiresAt <= new Date() ||
        !['INITIATED', 'RINGING', 'ACCEPTED'].includes(session.call.status))
    ) {
      this.recordAuthFailure('playground_call_expired');
      client.emit('call.expired', { callId: session.call.id });
      client.disconnect(true);
      return { success: false, error: 'PLAYGROUND_CALL_EXPIRED' };
    }
    if (
      session.call.source !== 'PLAYGROUND' &&
      terminalCallStatuses.includes(session.call.status)
    ) {
      this.recordAuthFailure('call_ended');
      client.emit('call.ended', { callId: session.call.id });
      client.disconnect(true);
      return { success: false, error: 'CALL_ENDED' };
    }

    const role: 'CALLER' | 'RECEIVER' =
      session.callerToken === body.token ? 'CALLER' : 'RECEIVER';
    const participantId =
      role === 'CALLER' ? session.call.callerId : session.call.receiverId;

    // Multi-tab: the same call-session token connecting from a second
    // socket (another tab/window) replaces the first, rather than leaving
    // two live sockets both claiming to be "the" caller/receiver for
    // signaling and room participation.
    const existing = this.authenticatedSockets.get(body.token);
    if (existing && existing.socketId !== client.id) {
      this.server.to(existing.socketId).emit('session-replaced', {
        callId: existing.callId,
      });
      this.roomService.leaveRoom(existing.callId, existing.socketId);
      this.roomService.removeParticipant(existing.socketId);
      this.playgroundSocketEvents.delete(existing.socketId);
      this.server.sockets.sockets.get(existing.socketId)?.disconnect(true);
    }

    this.authenticatedSockets.set(body.token, {
      socketId: client.id,
      callId: session.call.id,
      role,
      token: body.token,
      participantId,
      source: session.call.source,
      expiresAt: session.call.expiresAt,
      maxParticipants: session.call.maxParticipants,
    });
    this.unauthenticatedSockets.delete(client.id);

    client.emit('connected', {
      callId: session.call.id,
      participantId,
      role,
      source: session.call.source,
      expiresAt: session.call.expiresAt,
    });

    if (role === 'RECEIVER') {
      // If the call has already left the RINGING state (e.g. auto-missed
      // while the receiver was connecting), do not show a stale incoming
      // screen with dead Accept/Decline buttons. Emit the terminal state
      // so the UI reflects reality.
      const status = session.call.status;
      if (status === 'MISSED') {
        client.emit('call-missed', { callId: session.call.id });
      } else if (status === 'ENDED') {
        client.emit('call-ended', { callId: session.call.id });
      } else if (status === 'REJECTED') {
        client.emit('call-rejected', { callId: session.call.id });
      } else if (status === 'CANCELLED') {
        client.emit('call-cancelled', { callId: session.call.id });
      } else if (status === 'BUSY') {
        client.emit('call-busy', { callId: session.call.id });
      } else {
        client.emit('incoming-call', {
          callId: session.call.id,
          callerId: session.call.callerId,
          callerName: session.call.callerName,
          callerAvatar: session.call.callerAvatar,
          type: session.call.type,
        });
      }
    }

    return { success: true, role };
  }

  @SubscribeMessage('offer')
  offer(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      offer: RTCSessionDescriptionInit;
    },
  ) {
    if (!this.isAuthorized(client.id))
      return { success: false, error: 'Not authenticated' };
    const target = this.getOtherParticipant(client.id);
    if (!target) return;
    this.server.to(target.socketId).emit('offer', { offer: body.offer });
  }

  @SubscribeMessage('answer')
  answer(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      answer: RTCSessionDescriptionInit;
    },
  ) {
    if (!this.isAuthorized(client.id))
      return { success: false, error: 'Not authenticated' };
    const target = this.getOtherParticipant(client.id);
    if (!target) return;
    this.server.to(target.socketId).emit('answer', { answer: body.answer });
  }

  @SubscribeMessage('ice-candidate')
  iceCandidate(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      candidate: RTCIceCandidateInit;
    },
  ) {
    if (!this.isAuthorized(client.id))
      return { success: false, error: 'Not authenticated' };
    const target = this.getOtherParticipant(client.id);
    if (!target) return;
    this.server
      .to(target.socketId)
      .emit('ice-candidate', { candidate: body.candidate });
  }

  @SubscribeMessage('call-ended')
  callEnded(
    @ConnectedSocket()
    client: Socket,
  ) {
    if (!this.isAuthorized(client.id))
      return { success: false, error: 'Not authenticated' };
    const target = this.getOtherParticipant(client.id);
    if (!target) return;
    this.server.to(target.socketId).emit('call-ended');
  }

  @SubscribeMessage('join-call')
  async joinCall(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    const participant = this.getParticipantBySocketId(client.id);

    if (!participant) {
      return { success: false, error: 'Not authenticated' };
    }

    if (participant.callId !== body.callId) {
      return { success: false, error: 'Call access denied' };
    }
    if (!this.isAuthorized(client.id, body.callId, false))
      return { success: false, error: 'PLAYGROUND_CALL_EXPIRED' };

    const callIsJoinable = async () => {
      const call = await this.prisma.call.findUnique({
        where: { id: body.callId },
        select: { source: true, status: true, expiresAt: true },
      });
      return Boolean(
        call &&
        !terminalCallStatuses.includes(call.status) &&
        (call.source !== 'PLAYGROUND' ||
          ((process.env.PLAYGROUND_ENABLED ?? 'true').toLowerCase() ===
            'true' &&
            call.expiresAt &&
            call.expiresAt.getTime() > Date.now())),
      );
    };
    if (!(await callIsJoinable()))
      return { success: false, error: 'CALL_ENDED' };
    if (
      participant.source === 'PLAYGROUND' &&
      !this.roomService.canJoinRoom(
        body.callId,
        client.id,
        participant.maxParticipants ??
          Number(process.env.PLAYGROUND_MAX_PARTICIPANTS ?? 2),
      )
    ) {
      this.logger.warn(
        `Playground participant limit exceeded call=${body.callId}`,
      );
      return { success: false, error: 'PLAYGROUND_PARTICIPANT_LIMIT' };
    }

    await client.join(body.callId);
    // The call may have ended while Socket.IO was joining the room. Recheck
    // before publishing participant state so a terminal call cannot be
    // resurrected by a concurrent reconnect.
    if (!(await callIsJoinable())) {
      await client.leave(body.callId);
      return { success: false, error: 'CALL_ENDED' };
    }
    this.roomService.joinRoom(body.callId, client.id);
    this.roomService.addParticipant(body.callId, {
      socketId: client.id,
      participantId: participant.participantId,
      role: participant.role,
      media: { camera: false, microphone: false, screenShare: false },
    });

    const count = this.roomService.getParticipantCount(body.callId);

    const participants = this.roomService
      .getParticipants(body.callId)
      .map((item) => ({
        participantId: item.participantId,
        role: item.role,
        media: item.media,
      }));
    client.emit('call.state', { callId: body.callId, participants });

    // Standardized event + backward-compatible alias.
    this.server.to(body.callId).emit('participant.joined', {
      callId: body.callId,
      participantId: participant.participantId,
      participants: count,
    });
    this.server
      .to(body.callId)
      .emit('participant-joined', { participants: count });

    await this.safeRecordEvent(
      body.callId,
      'PARTICIPANT_JOINED',
      participant.participantId,
    );

    return {
      success: true,
      participants: count,
      state: { callId: body.callId, participants },
    };
  }

  @SubscribeMessage('leave-call')
  async leaveCall(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    if (!this.isAuthorized(client.id, body.callId))
      return { success: false, error: 'Not authenticated' };
    const participant = this.roomService.getParticipant(client.id);

    await client.leave(body.callId);
    this.roomService.leaveRoom(body.callId, client.id);
    this.roomService.removeParticipant(client.id);

    const count = this.roomService.getParticipantCount(body.callId);

    if (participant) {
      this.server.to(body.callId).emit('participant.left', {
        callId: body.callId,
        participantId: participant.participantId,
        participants: count,
      });
      await this.safeRecordEvent(
        body.callId,
        'PARTICIPANT_LEFT',
        participant.participantId,
      );
    }
    this.server
      .to(body.callId)
      .emit('participant-left', { participants: count });
    if (count === 0) await this.closeEmptyPlayground(body.callId);
  }

  @SubscribeMessage('call.started')
  async callStarted(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    const participant = this.getParticipantBySocketId(client.id);
    if (!this.isAuthorized(client.id, body.callId) || !participant)
      return { success: false, error: 'Not authenticated' };
    this.server.to(body.callId).emit('call.started', { callId: body.callId });

    await this.safeRecordEvent(
      body.callId,
      'CALL_STARTED',
      participant.participantId,
    );

    return { success: true };
  }

  @SubscribeMessage('call.ended')
  callEndedSignal(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    const participant = this.getParticipantBySocketId(client.id);
    if (!this.isAuthorized(client.id, body.callId) || !participant)
      return { success: false, error: 'Not authenticated' };
    this.server.to(body.callId).emit('call.ended', { callId: body.callId });

    return { success: true };
  }

  @SubscribeMessage('camera.enabled')
  async cameraEnabled(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    return this.handleMediaChange(
      client,
      body.callId,
      { camera: true },
      'camera.enabled',
    );
  }

  @SubscribeMessage('camera.disabled')
  async cameraDisabled(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    return this.handleMediaChange(
      client,
      body.callId,
      { camera: false },
      'camera.disabled',
    );
  }

  @SubscribeMessage('microphone.enabled')
  async microphoneEnabled(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    return this.handleMediaChange(
      client,
      body.callId,
      { microphone: true },
      'microphone.enabled',
    );
  }

  @SubscribeMessage('microphone.disabled')
  async microphoneDisabled(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    return this.handleMediaChange(
      client,
      body.callId,
      { microphone: false },
      'microphone.disabled',
    );
  }

  @SubscribeMessage('screenShare.started')
  async screenShareStarted(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    return this.handleMediaChange(
      client,
      body.callId,
      { screenShare: true },
      'screenShare.started',
    );
  }

  @SubscribeMessage('screenShare.stopped')
  async screenShareStopped(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    body: {
      callId: string;
    },
  ) {
    return this.handleMediaChange(
      client,
      body.callId,
      { screenShare: false },
      'screenShare.stopped',
    );
  }

  private async handleMediaChange(
    client: Socket,
    callId: string,
    patch: { camera?: boolean; microphone?: boolean; screenShare?: boolean },
    event: string,
  ) {
    const participant = this.getParticipantBySocketId(client.id);
    if (!this.isAuthorized(client.id, callId) || !participant)
      return { success: false, error: 'Not authenticated' };

    const updated = this.roomService.updateMedia(client.id, patch);
    if (!updated) return { success: false, error: 'Not in call room' };

    this.server.to(callId).emit(event, {
      callId,
      participantId: participant.participantId,
      media: updated.media,
    });
    this.server.to(callId).emit('participant.updated', {
      callId,
      participantId: participant.participantId,
      media: updated.media,
    });

    // Persist a media event into the audit trail used by the segment builder.
    // These events are never priced at write-time — they are only ratings
    // inputs that the Rating Engine later converts into money.
    try {
      await this.segmentService.recordEvent(
        callId,
        this.toMediaEventName(event),
        participant.participantId,
        { media: updated.media },
      );

      // Rebuild segments for the call so the timeline stays current.
      await this.segmentService.rebuildSegmentsForCall(callId);
    } catch (err) {
      // Recording is best-effort and must never break a live call.
      console.error('Failed to record media event', err);
    }

    return { success: true };
  }

  private toMediaEventName(socketEvent: string): string {
    switch (socketEvent) {
      case 'camera.enabled':
        return 'CAMERA_ENABLED';
      case 'camera.disabled':
        return 'CAMERA_DISABLED';
      case 'microphone.enabled':
        return 'MIC_ENABLED';
      case 'microphone.disabled':
        return 'MIC_DISABLED';
      case 'screenShare.started':
        return 'SCREEN_SHARE_STARTED';
      case 'screenShare.stopped':
        return 'SCREEN_SHARE_STOPPED';
      default:
        return socketEvent.replace(/[-.]/g, '_').toUpperCase();
    }
  }

  private async safeRecordEvent(
    callId: string,
    event: string,
    participantId?: string,
  ) {
    try {
      await this.segmentService.recordEvent(callId, event, participantId);
      await this.segmentService.rebuildSegmentsForCall(callId);
    } catch (err) {
      // Best-effort — never break a live call because of event recording.
      console.error('Failed to record event', event, err);
    }
  }
}
