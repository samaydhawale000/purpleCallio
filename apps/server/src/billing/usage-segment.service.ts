import { Injectable, Logger } from '@nestjs/common';
import { CallEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ParticipantMediaState {
  participantId: string;
  audio: boolean;
  video: boolean;
  screenShare: boolean;
}

export interface Segment {
  startedAt: Date;
  endedAt: Date;
  participantCount: number;
  // Aggregate "does ANY participant have this on" — display-only. Billing
  // must be derived from `participants`, not these flags (see rating-engine).
  audio: boolean;
  video: boolean;
  screenShare: boolean;
  // Per-participant media state during this segment — the actual billing basis.
  participants: ParticipantMediaState[];
}

interface EventInput {
  event: string;
  participantId?: string | null;
  createdAt: Date;
  metadata?: Prisma.JsonValue | null;
}

/**
 * Usage Segment Builder (telecom-style).
 *
 * Reads a call's event stream and converts it into contiguous time-bounded
 * segments, each with a homogeneous media state (audio/video/screen-share on
 * or off) and a fixed participant count. This engine NEVER calculates money —
 * it only builds the timeline that the rating engine consumes.
 *
 * 10:00  call started                → segment [10:00 → 10:05] audio  2p
 * 10:05  camera enabled              → segment [10:05 → 10:08] video  2p
 * 10:08  screen share started        → segment [10:08 → 10:12] video+ss 2p
 * 10:12  bob left                    → segment [10:12 → 10:15] video+ss 1p
 * 10:15  call ended                  → segment ends
 */
@Injectable()
export class UsageSegmentService {
  private readonly logger = new Logger(UsageSegmentService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Build segments from a raw list of call events (in chronological order).
   * This is a pure function of the event stream — used both for real-time
   * segment building and for rebuilding from persisted CallEvent rows.
   */
  buildSegmentsFromEvents(events: EventInput[]): Segment[] {
    const sorted = [...events].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    const segments: Segment[] = [];

    // Tracks the current live media state (per participant).
    const states = new Map<
      string,
      { audio: boolean; video: boolean; screenShare: boolean }
    >();

    let current: {
      at: Date;
      participantCount: number;
      audio: boolean;
      video: boolean;
      screenShare: boolean;
      participants: ParticipantMediaState[];
    } | null = null;
    let isVideoCall = false;

    const eventCallType = (event: EventInput) => {
      if (
        !event.metadata ||
        typeof event.metadata !== 'object' ||
        Array.isArray(event.metadata)
      ) {
        return undefined;
      }
      const callType = (event.metadata as { callType?: unknown }).callType;
      return typeof callType === 'string' ? callType.toUpperCase() : undefined;
    };

    const close = (until: Date) => {
      if (!current) return;
      if (until.getTime() <= current.at.getTime()) return;
      segments.push({
        startedAt: current.at,
        endedAt: until,
        participantCount: current.participantCount,
        audio: current.audio,
        video: current.video,
        screenShare: current.screenShare,
        participants: current.participants,
      });
    };

    const snapshotParticipants = (): ParticipantMediaState[] =>
      Array.from(states.entries()).map(([participantId, s]) => ({
        participantId,
        audio: s.audio,
        video: s.video,
        screenShare: s.screenShare,
      }));

    const computeTotals = () => {
      let count = 0;
      let anyAudio = false;
      let anyVideo = false;
      let anyScreen = false;
      for (const s of states.values()) {
        count++;
        anyAudio = anyAudio || s.audio;
        anyVideo = anyVideo || s.video;
        anyScreen = anyScreen || s.screenShare;
      }
      return { count, anyAudio, anyVideo, anyScreen };
    };

    const updateTotals = (at: Date) => {
      const totals = computeTotals();
      // Close the previous segment and open a new one reflecting new totals.
      close(at);
      current = {
        at,
        participantCount: totals.count,
        audio: totals.anyAudio,
        video: totals.anyVideo,
        screenShare: totals.anyScreen,
        participants: snapshotParticipants(),
      };
    };

    for (const e of sorted) {
      const p = e.participantId ?? 'unknown';
      const kind = e.event.toUpperCase().replace(/[-.]/g, '_');

      switch (kind) {
        case 'CALL_STARTED':
        case 'PARTICIPANT_JOINED': {
          if (kind === 'CALL_STARTED') {
            isVideoCall = eventCallType(e) === 'VIDEO';
            if (isVideoCall) {
              for (const state of states.values()) {
                state.audio = false;
                state.video = true;
              }
            }
          }
          const state = states.get(p) ?? {
            audio: false,
            video: false,
            screenShare: false,
          };
          // On join, default to the media the call type implies: audio-only
          // calls start with audio on, video calls start with the camera on
          // (matching what the client's getUserMedia call actually captures).
          state.audio = !isVideoCall;
          state.video = isVideoCall;
          states.set(p, state);
          updateTotals(e.createdAt);
          break;
        }
        case 'PARTICIPANT_LEFT':
        case 'CALL_ENDED': {
          if (e.event === 'PARTICIPANT_LEFT') {
            states.delete(p);
            updateTotals(e.createdAt);
          } else {
            // CALL_ENDED closes everything.
            close(e.createdAt);
            current = null;
          }
          break;
        }
        case 'CAMERA_ENABLED': {
          const s = states.get(p);
          if (s) {
            s.video = true;
            states.set(p, s);
            updateTotals(e.createdAt);
          }
          break;
        }
        case 'CAMERA_DISABLED': {
          const s = states.get(p);
          if (s) {
            s.video = false;
            states.set(p, s);
            updateTotals(e.createdAt);
          }
          break;
        }
        case 'MIC_ENABLED': {
          const s = states.get(p);
          if (s && !isVideoCall) {
            s.audio = true;
            states.set(p, s);
            updateTotals(e.createdAt);
          }
          break;
        }
        case 'MIC_DISABLED': {
          const s = states.get(p);
          if (s) {
            s.audio = false;
            states.set(p, s);
            updateTotals(e.createdAt);
          }
          break;
        }
        case 'SCREEN_SHARE_STARTED': {
          const s = states.get(p);
          if (s) {
            s.screenShare = true;
            states.set(p, s);
            updateTotals(e.createdAt);
          }
          break;
        }
        case 'SCREEN_SHARE_STOPPED': {
          const s = states.get(p);
          if (s) {
            s.screenShare = false;
            states.set(p, s);
            updateTotals(e.createdAt);
          }
          break;
        }
        default:
          // Ignore unrelated events.
          break;
      }
    }

    // Close any dangling segment at the last event time.
    if (current) {
      const last = sorted.length
        ? sorted[sorted.length - 1].createdAt
        : new Date();
      close(last);
    }

    return segments;
  }

  /**
   * Rebuild + persist segments for a call from its stored CallEvent rows.
   * Deletes any previously persisted segments for the call first (idempotent).
   */
  async rebuildSegmentsForCall(callId: string): Promise<Segment[]> {
    const events = await this.prisma.callEvent.findMany({
      where: { callId },
      orderBy: { createdAt: 'asc' },
    });

    const segments = this.buildSegmentsFromEvents(events);

    await this.prisma.$transaction([
      this.prisma.usageSegment.deleteMany({ where: { callId } }),
    ]);

    if (segments.length) {
      await this.prisma.usageSegment.createMany({
        data: segments.map((s) => ({
          callId,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          participantCount: s.participantCount,
          audio: s.audio,
          video: s.video,
          screenShare: s.screenShare,
          participants: s.participants as unknown as Prisma.InputJsonValue,
        })),
      });
    }

    return segments;
  }

  /**
   * Fetch persisted segments for a call.
   */
  async getSegmentsForCall(callId: string) {
    return this.prisma.usageSegment.findMany({
      where: { callId },
      orderBy: { startedAt: 'asc' },
    });
  }

  /**
   * Fetch all segments created since a given time (for admin analytics).
   */
  async getSegmentsSince(since: Date) {
    return this.prisma.usageSegment.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { startedAt: 'asc' },
    });
  }

  /**
   * Load a call together with the owning project so controllers can enforce
   * ownership before exposing a call's segment timeline.
   */
  async getCallOwner(callId: string) {
    return this.prisma.call.findUnique({
      where: { id: callId },
      include: { project: { select: { ownerId: true } } },
    });
  }

  /**
   * Record a single media/lifecycle event for a call. Used by the gateway
   * and services to grow the audit trail used by segment building.
   */
  async recordEvent(
    callId: string,
    event: string,
    participantId?: string,
    metadata: Prisma.InputJsonValue = {},
  ) {
    return this.prisma.callEvent.create({
      data: {
        callId,
        event,
        participantId,
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  }
}
