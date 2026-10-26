import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AiCallSession,
  AiSessionStatus,
  CreditTransactionType,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  BillingConfigService,
  toCredits,
} from '../billing/billing-config.service';
import { CreditService } from '../billing/credits/credit.service';
import { creditValuePaise } from '../billing/credit-value';
import { SubscriptionService } from '../billing/subscriptions/subscription.service';
import { UsageBillingService } from '../billing/usage-billing.service';
import { aiConfig } from './ai.config';
import { AiPricingService } from './ai-pricing.service';

/** Ledger reference for AI call debits (customer history labels key off it). */
export const AI_SESSION_REFERENCE = 'AI_SESSION';

/** A finalize hook that failed is retried by the sweep after this long. */
const UNBILLED_GRACE_MS = 2 * 60_000;
const SWEEP_BATCH_SIZE = 200;

/**
 * Whole credits for an AI call. Same rounding as human calls (`toCredits`):
 * fractional minutes × rate, rounded up once for the whole call.
 */
export function aiCreditsFor(
  durationSeconds: number,
  creditsPerMinute: number,
): number {
  return toCredits(Math.max(0, durationSeconds) / 60, creditsPerMinute);
}

/** Whole minutes of AI calling the available balance pays for, in seconds. */
export function maxSecondsForBalance(
  availableCredits: number,
  creditsPerMinute: number,
): number {
  if (creditsPerMinute <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.floor(Math.max(0, availableCredits) / creditsPerMinute) * 60;
}

/**
 * AI call → credits. Mirrors UsageBillingService.recordCallUsage: one debit
 * per session after it ends, never below zero (`allowPartial`), the
 * uncovered rest recorded as shortfall. AI calls stay out of the human-call
 * path: no CallSession, CallUsage or Usage rows are written.
 */
@Injectable()
export class AiBillingService {
  private readonly logger = new Logger(AiBillingService.name);
  private sweeping = false;

  constructor(
    private prisma: PrismaService,
    private config: BillingConfigService,
    private credits: CreditService,
    private subscriptions: SubscriptionService,
    private usageBilling: UsageBillingService,
    private pricing: AiPricingService,
  ) {}

  /** Session length cap from paid credits (whole minutes at the AI rate). */
  async maxSecondsByBalance(ownerId: string): Promise<number> {
    const sub = await this.subscriptions.getActiveSubscription(ownerId);
    const [config, wallet] = await Promise.all([
      this.config.get(),
      this.credits.getSummary(ownerId, sub.currentPeriodStart),
    ]);
    return maxSecondsForBalance(wallet.paidAvailable, config.aiCreditsPerMinute);
  }

  /**
   * Debits a finished session exactly once. The usageRecordedAt claim, the
   * debit and the session update commit together under the wallet lock, and
   * `ai-session:<id>` is the ledger idempotency key, so a retry (or a second
   * instance) can never charge twice. Returns false when already recorded.
   */
  async recordSession(session: AiCallSession): Promise<boolean> {
    if (session.usageRecordedAt) return false;
    if (
      session.status !== AiSessionStatus.ENDED &&
      session.status !== AiSessionStatus.FAILED
    ) {
      return false;
    }

    const config = await this.config.get();
    const durationSeconds = session.durationSeconds ?? 0;
    const credits = aiCreditsFor(durationSeconds, config.aiCreditsPerMinute);
    const providerCostPaise = this.pricing.providerCostPaise(session);
    const sub = await this.subscriptions.getActiveSubscription(session.ownerId);
    const before = await this.credits.getSummary(
      session.ownerId,
      sub.currentPeriodStart,
    );

    const result = await this.credits.withWallet(
      session.ownerId,
      async (tx) => {
        const claimed = await tx.aiCallSession.updateMany({
          where: { id: session.id, usageRecordedAt: null },
          data: { usageRecordedAt: new Date() },
        });
        if (claimed.count === 0) return null;

        // A call that never connected costs nothing and leaves no ledger row.
        const debit =
          credits > 0
            ? await this.credits.debit(
                {
                  userId: session.ownerId,
                  amount: credits,
                  type: CreditTransactionType.USAGE_DEBIT,
                  referenceType: AI_SESSION_REFERENCE,
                  referenceId: session.id,
                  idempotencyKey: `ai-session:${session.id}`,
                  allowPartial: true,
                  paidOnly: true,
                  metadata: {
                    sessionId: session.id,
                    callId: session.callId,
                    agentId: session.agentId,
                    aiSeconds: durationSeconds,
                    aiMinutes: round2(durationSeconds / 60),
                    aiCredits: credits,
                    aiCreditsPerMinute: config.aiCreditsPerMinute,
                  },
                },
                tx,
              )
            : { debited: 0, shortfall: 0 };

        await tx.aiCallSession.update({
          where: { id: session.id },
          data: {
            creditsCharged: debit.debited,
            creditsShortfall: debit.shortfall > 0 ? debit.shortfall : null,
            providerCostPaise,
          },
        });
        await tx.callEvent.create({
          data: {
            callId: session.callId,
            event: 'AI_BILLING_RECORDED',
            metadata: {
              sessionId: session.id,
              durationSeconds,
              credits,
              creditsCharged: debit.debited,
              shortfall: debit.shortfall,
            },
          },
        });
        return debit;
      },
    );

    if (!result) return false;
    if (result.shortfall > 0) {
      this.logger.warn(
        `event=ai_billing_shortfall sessionId=${session.id} ownerId=${session.ownerId} credits=${credits} shortfall=${result.shortfall}`,
      );
    }
    this.logger.log(
      `event=ai_billing_recorded sessionId=${session.id} ownerId=${session.ownerId} durationSeconds=${durationSeconds} credits=${result.debited}`,
    );
    if (result.debited > 0 && sub.currentPeriodStart) {
      // Same period key as human calls, so a threshold is announced once.
      await this.usageBilling.notifyThresholds(
        session.ownerId,
        sub.id,
        sub.currentPeriodStart,
        before,
      );
    }
    return true;
  }

  /**
   * Safety net for a finalize hook that failed (DB blip, crash between the
   * end and the debit): bills ended sessions that were never recorded.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async billUnrecordedSessions() {
    if (this.sweeping || !aiConfig().enabled) return;
    this.sweeping = true;
    try {
      const unbilled = await this.prisma.aiCallSession.findMany({
        where: {
          usageRecordedAt: null,
          status: { in: [AiSessionStatus.ENDED, AiSessionStatus.FAILED] },
          endedAt: { lt: new Date(Date.now() - UNBILLED_GRACE_MS) },
        },
        take: SWEEP_BATCH_SIZE,
      });
      let billed = 0;
      for (const session of unbilled) {
        try {
          if (await this.recordSession(session)) billed++;
        } catch (err) {
          this.logger.error(
            `event=ai_billing_failed sessionId=${session.id} error=${(err as Error)?.name ?? 'unknown'}`,
          );
        }
      }
      if (billed > 0) {
        this.logger.warn(`event=ai_billing_swept count=${billed}`);
      }
    } catch (err) {
      this.logger.error(
        `event=ai_billing_sweep_failed error=${(err as Error)?.name ?? 'unknown'}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Admin: AI minutes, credits, provider cost and margin for sessions billed
   * in [from, to). Credits are valued at the published credit price
   * (see billing/credit-value.ts).
   */
  async adminSummary(from: Date, to: Date) {
    const [agg, creditValue] = await Promise.all([
      this.prisma.aiCallSession.aggregate({
        where: { usageRecordedAt: { gte: from, lt: to } },
        _sum: {
          durationSeconds: true,
          creditsCharged: true,
          creditsShortfall: true,
          providerCostPaise: true,
          inputTokens: true,
          outputTokens: true,
        },
        _count: true,
      }),
      creditValuePaise(this.prisma),
    ]);
    const creditsCharged = agg._sum.creditsCharged ?? 0;
    const providerCostPaise = agg._sum.providerCostPaise ?? 0;
    const revenuePaise =
      creditValue.paise == null
        ? null
        : Math.round(creditsCharged * creditValue.paise);
    const marginPaise =
      revenuePaise == null ? null : revenuePaise - providerCostPaise;
    return {
      from,
      to,
      sessions: agg._count,
      minutes: round2((agg._sum.durationSeconds ?? 0) / 60),
      creditsCharged,
      creditsShortfall: agg._sum.creditsShortfall ?? 0,
      inputTokens: agg._sum.inputTokens ?? 0,
      outputTokens: agg._sum.outputTokens ?? 0,
      providerCostPaise,
      creditValuePaise: creditValue.paise,
      creditValueSource: creditValue.source,
      revenuePaise,
      marginPaise,
      marginPercent:
        revenuePaise && marginPaise != null
          ? round2((marginPaise / revenuePaise) * 100)
          : null,
      usdInrRate: this.pricing.usdInrRate(),
      currency: 'INR',
    };
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
