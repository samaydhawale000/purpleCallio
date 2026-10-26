import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CreditTransactionType,
  TranslationMode,
  TranslationSession,
  TranslationSessionStatus,
} from '@prisma/client';

import { BillingConfigService } from '../billing/billing-config.service';
import { CreditService, DebitResult } from '../billing/credits/credit.service';
import { SubscriptionService } from '../billing/subscriptions/subscription.service';
import { UsageBillingService } from '../billing/usage-billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationAccessService } from './translation-access.service';
import { translationConfig } from './translation.config';

export const TRANSLATION_SESSION_REFERENCE = 'TRANSLATION_SESSION';
export const TRANSLATION_REPORT_REFERENCE = 'TRANSLATION_REPORT';

const UNBILLED_GRACE_MS = 2 * 60_000;
const SWEEP_BATCH_SIZE = 200;

export interface TranslationCharge {
  /** Credits owed before the wallet cap (after trial seconds). */
  credits: number;
  /** Credits actually debited. */
  debited: number;
  shortfall: number;
  trialSeconds: number;
  providerCostPaise: number;
}

/**
 * Whole credits for a direction-session, rounded up once (PROTOCOL.md §4).
 * Trial seconds are free and taken from voice first, then captions.
 */
export function translationCreditsFor(input: {
  voiceSeconds: number;
  captionsSeconds: number;
  voiceRate: number;
  captionsRate: number;
  trialSeconds?: number;
}): { credits: number; trialSeconds: number } {
  const voice = Math.max(0, input.voiceSeconds);
  const captions = Math.max(0, input.captionsSeconds);
  const trial = Math.min(voice + captions, Math.max(0, input.trialSeconds ?? 0));
  const trialVoice = Math.min(voice, trial);
  const trialCaptions = Math.min(captions, trial - trialVoice);
  const raw =
    ((voice - trialVoice) * input.voiceRate) / 60 +
    ((captions - trialCaptions) * input.captionsRate) / 60;
  return { credits: raw > 0 ? Math.ceil(raw - 1e-6) : 0, trialSeconds: trial };
}

/**
 * Soniox list prices per direction-minute when Admin → Live Translate has no
 * entry: STT+translation $0.12/h (≈ 17 paise/min at ₹85/$), billed for the
 * whole open stream; voice adds TTS ≈ $0.70/h of speech (≈ 50 paise/min at
 * ~half the minute spoken).
 */
export const DEFAULT_PROVIDER_COSTS_PAISE: Readonly<Record<string, number>> = {
  'soniox-captions': 17,
  'soniox-voice': 67,
};

/** Provider cost per direction-minute by route (for example `soniox-voice`). */
export function providerCostPaiseFor(
  costs: unknown,
  route: string,
  mode: TranslationMode | string,
  seconds: number,
): number {
  const table = (costs && typeof costs === 'object' ? costs : {}) as Record<string, unknown>;
  const modeKey = `${route}-${String(mode).toLowerCase() === 'voice' ? 'voice' : 'captions'}`;
  const raw = table[modeKey] ?? table[route] ?? DEFAULT_PROVIDER_COSTS_PAISE[modeKey];
  const perMinute = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return Math.round((Math.max(0, seconds) / 60) * perMinute);
}

@Injectable()
export class TranslationBillingService {
  private readonly logger = new Logger(TranslationBillingService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingConfig: BillingConfigService,
    private readonly credits: CreditService,
    private readonly access: TranslationAccessService,
    @Optional() private readonly subscriptions?: SubscriptionService,
    @Optional() private readonly usageBilling?: UsageBillingService,
  ) {}

  /**
   * Debits a finished direction-session exactly once: the usageRecordedAt
   * claim, trial allocation, debit and session update commit together under
   * the wallet lock, and `translation:<id>` is the ledger idempotency key.
   * Returns null when already recorded or still live.
   */
  async recordSession(sessionId: string): Promise<TranslationCharge | null> {
    const session = await this.prisma.translationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.usageRecordedAt) return null;
    if (session.status === TranslationSessionStatus.ACTIVE) return null;

    const [config, entitled] = await Promise.all([
      this.billingConfig.get(),
      this.access.isEntitled(session.ownerId),
    ]);
    const sub = this.subscriptions
      ? await this.subscriptions.getActiveSubscription(session.ownerId).catch(() => null)
      : null;
    const before = sub
      ? await this.credits.getSummary(session.ownerId, sub.currentPeriodStart)
      : null;
    const providerCostPaise = providerCostPaiseFor(
      config.translationProviderCostsPaise,
      session.route,
      session.mode,
      session.voiceSeconds + session.captionsSeconds,
    );

    const result = await this.credits.withWallet(session.ownerId, async (tx) => {
      const claimed = await tx.translationSession.updateMany({
        where: { id: session.id, usageRecordedAt: null },
        data: { usageRecordedAt: new Date() },
      });
      if (claimed.count === 0) return null;

      let trialAvailable = 0;
      if (!entitled && config.translationTrialMinutes > 0) {
        const used = await tx.translationSession.aggregate({
          where: { ownerId: session.ownerId },
          _sum: { trialSecondsUsed: true },
        });
        trialAvailable = Math.max(
          0,
          config.translationTrialMinutes * 60 - (used._sum.trialSecondsUsed ?? 0),
        );
      }
      const { credits, trialSeconds } = translationCreditsFor({
        voiceSeconds: session.voiceSeconds,
        captionsSeconds: session.captionsSeconds,
        voiceRate: session.voiceRate,
        captionsRate: session.captionsRate,
        trialSeconds: trialAvailable,
      });
      const debit =
        credits > 0
          ? await this.credits.debit(
              {
                userId: session.ownerId,
                amount: credits,
                type: CreditTransactionType.USAGE_DEBIT,
                referenceType: TRANSLATION_SESSION_REFERENCE,
                referenceId: session.id,
                idempotencyKey: `translation:${session.id}`,
                allowPartial: true,
                metadata: {
                  sessionId: session.id,
                  callId: session.callId,
                  direction: session.direction,
                  route: session.route,
                  voiceSeconds: session.voiceSeconds,
                  captionsSeconds: session.captionsSeconds,
                  trialSeconds,
                  voiceRate: session.voiceRate,
                  captionsRate: session.captionsRate,
                  credits,
                },
              },
              tx,
            )
          : { debited: 0, shortfall: 0 };
      await tx.translationSession.update({
        where: { id: session.id },
        data: {
          creditsCharged: debit.debited,
          trialSecondsUsed: trialSeconds,
          providerCostPaise,
        },
      });
      return {
        credits,
        debited: debit.debited,
        shortfall: debit.shortfall,
        trialSeconds,
        providerCostPaise,
      };
    });

    if (!result) return null;
    if (result.shortfall > 0) {
      this.logger.warn(
        `event=translation_billing_shortfall sessionId=${session.id} ownerId=${session.ownerId} credits=${result.credits} shortfall=${result.shortfall}`,
      );
    }
    this.logger.log(
      `event=translation_billing_recorded sessionId=${session.id} ownerId=${session.ownerId} credits=${result.debited} trialSeconds=${result.trialSeconds}`,
    );
    if (result.debited > 0 && sub?.currentPeriodStart && before && this.usageBilling) {
      await this.usageBilling.notifyThresholds(
        session.ownerId,
        sub.id,
        sub.currentPeriodStart,
        before,
      );
    }
    return result;
  }

  /** Post-Call Suite report: charged once per call. */
  async chargeReport(
    callId: string,
    ownerId: string,
    credits: number,
  ): Promise<DebitResult | { debited: 0; shortfall: 0; duplicate: false }> {
    if (!(credits > 0)) return { debited: 0, shortfall: 0, duplicate: false };
    return this.credits.debit({
      userId: ownerId,
      amount: Math.ceil(credits),
      type: CreditTransactionType.USAGE_DEBIT,
      referenceType: TRANSLATION_REPORT_REFERENCE,
      referenceId: callId,
      idempotencyKey: `translation-report:${callId}`,
      allowPartial: true,
      metadata: { callId, credits: Math.ceil(credits) },
    });
  }

  /** Safety net: bills ended sessions whose finalize-time debit never ran. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async billUnrecordedSessions() {
    if (this.sweeping || !translationConfig().enabled) return;
    this.sweeping = true;
    try {
      const unbilled: Pick<TranslationSession, 'id'>[] =
        await this.prisma.translationSession.findMany({
          where: {
            usageRecordedAt: null,
            status: {
              in: [TranslationSessionStatus.ENDED, TranslationSessionStatus.FAILED],
            },
            endedAt: { lt: new Date(Date.now() - UNBILLED_GRACE_MS) },
          },
          select: { id: true },
          take: SWEEP_BATCH_SIZE,
        });
      let billed = 0;
      for (const s of unbilled) {
        try {
          if (await this.recordSession(s.id)) billed++;
        } catch (err) {
          this.logger.error(
            `event=translation_billing_failed sessionId=${s.id} error=${(err as Error)?.name ?? 'unknown'}`,
          );
        }
      }
      if (billed > 0) this.logger.warn(`event=translation_billing_swept count=${billed}`);
    } catch (err) {
      this.logger.error(
        `event=translation_billing_sweep_failed error=${(err as Error)?.name ?? 'unknown'}`,
      );
    } finally {
      this.sweeping = false;
    }
  }
}
