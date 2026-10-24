import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  NotificationType,
  Prisma,
  TranslationPhrase,
  TranslationReportStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { BillingConfigService } from '../../billing/billing-config.service';
import { NotificationService } from '../../notification/notification.service';
import { WebhookService } from '../../webhook/webhook.service';
import { TranslationBillingService } from '../translation-billing.service';
import { TranslationSettingsService } from '../translation-settings.service';
import { readTranslationConfig } from '../translation-config';
import { REPORT_SUMMARIZER } from './report-summarizer.interface';
import type {
  ReportSummarizer,
  SummarizeOutput,
  SummarizePhrase,
  ToneItem,
} from './report-summarizer.interface';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stable error codes stored on FAILED reports. */
export const ReportErrorCode = {
  SUMMARY_FAILED: 'TRANSLATION_REPORT_SUMMARY_FAILED',
  CHARGE_FAILED: 'TRANSLATION_REPORT_CHARGE_FAILED',
  BUILD_FAILED: 'TRANSLATION_REPORT_BUILD_FAILED',
} as const;

export interface ReportPhrase {
  phraseId: string;
  speaker: 'caller' | 'receiver';
  sourceLanguage: string;
  targetLanguage: string;
  original: string;
  translated: string;
  startedAt: number;
  endedAt?: number;
  translatedAudioAt?: number;
  guardStatus: string;
  guardReasons: string[];
  /** Same as guardStatus/guardReasons, Caption-shaped. */
  guard: { status: string; reasons: string[] };
}

export interface ReportSignals {
  talkRatio: { caller: number; receiver: number };
  topics: string[];
  flaggedMoments: {
    phraseId: string;
    speaker: 'caller' | 'receiver';
    at: number;
    reasons: string[];
    original: string;
    translated: string;
  }[];
  replays: number;
  repeats: number;
  /** Only when sentiment is enabled and the industry is not healthcare. Each item is a *possible* tone. */
  tone?: ToneItem[];
}

function speakerOf(s: string): 'caller' | 'receiver' {
  return s === 'receiver' ? 'receiver' : 'caller';
}

export function toReportPhrase(p: TranslationPhrase): ReportPhrase {
  return {
    phraseId: p.phraseId,
    speaker: speakerOf(p.speaker),
    sourceLanguage: p.sourceLanguage,
    targetLanguage: p.targetLanguage,
    original: p.original,
    translated: p.translated,
    startedAt: p.startedAt.getTime(),
    ...(p.endedAt ? { endedAt: p.endedAt.getTime() } : {}),
    ...(p.translatedAudioAt
      ? { translatedAudioAt: p.translatedAudioAt.getTime() }
      : {}),
    guardStatus: p.guardStatus,
    guardReasons: p.guardReasons,
    guard: { status: p.guardStatus, reasons: p.guardReasons },
  };
}

/** Share of speaking time by phrase duration (falls back to text length). */
export function talkRatio(phrases: TranslationPhrase[]) {
  let caller = 0;
  let receiver = 0;
  for (const p of phrases) {
    const ms =
      p.endedAt && p.endedAt > p.startedAt
        ? p.endedAt.getTime() - p.startedAt.getTime()
        : Math.max(1, p.original.length) * 60; // ~60 ms per character
    if (speakerOf(p.speaker) === 'caller') caller += ms;
    else receiver += ms;
  }
  const total = caller + receiver;
  if (!total) return { caller: 0, receiver: 0 };
  const c = Math.round((caller / total) * 100) / 100;
  return { caller: c, receiver: Math.round((1 - c) * 100) / 100 };
}

/**
 * Post-Call Suite (translation/PROTOCOL.md §7): builds, charges and serves
 * the per-call translation report, and purges expired phrases/reports.
 */
@Injectable()
export class TranslationReportService {
  private readonly logger = new Logger(TranslationReportService.name);
  private readonly running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private settings: TranslationSettingsService,
    private billingConfig: BillingConfigService,
    private billing: TranslationBillingService,
    private webhooks: WebhookService,
    private notifications: NotificationService,
    @Inject(REPORT_SUMMARIZER) private summarizer: ReportSummarizer,
  ) {}

  /**
   * Starts the report job for an ended call. Idempotent (one report per
   * call); never throws. The build runs in the background.
   */
  async enqueue(callId: string): Promise<void> {
    try {
      const reportId = await this.createPending(callId);
      if (!reportId) return;
      setImmediate(() => {
        void this.build(callId);
      });
    } catch (err) {
      this.logger.error(
        `event=translation_report_enqueue_failed callId=${callId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
    }
  }

  /** Creates the PENDING row if a report is due. Returns its id, or null when skipped. */
  async createPending(callId: string): Promise<string | null> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: {
        id: true,
        projectId: true,
        translationConfig: true,
        translationReport: { select: { id: true } },
      },
    });
    if (!call || call.translationReport) return null;
    const settings = await this.settings.get(call.projectId);
    const config = readTranslationConfig(call.translationConfig);
    if (!settings.postCallReportEnabled || config.postCallReport === false)
      return null;
    const phrases = await this.prisma.translationPhrase.count({
      where: { callId },
    });
    if (!phrases) return null;
    try {
      const row = await this.prisma.translationReport.create({
        data: {
          callId,
          projectId: call.projectId,
          status: TranslationReportStatus.PENDING,
          expiresAt: new Date(
            Date.now() + settings.transcriptRetentionDays * DAY_MS,
          ),
        },
      });
      return row.id;
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') return null; // already queued
      throw err;
    }
  }

  /** Builds a PENDING report. Exposed for specs and retries. */
  async build(callId: string): Promise<TranslationReportStatus | null> {
    if (this.running.has(callId)) return null;
    this.running.add(callId);
    try {
      return await this.buildInner(callId);
    } finally {
      this.running.delete(callId);
    }
  }

  private async buildInner(callId: string) {
    const report = await this.prisma.translationReport.findUnique({
      where: { callId },
    });
    if (!report || report.status !== TranslationReportStatus.PENDING)
      return report?.status ?? null;

    let summary: SummarizeOutput;
    let phrases: TranslationPhrase[];
    let signals: ReportSignals;
    let ownerId: string;
    let projectId: string;
    try {
      const call = await this.prisma.call.findUniqueOrThrow({
        where: { id: callId },
        select: {
          projectId: true,
          callerLanguage: true,
          receiverLanguage: true,
          translationConfig: true,
          project: { select: { ownerId: true } },
        },
      });
      ownerId = call.project.ownerId;
      projectId = call.projectId;
      const [settings, rows, sessions] = await Promise.all([
        this.settings.get(call.projectId),
        this.prisma.translationPhrase.findMany({
          where: { callId },
          orderBy: { startedAt: 'asc' },
        }),
        this.prisma.translationSession.aggregate({
          where: { callId },
          _sum: { replays: true, repeats: true },
        }),
      ]);
      phrases = rows;
      const config = readTranslationConfig(call.translationConfig);
      // The call's own context wins over the project default.
      const industry = config.context?.industry ?? settings.industry ?? null;
      const includeTone =
        settings.sentimentEnabled && industry !== 'healthcare';
      const languages = {
        caller: this.languageOf('caller', call.callerLanguage, rows),
        receiver: this.languageOf('receiver', call.receiverLanguage, rows),
      };
      const input: SummarizePhrase[] = rows.map((p) => ({
        phraseId: p.phraseId,
        speaker: speakerOf(p.speaker),
        sourceLanguage: p.sourceLanguage,
        targetLanguage: p.targetLanguage,
        original: p.original,
        translated: p.translated,
        guardStatus: p.guardStatus,
        guardReasons: p.guardReasons,
      }));
      try {
        summary = await this.summarizer.summarize({
          phrases: input,
          languages,
          includeTone,
          industry,
        });
      } catch (err) {
        this.logger.warn(
          `event=translation_report_summary_failed callId=${callId} summarizer=${this.summarizer.name} error=${(err as Error)?.name ?? 'unknown'}`,
        );
        return this.fail(callId, ReportErrorCode.SUMMARY_FAILED);
      }
      signals = {
        talkRatio: talkRatio(rows),
        topics: (summary.topics ?? []).slice(0, 20),
        flaggedMoments: rows
          .filter((p) => p.guardStatus !== 'ok' || p.guardReasons.length > 0)
          .map((p) => ({
            phraseId: p.phraseId,
            speaker: speakerOf(p.speaker),
            at: p.startedAt.getTime(),
            reasons: p.guardReasons,
            original: p.original,
            translated: p.translated,
          })),
        replays: sessions._sum.replays ?? 0,
        repeats: sessions._sum.repeats ?? 0,
        ...(includeTone && summary.tone?.length ? { tone: summary.tone } : {}),
      };
    } catch (err) {
      this.logger.error(
        `event=translation_report_build_failed callId=${callId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return this.fail(callId, ReportErrorCode.BUILD_FAILED);
    }

    let creditsCharged = 0;
    try {
      const [config, override] = await Promise.all([
        this.billingConfig.get(),
        this.prisma.translationRateOverride.findUnique({
          where: { userId: ownerId },
        }),
      ]);
      const credits =
        override?.postCallReportCredits ?? config.postCallReportCredits;
      const result = await this.billing.chargeReport(callId, ownerId, credits);
      creditsCharged = result.debited;
    } catch (err) {
      this.logger.error(
        `event=translation_report_charge_failed callId=${callId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return this.fail(callId, ReportErrorCode.CHARGE_FAILED);
    }

    await this.prisma.translationReport.update({
      where: { callId },
      data: {
        status: TranslationReportStatus.READY,
        summary: summary.summary as unknown as Prisma.InputJsonValue,
        signals: signals as unknown as Prisma.InputJsonValue,
        creditsCharged,
        error: null,
      },
    });
    void this.notifications.createNotification({
      userId: ownerId,
      type: NotificationType.TRANSLATION_REPORT_READY,
      title: 'Translation report ready',
      message: `The post-call report for a translated call (${phrases.length} phrases) is ready.`,
      metadata: { callId, projectId },
      dedupeKey: `translation-report:${callId}`,
    });
    void this.webhooks.fireForCall(callId, 'call.translation.report_ready', {
      status: 'ready',
    });
    return TranslationReportStatus.READY;
  }

  private languageOf(
    role: 'caller' | 'receiver',
    configured: string | null,
    phrases: TranslationPhrase[],
  ): string {
    if (configured && configured !== 'auto') return configured;
    // "auto": the language detected on that speaker's phrases, else the
    // language the other side translated into.
    const spoken = phrases.find((p) => p.speaker === role)?.sourceLanguage;
    if (spoken && spoken !== 'auto') return spoken;
    const heard = phrases.find((p) => p.speaker !== role)?.targetLanguage;
    return heard ?? 'en';
  }

  private async fail(callId: string, code: string) {
    await this.prisma.translationReport
      .update({
        where: { callId },
        data: { status: TranslationReportStatus.FAILED, error: code },
      })
      .catch(() => undefined);
    void this.webhooks.fireForCall(callId, 'call.translation.report_ready', {
      status: 'failed',
    });
    return TranslationReportStatus.FAILED;
  }

  /** GET …/translation-report. `projectId` scopes the lookup (API key / dashboard). */
  async getReport(callId: string, projectId?: string) {
    const report = await this.prisma.translationReport.findFirst({
      where: {
        callId,
        ...(projectId ? { projectId } : {}),
        expiresAt: { gt: new Date() },
      },
    });
    if (!report)
      throw new NotFoundException({
        statusCode: 404,
        code: 'TRANSLATION_REPORT_NOT_FOUND',
        message: 'No translation report for this call.',
      });
    const phrases =
      report.status === TranslationReportStatus.READY
        ? await this.prisma.translationPhrase.findMany({
            where: { callId, expiresAt: { gt: new Date() } },
            orderBy: { startedAt: 'asc' },
          })
        : [];
    return {
      callId,
      status: report.status.toLowerCase() as 'pending' | 'ready' | 'failed',
      transcript: phrases.map(toReportPhrase),
      summary: report.summary ?? null,
      signals: report.signals ?? null,
      creditsCharged: report.creditsCharged,
      createdAt: report.createdAt,
      expiresAt: report.expiresAt,
      ...(report.error ? { error: report.error } : {}),
    };
  }

  /**
   * Safety net: rebuilds reports left PENDING (instance restarted while
   * building). build() is a no-op unless the row is still PENDING.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryStalePending(now = new Date()) {
    try {
      const stale = await this.prisma.translationReport.findMany({
        where: {
          status: TranslationReportStatus.PENDING,
          updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
        },
        select: { callId: true },
        take: 20,
      });
      for (const r of stale) await this.build(r.callId);
      return stale.length;
    } catch (err) {
      this.logger.error(
        `event=translation_report_retry_failed error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return 0;
    }
  }

  /** Daily purge of expired phrases and reports (retention). Idempotent. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(now = new Date()) {
    try {
      const phrases = await this.prisma.translationPhrase.deleteMany({
        where: { expiresAt: { lt: now } },
      });
      const reports = await this.prisma.translationReport.deleteMany({
        where: { expiresAt: { lt: now } },
      });
      if (phrases.count || reports.count) {
        this.logger.log(
          `event=translation_reports_purged phrases=${phrases.count} reports=${reports.count}`,
        );
      }
      return { phrases: phrases.count, reports: reports.count };
    } catch (err) {
      this.logger.error(
        `event=translation_report_purge_failed error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return { phrases: 0, reports: 0 };
    }
  }
}
