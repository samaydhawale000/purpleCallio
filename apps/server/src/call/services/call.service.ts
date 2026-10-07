import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { CallSource, CallStatus, CallType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CallSessionService } from '../../call-session/services/call-session.service';
import { CallGateway } from '../../socket/gateways/call.gateway';
import { WebhookService } from '../../webhook/webhook.service';
import { UsageBillingService } from '../../billing/usage-billing.service';
import { UsageSegmentService } from '../../billing/usage-segment.service';
import { RatingEngineService } from '../../billing/rating-engine.service';
import { EntitlementService } from '../../billing/subscriptions/entitlement.service';
import { FeatureKey } from '../../billing/plans/feature-registry';

@Injectable()
export class CallService implements OnModuleInit {
  private readonly logger = new Logger(CallService.name);

  private readonly ringTimeoutMs: number;

  constructor(
    private prisma: PrismaService,
    private callSessionService: CallSessionService,
    private callGateway: CallGateway,
    private webhookService: WebhookService,
    private usageBilling: UsageBillingService,
    private segmentService: UsageSegmentService,
    private ratingEngine: RatingEngineService,
    private entitlements: EntitlementService,
  ) {
    const parsed = Number(process.env.CALL_RING_TIMEOUT_MS);
    this.ringTimeoutMs =
      Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;

    if (this.ringTimeoutMs < 20_000) {
      this.logger.warn(
        `CALL_RING_TIMEOUT_MS is set to ${this.ringTimeoutMs}ms — a receiver may not have ` +
          `time to open the call link and grant camera/mic permissions before being auto-missed.`,
      );
    }
  }

  onModuleInit() {
    // Clean up any calls that were already stuck (e.g. server restarted
    // while a call was ringing) on boot.
    this.missExpiredCalls();

    // Periodically expire unanswered calls.
    setInterval(() => {
      this.missExpiredCalls();
    }, 10_000).unref();
    this.expirePlaygroundCalls().catch((err) =>
      this.logger.error('Playground expiry sweep failed', err),
    );
    setInterval(() => {
      this.expirePlaygroundCalls().catch((err) =>
        this.logger.error('Playground expiry sweep failed', err),
      );
    }, 1_000).unref();
    setInterval(() => {
      this.prisma.playgroundAttempt
        .deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } },
        })
        .catch((err) =>
          this.logger.error('Playground attempt cleanup failed', err),
        );
    }, 3_600_000).unref();
  }

  async createCall(
    data: {
      projectId: string;
      callerId: string;
      receiverId: string;
      type: CallType;
      callerName?: string;
      callerAvatar?: string;
      receiverName?: string;
      receiverAvatar?: string;
    },
    options?: {
      skipWebhook?: boolean;
      skipUsageCheck?: boolean;
      source?: CallSource;
      expiresAt?: Date;
      maxParticipants?: number;
      creatorIdentity?: string;
    },
  ) {
    // 1. Duplicate protection: this exact (caller, receiver) pair already has
    // an active call — return it instead of creating a second one (e.g. a
    // double-clicked "Call" button, or a retried request).
    const existing = await this.prisma.call.findFirst({
      where: {
        projectId: data.projectId,
        callerId: data.callerId,
        receiverId: data.receiverId,
        status: {
          in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.ACCEPTED],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return this.buildCallResponse(existing);
    }

    // 2. Busy detection: the receiver already has a DIFFERENT active call in
    // progress (with someone else). Recorded as a terminal BUSY call for
    // history/webhooks — it's never actually rung.
    const receiverBusy = await this.prisma.call.findFirst({
      where: {
        projectId: data.projectId,
        status: { in: [CallStatus.RINGING, CallStatus.ACCEPTED] },
        OR: [{ callerId: data.receiverId }, { receiverId: data.receiverId }],
      },
    });
    if (receiverBusy) {
      const busyCall = await this.prisma.call.create({
        data: {
          projectId: data.projectId,
          callerId: data.callerId,
          receiverId: data.receiverId,
          type: data.type,
          status: CallStatus.BUSY,
          endedAt: new Date(),
          callerName: data.callerName,
          callerAvatar: data.callerAvatar,
          receiverName: data.receiverName,
          receiverAvatar: data.receiverAvatar,
        },
      });
      if (!options?.skipWebhook) {
        this.webhookService.fireForCall(busyCall.id, 'call.busy');
      }
      throw new ConflictException({
        error: 'BUSY',
        message: `${data.receiverId} is currently on another call.`,
        callId: busyCall.id,
      });
    }

    // Resolve the project owner and enforce prepaid eligibility (credits). Uses the same UsageBillingService.canStartCall rule as
    // BillingGuard so calls created outside the guarded HTTP path (e.g. the
    // playground) can't diverge from calls created through the API.
    if (!options?.skipUsageCheck) {
      const project = await this.prisma.project.findUnique({
        where: { id: data.projectId },
        select: { ownerId: true },
      });
      if (project) {
        const eligibility = await this.usageBilling.canStartCall(
          project.ownerId,
          data.type,
        );
        if (!eligibility.allowed) {
          throw new BadRequestException(eligibility.reason);
        }
      }
    }

    const call = await this.prisma.call.create({
      data: {
        projectId: data.projectId,
        callerId: data.callerId,
        receiverId: data.receiverId,
        type: data.type,
        status: CallStatus.RINGING,
        source: options?.source ?? CallSource.CUSTOMER,
        expiresAt: options?.expiresAt,
        maxParticipants: options?.maxParticipants,
        creatorIdentity: options?.creatorIdentity,
        callerName: data.callerName,
        callerAvatar: data.callerAvatar,
        receiverName: data.receiverName,
        receiverAvatar: data.receiverAvatar,
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId: call.id,
        event: 'CALL_CREATED',
        participantId: data.callerId,
      },
    });

    await this.callSessionService.createSession(call.id);

    if (!options?.skipWebhook) {
      this.webhookService.fireForCall(call.id, 'call.created');
    }

    return this.buildCallResponse(call);
  }

  private async buildCallResponse(call: {
    id: string;
    callerId: string;
    receiverId: string;
    [key: string]: any;
  }) {
    const session = await this.callSessionService.getByCallId(call.id);
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';

    const callerToken = session?.callerToken;
    const receiverToken = session?.receiverToken;
    const hostedUrl = `${frontend}/call?token=${callerToken}&callId=${call.id}`;
    const receiverUrl = `${frontend}/call?token=${receiverToken}&callId=${call.id}`;

    return {
      callId: call.id,
      call,
      hostedUrl,
      participants: [
        {
          participantId: call.callerId,
          token: callerToken,
          hostedUrl,
          expiresAt: session?.expiresAt ?? null,
        },
        {
          participantId: call.receiverId,
          token: receiverToken,
          hostedUrl: receiverUrl,
          expiresAt: session?.expiresAt ?? null,
        },
      ],
      // Backwards-compatible fields (still used by the playground)
      callerToken,
      receiverToken,
      callerUrl: hostedUrl,
      receiverUrl,
    };
  }

  /**
   * Find all calls that are still RINGING and older than the ring timeout,
   * and transition them to MISSED. This is the "auto-disconnect" for calls
   * that nobody answers.
   */
  async missExpiredCalls() {
    const cutoff = new Date(Date.now() - this.ringTimeoutMs);

    const expired = await this.prisma.call.findMany({
      where: {
        status: CallStatus.RINGING,
        createdAt: { lte: cutoff },
      },
    });

    const results: Awaited<ReturnType<CallService['missCall']>>[] = [];
    for (const call of expired) {
      try {
        const updated = await this.missCall(call.id);
        results.push(updated);
      } catch (err) {
        // A call may have progressed (accepted/rejected) between the query
        // and the update — that's fine, skip it.
        console.error('Failed to miss call', call.id, err);
      }
    }
    return results;
  }

  /**
   * Mark a ringing call as MISSED (nobody answered within the timeout).
   */
  async missCall(callId: string) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');

    // Only RINGING (or INITIATED) calls can be missed.
    if (
      call.status !== CallStatus.RINGING &&
      call.status !== CallStatus.INITIATED
    ) {
      throw new BadRequestException(
        `Call is already ${call.status.toLowerCase()}`,
      );
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.MISSED, endedAt: new Date() },
    });

    await this.prisma.callEvent.create({
      data: { callId, event: 'CALL_MISSED' },
    });

    this.callGateway.emitToParticipant(callId, 'CALLER', 'call-missed', {
      callId,
    });
    this.callGateway.emitToParticipant(callId, 'RECEIVER', 'call-missed', {
      callId,
    });
    this.webhookService.fireForCall(callId, 'call.missed');
    if (call.source === CallSource.PLAYGROUND)
      await this.finishPlaygroundSockets(callId);

    return updated;
  }

  async acceptCall(callId: string, session?: { role?: 'CALLER' | 'RECEIVER' }) {
    if (session?.role && session.role !== 'RECEIVER') {
      throw new ForbiddenException('Only the receiver can accept a call.');
    }

    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');
    this.assertPlaygroundActive(call);

    // Guard against accepting a call that has already reached a terminal state.
    if (
      call.status === CallStatus.MISSED ||
      call.status === CallStatus.ENDED ||
      call.status === CallStatus.REJECTED ||
      call.status === CallStatus.CANCELLED ||
      call.status === CallStatus.BUSY
    ) {
      throw new BadRequestException(
        `Cannot accept a call that is already ${call.status.toLowerCase()}`,
      );
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.ACCEPTED, startedAt: new Date() },
    });

    await this.prisma.callEvent.create({
      data: { callId, event: 'CALL_ACCEPTED' },
    });

    this.callGateway.emitToParticipant(callId, 'CALLER', 'call-accepted', {
      callId,
    });
    this.webhookService.fireForCall(callId, 'call.accepted');

    return updated;
  }

  /** Receiver declines a ringing call — distinct from the caller cancelling (cancelCall). */
  async rejectCall(callId: string, session?: { role?: 'CALLER' | 'RECEIVER' }) {
    if (session?.role && session.role !== 'RECEIVER') {
      throw new ForbiddenException('Only the receiver can decline a call.');
    }

    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');
    this.assertPlaygroundActive(call);
    if (
      call.status !== CallStatus.RINGING &&
      call.status !== CallStatus.INITIATED
    ) {
      throw new BadRequestException(
        `Cannot decline a call that is already ${call.status.toLowerCase()}`,
      );
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.REJECTED },
    });

    await this.prisma.callEvent.create({
      data: { callId, event: 'CALL_REJECTED' },
    });

    this.callGateway.emitToParticipant(callId, 'CALLER', 'call-rejected', {
      callId,
    });
    this.webhookService.fireForCall(callId, 'call.rejected');
    if (call.source === CallSource.PLAYGROUND)
      await this.finishPlaygroundSockets(callId);

    return updated;
  }

  /** Caller cancels a call while it's still ringing — distinct from the receiver declining it (rejectCall). */
  async cancelCall(callId: string, session?: { role?: 'CALLER' | 'RECEIVER' }) {
    if (session?.role && session.role !== 'CALLER') {
      throw new ForbiddenException('Only the caller can cancel a call.');
    }

    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');
    this.assertPlaygroundActive(call);
    if (
      call.status !== CallStatus.RINGING &&
      call.status !== CallStatus.INITIATED
    ) {
      throw new BadRequestException(
        `Cannot cancel a call that is already ${call.status.toLowerCase()}`,
      );
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.CANCELLED, endedAt: new Date() },
    });

    await this.prisma.callEvent.create({
      data: { callId, event: 'CALL_CANCELLED' },
    });

    this.callGateway.emitToParticipant(callId, 'RECEIVER', 'call-cancelled', {
      callId,
    });
    this.webhookService.fireForCall(callId, 'call.cancelled');
    if (call.source === CallSource.PLAYGROUND)
      await this.finishPlaygroundSockets(callId);

    return updated;
  }

  private async finishPlaygroundSockets(callId: string) {
    await this.callSessionService.deleteByCallId(callId);
    this.callGateway.terminateCall(callId, 'call.ended');
  }

  private assertPlaygroundActive(call: {
    source: CallSource;
    expiresAt: Date | null;
    status: CallStatus;
  }) {
    if (
      call.source === CallSource.PLAYGROUND &&
      (!call.expiresAt ||
        call.expiresAt.getTime() <= Date.now() ||
        call.status === CallStatus.ENDED ||
        call.status === CallStatus.MISSED ||
        call.status === CallStatus.REJECTED ||
        call.status === CallStatus.CANCELLED ||
        call.status === CallStatus.BUSY)
    ) {
      throw new GoneException({
        code: 'PLAYGROUND_CALL_EXPIRED',
        message:
          'This demo call has ended. Playground calls are limited to 1 minute.',
      });
    }
  }

  async endCall(callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { project: true },
    });
    if (!call) throw new NotFoundException('Call not found');

    if (call.source === CallSource.PLAYGROUND) {
      const endedAt = new Date();
      await this.prisma.call.updateMany({
        where: { id: callId, status: { not: CallStatus.ENDED } },
        data: { status: CallStatus.ENDED, endedAt },
      });
      await this.prisma.callEvent.create({
        data: { callId, event: 'CALL_ENDED' },
      });
      await this.callSessionService.deleteByCallId(callId);
      this.callGateway.terminateCall(callId, 'call.ended');
      return this.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    }

    const endedAt = new Date();

    // Atomically claim the ENDED transition — only the caller that actually
    // flips status away from ENDED records usage / fires webhooks. A second
    // "end" for the same call (double click, network retry, reconnect) finds
    // count === 0 and is a no-op: one call must produce exactly one billable
    // usage record (the CallUsage.callId unique constraint is the hard
    // backstop if two requests somehow race past this check).
    const claimed = await this.prisma.call.updateMany({
      where: { id: callId, status: { not: CallStatus.ENDED } },
      data: { status: CallStatus.ENDED, endedAt },
    });
    if (claimed.count === 0) {
      return this.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    }
    const updated = await this.prisma.call.findUniqueOrThrow({
      where: { id: callId },
    });

    // Ending the billable call must also terminate its signaling sessions.
    // Otherwise a participant can end through the REST API and keep an
    // already-negotiated peer-to-peer media session running after rating has
    // stopped.
    this.callGateway.terminateCall(callId, 'call.ended');

    await this.prisma.callEvent.create({
      data: { callId, event: 'CALL_ENDED', participantId: call.callerId },
    });

    // Segment-based usage recording: rebuild segments from the live event
    // stream and rate them so credit consumption is accurate per media state
    // (not a coarse "whole call is video" aggregate).
    try {
      // Ensure the call has a CALL_STARTED event before rebuilding (the
      // gateway already fires it when signaling starts; here we guarantee it).
      const hasStart = await this.prisma.callEvent.findFirst({
        where: { callId, event: 'CALL_STARTED' },
      });
      if (!hasStart && call.startedAt) {
        await this.prisma.callEvent.create({
          data: {
            callId,
            event: 'CALL_STARTED',
            participantId: call.callerId,
            metadata: { at: call.startedAt.toISOString(), callType: call.type },
          },
        });
        // Backdate the event timestamp so the first segment starts then.
        await this.prisma.callEvent.updateMany({
          where: { callId, event: 'CALL_STARTED' },
          data: { createdAt: call.startedAt },
        });
      } else {
        await this.prisma.callEvent.updateMany({
          where: { callId, event: 'CALL_STARTED' },
          data: { metadata: { callType: call.type } },
        });
      }

      await this.segmentService.rebuildSegmentsForCall(call.id);
      const rated = await this.ratingEngine.persistRatedCosts(call.id);

      // Peak concurrent participants across the call's media segments —
      // used for per-participant-minute reporting.
      const peakParticipants = rated.segments.reduce(
        (max, s) => Math.max(max, s.participantCount),
        0,
      );
      const participantCount = Math.max(
        call.callerId && call.receiverId ? 2 : 1,
        peakParticipants,
      );

      await this.usageBilling.recordCallUsage(call.project.ownerId, call.id, {
        audioMinutes: rated.totals.audioMins,
        videoMinutes: rated.totals.videoMins,
        screenShareMinutes: rated.totals.screenShareMins,
        participants: participantCount,
        startedAt: call.startedAt ?? undefined,
        endedAt,
      });
    } catch (err) {
      // Usage recording must never break the call end.
      console.error('Failed to record segment-based call usage', call.id, err);
      // Fallback: coarse aggregate so we never lose a call's usage entirely.
      try {
        const durationMs = call.startedAt
          ? endedAt.getTime() - call.startedAt.getTime()
          : 0;
        const durationMinutes = Math.max(0, durationMs / 60000);
        const participants = call.callerId && call.receiverId ? 2 : 1;
        const participantMinutes = Math.round(durationMinutes * participants);
        await this.usageBilling.recordCallUsage(call.project.ownerId, call.id, {
          audioMinutes: call.type === CallType.AUDIO ? participantMinutes : 0,
          videoMinutes: call.type === CallType.VIDEO ? participantMinutes : 0,
          screenShareMinutes: 0,
          participants,
          startedAt: call.startedAt ?? undefined,
          endedAt,
        });
      } catch (e2) {
        console.error('Failed to record fallback call usage', call.id, e2);
      }
    }

    this.webhookService.fireForCall(callId, 'call.ended');

    return updated;
  }

  /** Periodic database-backed cleanup. Expiry checks also happen synchronously
   * in session and socket authorization, so worker delay never extends access. */
  async expirePlaygroundCalls() {
    const now = new Date();
    const playgroundDisabled =
      (process.env.PLAYGROUND_ENABLED ?? 'true').toLowerCase() !== 'true';
    const active = await this.prisma.call.findMany({
      where: {
        source: CallSource.PLAYGROUND,
        status: {
          in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.ACCEPTED],
        },
        ...(playgroundDisabled
          ? {}
          : {
              OR: [
                { expiresAt: { lte: now } },
                {
                  createdAt: {
                    lte: new Date(
                      now.getTime() -
                        Number(
                          process.env.PLAYGROUND_IDLE_TIMEOUT_SECONDS ?? 30,
                        ) *
                          1000,
                    ),
                  },
                  events: { none: { event: 'PARTICIPANT_JOINED' } },
                },
              ],
            }),
      },
      select: { id: true },
    });
    for (const { id } of active) {
      const result = await this.prisma.call.updateMany({
        where: {
          id,
          source: CallSource.PLAYGROUND,
          status: {
            in: [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.ACCEPTED],
          },
        },
        data: { status: CallStatus.ENDED, endedAt: now },
      });
      if (result.count) {
        const event = playgroundDisabled ? 'CALL_ENDED' : 'CALL_EXPIRED';
        await this.prisma.callEvent.create({ data: { callId: id, event } });
        await this.callSessionService.deleteByCallId(id);
        this.callGateway.terminateCall(
          id,
          playgroundDisabled ? 'call.ended' : 'call.expired',
        );
        this.logger.log(
          `Playground call ${playgroundDisabled ? 'ended by kill switch' : 'expired'}: ${id}`,
        );
      }
    }
  }
  async getCall(callId: string, projectId?: string) {
    const call = await this.prisma.call.findFirst({
      where: { id: callId, ...(projectId ? { projectId } : {}) },
    });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  /**
   * Full call details including project branding and the
   * participant token (resolved from the caller's session token).
   * Used by the hosted UI to theme the room.
   */
  async getCallDetails(callId: string, session: any) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { project: true },
    });
    if (!call) throw new NotFoundException('Call not found');

    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    // NOTE: `session.callerToken` is always a truthy string on every session
    // row regardless of which token was actually presented — resolve the
    // role from `session.role` (set by CallSessionGuard from the presented
    // token), not from field presence.
    const isCaller = session?.role === 'CALLER';
    const token = isCaller ? session.callerToken : session.receiverToken;

    // Custom branding is a plan entitlement; without it the hosted UI shows
    // the project name with default styling. Fails open so a billing
    // hiccup never breaks a live call page.
    const branded = await this.entitlements
      .hasFeature(call.project.ownerId, FeatureKey.CUSTOM_BRANDING)
      .catch(() => true);

    return {
      callId: call.id,
      type: call.type,
      status: call.status,
      callerId: call.callerId,
      receiverId: call.receiverId,
      callerName: call.callerName,
      callerAvatar: call.callerAvatar,
      receiverName: call.receiverName,
      receiverAvatar: call.receiverAvatar,
      participantId: isCaller ? call.callerId : call.receiverId,
      token,
      hostedUrl: `${frontend}/call?token=${token}&callId=${call.id}`,
      expiresAt: session?.expiresAt ?? null,
      branding: branded
        ? {
            companyName: call.project.companyName ?? call.project.name,
            logoUrl: call.project.logoUrl,
            primaryColor: call.project.primaryColor,
            theme: call.project.theme,
            waitingRoom: call.project.waitingRoom,
          }
        : {
            companyName: call.project.name,
            logoUrl: null,
            primaryColor: '#2563EB',
            theme: call.project.theme,
            waitingRoom: call.project.waitingRoom,
          },
    };
  }

  /**
   * Record a participant joining an active call.
   */
  async joinCall(callId: string, session: any) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');

    const participantId =
      session?.role === 'CALLER' ? call.callerId : call.receiverId;

    await this.prisma.callEvent.create({
      data: { callId, event: 'PARTICIPANT_JOINED', participantId },
    });

    return {
      callId,
      status: call.status,
      joined: true,
      participantId,
    };
  }

  /**
   * Record a participant leaving an active call.
   */
  async leaveCall(callId: string, session: any) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');

    const participantId =
      session?.role === 'CALLER' ? call.callerId : call.receiverId;

    await this.prisma.callEvent.create({
      data: { callId, event: 'PARTICIPANT_LEFT', participantId },
    });

    return {
      callId,
      left: true,
      participantId,
    };
  }

  async recordWebrtcTransport(
    callId: string,
    session: any,
    transport: 'P2P' | 'TURN',
    candidateType?: string,
  ) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');

    const participantId =
      session?.role === 'CALLER' ? call.callerId : call.receiverId;

    await this.prisma.callEvent.create({
      data: {
        callId,
        event: 'WEBRTC_TRANSPORT',
        participantId,
        metadata: { transport, candidateType: candidateType ?? null },
      },
    });

    return { callId, participantId, transport };
  }

  async recordWebrtcIceOutcome(
    callId: string,
    session: any,
    outcome: 'SUCCESS' | 'FAILED',
    iceConnectionState?: string,
    connectionState?: string,
  ) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');

    const participantId =
      session?.role === 'CALLER' ? call.callerId : call.receiverId;

    await this.prisma.callEvent.create({
      data: {
        callId,
        event:
          outcome === 'SUCCESS' ? 'WEBRTC_ICE_SUCCESS' : 'WEBRTC_ICE_FAILED',
        participantId,
        metadata: {
          iceConnectionState: iceConnectionState ?? null,
          connectionState: connectionState ?? null,
        },
      },
    });

    return { callId, participantId, outcome };
  }

  async getCalls(projectId: string) {
    return this.prisma.call.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
