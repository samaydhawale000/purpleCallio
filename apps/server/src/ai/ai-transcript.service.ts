import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AiMessageRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { aiConfig } from './ai.config';
import { TRANSCRIPT_RETENTION_DAYS } from './dto/validators';

const DAY_MS = 86_400_000;

/**
 * Messages of agents with no retention (toggle turned off after storing)
 * or an unknown value are kept for the longest allowed period, then purged.
 */
const FALLBACK_RETENTION_DAYS = Math.max(...TRANSCRIPT_RETENTION_DAYS);

// Order matters: keys can contain digits, so they go before card numbers.
const REDACTIONS: [RegExp, string][] = [
  [/\b(?:bj_(?:live|test|ai|session|tool)_|sk-)[A-Za-z0-9_-]{6,}/g, '[redacted key]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted email]'],
  // 13–19 digits, single spaces or dashes allowed between them.
  [/(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d])/g, '[redacted number]'],
];

/** Strips card-like numbers, API/provider keys and email addresses. */
export function redactTranscript(text: string): string {
  return REDACTIONS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

/**
 * Per-session transcript sink owned by the relay. Writes are chained so
 * rows keep their spoken order; at most `cap` messages are stored.
 */
export class AiTranscriptWriter {
  private count = 0;
  private capped = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
    readonly sessionId: string,
    private readonly cap: number,
  ) {}

  add(role: AiMessageRole, text: string) {
    const content = redactTranscript(text.trim());
    if (!content) return;
    if (this.count >= this.cap) {
      if (!this.capped) {
        this.capped = true;
        this.logger.warn(
          `event=ai_transcript_capped sessionId=${this.sessionId} cap=${this.cap}`,
        );
      }
      return;
    }
    this.count++;
    const createdAt = new Date();
    this.chain = this.chain.then(() =>
      this.prisma.aiConversationMessage
        .create({
          data: { sessionId: this.sessionId, role, content, createdAt },
        })
        .then(
          () => undefined,
          (err: unknown) => {
            this.logger.error(
              `event=ai_transcript_write_failed sessionId=${this.sessionId} error=${(err as Error)?.name ?? 'unknown'}`,
            );
          },
        ),
    );
  }

  /** Resolves once every queued write has settled (specs, shutdown). */
  flush() {
    return this.chain;
  }
}

/**
 * Stored transcripts (opt-in per agent) and their daily retention purge,
 * modelled on NotificationCleanupService.
 */
@Injectable()
export class AiTranscriptService {
  private readonly logger = new Logger(AiTranscriptService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * A writer when the agent stores transcripts, else null. Both the toggle
   * and a retention period are required; read once at connect.
   */
  async openWriter(
    sessionId: string,
    agentId: string,
  ): Promise<AiTranscriptWriter | null> {
    const agent = await this.prisma.aiAgent.findUnique({
      where: { id: agentId },
      select: { storeTranscript: true, transcriptRetentionDays: true },
    });
    if (!agent?.storeTranscript || !agent.transcriptRetentionDays) return null;
    return new AiTranscriptWriter(
      this.prisma,
      this.logger,
      sessionId,
      aiConfig().maxTranscriptMessages,
    );
  }

  listForSession(sessionId: string) {
    return this.prisma.aiConversationMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });
  }

  /**
   * Deletes messages older than their agent's transcriptRetentionDays.
   * Turning the toggle off deletes nothing at once; those messages age out
   * at FALLBACK_RETENTION_DAYS. Idempotent — safe to re-run or overlap.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(now = new Date()) {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    try {
      let deleted = 0;
      for (const days of TRANSCRIPT_RETENTION_DAYS) {
        if (days >= FALLBACK_RETENTION_DAYS) continue;
        const { count } = await this.prisma.aiConversationMessage.deleteMany({
          where: {
            createdAt: { lt: before(days) },
            session: { agent: { transcriptRetentionDays: days } },
          },
        });
        deleted += count;
      }
      const { count } = await this.prisma.aiConversationMessage.deleteMany({
        where: { createdAt: { lt: before(FALLBACK_RETENTION_DAYS) } },
      });
      deleted += count;
      if (deleted) {
        this.logger.log(`event=ai_transcripts_purged count=${deleted}`);
      }
      return { deleted };
    } catch (err) {
      this.logger.error(
        `event=ai_transcript_purge_failed error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return { deleted: 0 };
    }
  }
}
