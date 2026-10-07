import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  UsageSegmentService,
  Segment,
  ParticipantMediaState,
} from './usage-segment.service';
import { UsageBillingService } from './usage-billing.service';

export interface RatedSegment extends Segment {
  seconds: number;
  minutes: number; // fractional participant-minutes
  audioMins: number;
  videoMins: number;
  screenShareMins: number;
  costPaise: number;
}

export interface RatedCall {
  callId: string;
  segments: RatedSegment[];
  totals: {
    audioMins: number;
    videoMins: number;
    screenShareMins: number;
    costPaise: number;
  };
}

/**
 * Usage Rating Engine — the measurement layer.
 *
 * Turns segments (built by the segment builder) into fractional
 * participant-minutes per media type, rated per participant. Those minutes
 * are what prepaid billing consumes: BillingConfigService converts them to
 * credits. The `costPaise` this engine also records uses the legacy
 * per-minute rate card (BillingRate) and is an internal cost basis for
 * admin analytics only — customers are never charged from it.
 */
@Injectable()
export class RatingEngineService {
  private readonly logger = new Logger(RatingEngineService.name);

  constructor(
    private prisma: PrismaService,
    private segments: UsageSegmentService,
    private usageBilling: UsageBillingService,
  ) {}

  /**
   * Rate a single segment into participant-minutes + cost (paise).
   *
   * Rated PER PARTICIPANT, not per segment aggregate: a segment's `audio`/
   * `video`/`screenShare` flags only mean "at least one participant has this
   * on" and must never be used to compute money (that would charge every
   * participant in the segment for media only one of them was using). The
   * actual billing basis is `seg.participants` — each participant's own
   * audio/video/screenShare state during this time window.
   */
  private async rateSegment(seg: Segment): Promise<RatedSegment> {
    const rates = await this.usageBilling.getRates();
    const seconds = Math.max(
      0,
      (seg.endedAt.getTime() - seg.startedAt.getTime()) / 1000,
    );
    const perParticipantMinutes = seconds / 60;

    let audioMins = 0;
    let videoMins = 0;
    let screenShareMins = 0;

    for (const p of seg.participants) {
      if (p.audio) audioMins += perParticipantMinutes;
      if (p.video) videoMins += perParticipantMinutes;
      // Screen-share is an add-on to video (never charged alone), per participant.
      if (p.video && p.screenShare) screenShareMins += perParticipantMinutes;
    }

    const costPaise = Math.round(
      audioMins * rates.audioPaise +
        videoMins * rates.videoPaise +
        screenShareMins * rates.screenSharePaise,
    );

    return {
      ...seg,
      seconds,
      minutes: perParticipantMinutes * seg.participantCount,
      audioMins,
      videoMins,
      screenShareMins,
      costPaise,
    };
  }

  /**
   * Rate all segments for a call. Returns the rated timeline + totals.
   * Totals are kept as fractional participant-minutes (not rounded) so
   * free-allowance exhaustion and cumulative billing stay accurate; round
   * only for display.
   */
  async rateCall(callId: string): Promise<RatedCall> {
    const segs = await this.segments.getSegmentsForCall(callId);
    const rated: RatedSegment[] = [];
    let audioMins = 0;
    let videoMins = 0;
    let screenShareMins = 0;
    let costPaise = 0;

    for (const seg of segs) {
      const r = await this.rateSegment({
        startedAt: seg.startedAt,
        endedAt: seg.endedAt,
        participantCount: seg.participantCount,
        audio: seg.audio,
        video: seg.video,
        screenShare: seg.screenShare,
        participants:
          (seg.participants as unknown as ParticipantMediaState[]) ?? [],
      });
      rated.push(r);
      audioMins += r.audioMins;
      videoMins += r.videoMins;
      screenShareMins += r.screenShareMins;
      costPaise += r.costPaise;
    }

    return {
      callId,
      segments: rated,
      totals: {
        audioMins,
        videoMins,
        screenShareMins,
        costPaise,
      },
    };
  }

  /**
   * Sum already-rated, persisted usage segments (admin analytics). Each
   * segment's audioMinutes/videoMinutes/screenShareMinutes/costPaise were
   * computed once, per-participant, by persistRatedCosts — this just totals
   * them rather than re-deriving money from the aggregate audio/video flags.
   */
  async rateSegments(
    segs: {
      audioMinutes: number;
      videoMinutes: number;
      screenShareMinutes: number;
      costPaise: number;
      callId?: string;
    }[],
  ): Promise<{
    audioMins: number;
    videoMins: number;
    screenShareMins: number;
    costPaise: number;
    calls: number;
  }> {
    let audioMins = 0;
    let videoMins = 0;
    let screenShareMins = 0;
    let costPaise = 0;
    const calls = new Set<string>();

    for (const seg of segs) {
      audioMins += seg.audioMinutes;
      videoMins += seg.videoMinutes;
      screenShareMins += seg.screenShareMinutes;
      costPaise += seg.costPaise;
      if (seg.callId) calls.add(seg.callId);
    }

    return {
      audioMins,
      videoMins,
      screenShareMins,
      costPaise,
      calls: calls.size,
    };
  }

  /**
   * Persist rated cost + minute breakdown back onto segments (so invoicing
   * and admin analytics can read already-rated numbers directly).
   */
  async persistRatedCosts(callId: string): Promise<RatedCall> {
    const rated = await this.rateCall(callId);
    for (const seg of rated.segments) {
      await this.prisma.usageSegment.updateMany({
        where: {
          callId,
          startedAt: seg.startedAt,
          endedAt: seg.endedAt,
        },
        data: {
          costPaise: seg.costPaise,
          audioMinutes: seg.audioMins,
          videoMinutes: seg.videoMins,
          screenShareMinutes: seg.screenShareMins,
        },
      });
    }
    return rated;
  }
}
