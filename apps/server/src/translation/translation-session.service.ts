import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  TranslationMode,
  TranslationSession,
  TranslationSessionStatus,
} from '@prisma/client';

import { BillingConfigService } from '../billing/billing-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { translationConfig } from './translation.config';

/** An ACTIVE session whose relay hasn't checkpointed for this long is dead. */
export const TRANSLATION_SESSION_STALE_MS = 2 * 60_000;
/** The relay checkpoints seconds (and so `updatedAt`) this often. */
export const TRANSLATION_CHECKPOINT_MS = 30_000;
const SWEEP_BATCH_SIZE = 200;

export type TranslationDirection = 'caller_to_receiver' | 'receiver_to_caller';

export class TranslationLimitError extends Error {
  constructor(public readonly code: 'TRANSLATION_CONCURRENCY_LIMIT') {
    super(code);
    this.name = 'TranslationLimitError';
  }
}

export interface StartTranslationSession {
  callId: string;
  projectId: string;
  ownerId: string;
  direction: TranslationDirection;
  sourceLanguage: string;
  targetLanguage: string;
  mode: 'voice' | 'captions';
  route: string;
}

export interface TranslationSessionMetrics {
  phrases: number;
  firstAudioMsP50: number | null;
  firstAudioMsP95: number | null;
  captionDelayMsP50: number | null;
  captionDelayMsP95: number | null;
  droppedFrames: number;
  providerFailures: number;
  fallbacks: number;
  flags: number;
  flagReasons: Record<string, number>;
  replays: number;
  repeats: number;
  lexiconHits: number;
}

export interface EndTranslationSession {
  reason: string;
  status?: typeof TranslationSessionStatus.ENDED | typeof TranslationSessionStatus.FAILED;
  endedAt?: Date;
  voiceSeconds: number;
  captionsSeconds: number;
  route?: string;
  metrics?: Partial<TranslationSessionMetrics>;
}

export interface LockedRates {
  voiceRate: number;
  captionsRate: number;
}

/**
 * TranslationSession rows: one per direction of a translated call
 * (PROTOCOL.md §4). Rates are locked at start; concurrency is counted per
 * call under advisory locks (owner, then global) like AiSessionService.
 */
@Injectable()
export class TranslationSessionService {
  private readonly logger = new Logger(TranslationSessionService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingConfig: BillingConfigService,
  ) {}

  /** One rate per mode for every language pair; a TranslationRateOverride wins. */
  async rates(ownerId: string): Promise<LockedRates> {
    const [config, override] = await Promise.all([
      this.billingConfig.get(),
      this.prisma.translationRateOverride.findUnique({
        where: { userId: ownerId },
      }),
    ]);
    return {
      voiceRate: override?.voiceCreditsPerMinute ?? config.translationVoiceCreditsPerMinute,
      captionsRate:
        override?.captionsCreditsPerMinute ??
        config.translationCaptionsCreditsPerMinute,
    };
  }

  /** Throws TranslationLimitError when the account or the platform is full. */
  async start(input: StartTranslationSession): Promise<TranslationSession> {
    const rates = await this.rates(input.ownerId);
    const config = translationConfig();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`purplecallio:translation:owner:${input.ownerId}`}))`;
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('purplecallio:translation:global'))`;
      const live: Prisma.TranslationSessionWhereInput = {
        status: TranslationSessionStatus.ACTIVE,
        callId: { not: input.callId },
      };
      const [account, global] = await Promise.all([
        tx.translationSession.findMany({
          where: { ...live, ownerId: input.ownerId },
          distinct: ['callId'],
          select: { callId: true },
        }),
        tx.translationSession.findMany({
          where: live,
          distinct: ['callId'],
          select: { callId: true },
        }),
      ]);
      if (
        account.length >= config.maxConcurrentCallsPerAccount ||
        global.length >= config.globalMaxConcurrentCalls
      ) {
        this.logger.warn(
          `event=translation_concurrency_limit ownerId=${input.ownerId} account=${account.length} global=${global.length}`,
        );
        throw new TranslationLimitError('TRANSLATION_CONCURRENCY_LIMIT');
      }
      return tx.translationSession.create({
        data: {
          callId: input.callId,
          projectId: input.projectId,
          ownerId: input.ownerId,
          direction: input.direction,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          mode:
            input.mode === 'voice' ? TranslationMode.VOICE : TranslationMode.CAPTIONS,
          route: input.route,
          status: TranslationSessionStatus.ACTIVE,
          voiceRate: rates.voiceRate,
          captionsRate: rates.captionsRate,
        },
      });
    });
  }

  /**
   * Progress write from the live relay (doubles as its heartbeat through
   * `updatedAt`). False once the session is no longer ACTIVE.
   */
  async checkpoint(
    sessionId: string,
    seconds: { voiceSeconds: number; captionsSeconds: number },
  ): Promise<boolean> {
    const updated = await this.prisma.translationSession.updateMany({
      where: { id: sessionId, status: TranslationSessionStatus.ACTIVE },
      data: {
        voiceSeconds: Math.max(0, Math.round(seconds.voiceSeconds)),
        captionsSeconds: Math.max(0, Math.round(seconds.captionsSeconds)),
      },
    });
    return updated.count === 1;
  }

  async updateRoute(sessionId: string, route: string) {
    await this.prisma.translationSession.updateMany({
      where: { id: sessionId, status: TranslationSessionStatus.ACTIVE },
      data: { route },
    });
  }

  /** Idempotent: only the first caller moves ACTIVE → ENDED/FAILED. */
  async end(sessionId: string, end: EndTranslationSession): Promise<boolean> {
    const m = end.metrics ?? {};
    const claimed = await this.prisma.translationSession.updateMany({
      where: { id: sessionId, status: TranslationSessionStatus.ACTIVE },
      data: {
        status: end.status ?? TranslationSessionStatus.ENDED,
        endedAt: end.endedAt ?? new Date(),
        endReason: end.reason,
        voiceSeconds: Math.max(0, Math.round(end.voiceSeconds)),
        captionsSeconds: Math.max(0, Math.round(end.captionsSeconds)),
        ...(end.route ? { route: end.route } : {}),
        ...(m.phrases !== undefined ? { phrases: m.phrases } : {}),
        ...(m.firstAudioMsP50 !== undefined ? { firstAudioMsP50: m.firstAudioMsP50 } : {}),
        ...(m.firstAudioMsP95 !== undefined ? { firstAudioMsP95: m.firstAudioMsP95 } : {}),
        ...(m.captionDelayMsP50 !== undefined ? { captionDelayMsP50: m.captionDelayMsP50 } : {}),
        ...(m.captionDelayMsP95 !== undefined ? { captionDelayMsP95: m.captionDelayMsP95 } : {}),
        ...(m.droppedFrames !== undefined ? { droppedFrames: m.droppedFrames } : {}),
        ...(m.providerFailures !== undefined ? { providerFailures: m.providerFailures } : {}),
        ...(m.fallbacks !== undefined ? { fallbacks: m.fallbacks } : {}),
        ...(m.flags !== undefined ? { flags: m.flags } : {}),
        ...(m.flagReasons !== undefined ? { flagReasons: m.flagReasons } : {}),
        ...(m.replays !== undefined ? { replays: m.replays } : {}),
        ...(m.repeats !== undefined ? { repeats: m.repeats } : {}),
        ...(m.lexiconHits !== undefined ? { lexiconHits: m.lexiconHits } : {}),
      },
    });
    if (claimed.count === 1) {
      this.logger.log(
        `event=translation_session_ended sessionId=${sessionId} reason=${end.reason} voiceSeconds=${Math.round(end.voiceSeconds)} captionsSeconds=${Math.round(end.captionsSeconds)}`,
      );
    }
    return claimed.count === 1;
  }

  /** Live sessions on any instance (dashboard/specs). */
  countActiveCalls(ownerId?: string) {
    return this.prisma.translationSession
      .findMany({
        where: { status: TranslationSessionStatus.ACTIVE, ...(ownerId ? { ownerId } : {}) },
        distinct: ['callId'],
        select: { callId: true },
      })
      .then((rows) => rows.length);
  }

  /**
   * Recovers sessions whose relay died (crash, deploy): ended at their last
   * checkpoint with the seconds checkpointed then. TranslationBillingService's
   * cron bills them afterwards.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweepStaleSessions() {
    if (this.sweeping || !translationConfig().enabled) return;
    this.sweeping = true;
    try {
      const cutoff = new Date(Date.now() - TRANSLATION_SESSION_STALE_MS);
      const stale = await this.prisma.translationSession.findMany({
        where: { status: TranslationSessionStatus.ACTIVE, updatedAt: { lt: cutoff } },
        select: { id: true, updatedAt: true, voiceSeconds: true, captionsSeconds: true },
        take: SWEEP_BATCH_SIZE,
      });
      let swept = 0;
      for (const s of stale) {
        const ended = await this.end(s.id, {
          reason: 'heartbeat_lost',
          endedAt: s.updatedAt,
          voiceSeconds: s.voiceSeconds,
          captionsSeconds: s.captionsSeconds,
        });
        if (ended) swept++;
      }
      if (swept > 0) this.logger.warn(`event=translation_sessions_swept count=${swept}`);
    } catch (err) {
      this.logger.error(
        `event=translation_session_sweep_failed error=${(err as Error)?.name ?? 'unknown'}`,
      );
    } finally {
      this.sweeping = false;
    }
  }
}
