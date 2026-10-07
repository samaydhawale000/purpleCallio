import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreditTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingConfigService } from './billing-config.service';
import { CreditService } from './credits/credit.service';
import { SubscriptionService } from './subscriptions/subscription.service';
import {
  EntitlementService,
  CallEligibility,
} from './subscriptions/entitlement.service';
import { BillingNotificationService } from './billing-notification.service';
import { omit } from './omit.util';

export interface UsageSnapshot {
  audioMinutes: number;
  videoMinutes: number;
  screenShareMinutes: number;
  participants: number;
  callsCreated: number;
  callsCompleted: number;
}

/** LEGACY per-minute paise rates (BillingRate) — internal cost basis only. */
export interface BillingRates {
  audioPaise: number;
  videoPaise: number;
  screenSharePaise: number;
  freeAudioMins: number;
  freeVideoMins: number;
  taxPercent: number;
}

/**
 * Usage → credits.
 *
 * Measurement is unchanged: calls are metered as fractional
 * participant-minutes per media type (UsageSegmentService →
 * RatingEngineService). What changed is the output: a finished call's
 * minutes are converted to credits (BillingConfig rates) and debited from
 * the customer's prepaid wallet — there is no invoice and nothing is owed.
 *
 * Policy when a call runs past the balance: the call is never cut off; the
 * debit takes whatever credits remain (the balance never goes negative) and
 * the uncovered remainder is recorded as `shortfall` on the ledger entry
 * for visibility. New calls are then blocked until credits are added.
 */
@Injectable()
export class UsageBillingService {
  private readonly logger = new Logger(UsageBillingService.name);

  constructor(
    private prisma: PrismaService,
    private config: BillingConfigService,
    private credits: CreditService,
    private subscriptions: SubscriptionService,
    private entitlements: EntitlementService,
    private notify: BillingNotificationService,
  ) {}

  /** LEGACY: pay-as-you-go rates (for historical invoices / internal cost). */
  async getRates(): Promise<BillingRates> {
    const rate = await this.prisma.billingRate.findUnique({
      where: { key: 'default' },
    });
    if (!rate) {
      return {
        audioPaise: 20,
        videoPaise: 80,
        screenSharePaise: 10,
        freeAudioMins: 500,
        freeVideoMins: 200,
        taxPercent: 18,
      };
    }
    return {
      audioPaise: rate.audioPaise,
      videoPaise: rate.videoPaise,
      screenSharePaise: rate.screenSharePaise,
      freeAudioMins: rate.freeAudioMins,
      freeVideoMins: rate.freeVideoMins,
      taxPercent: rate.taxPercent,
    };
  }

  /** LEGACY: update the internal cost-basis rates (not customer-facing). */
  async updateRates(data: Partial<BillingRates>) {
    const pick = (k: keyof BillingRates) =>
      data[k] !== undefined &&
      Number.isFinite(Number(data[k])) &&
      Number(data[k]) >= 0
        ? { [k]: Math.round(Number(data[k])) }
        : {};
    const fields = {
      ...pick('audioPaise'),
      ...pick('videoPaise'),
      ...pick('screenSharePaise'),
    };
    return this.prisma.billingRate.upsert({
      where: { key: 'default' },
      create: { key: 'default', ...fields },
      update: fields,
    });
  }

  /** Internal cost (paise) of usage at the legacy rate card — analytics only. */
  private internalCostPaise(
    m: {
      audioMinutes: number;
      videoMinutes: number;
      screenShareMinutes: number;
    },
    rates: BillingRates,
  ) {
    return Math.round(
      m.audioMinutes * rates.audioPaise +
        m.videoMinutes * rates.videoPaise +
        m.screenShareMinutes * rates.screenSharePaise,
    );
  }

  /**
   * The Usage row for the customer's current subscription period (created
   * on demand). Analytics aggregate only — credits are the billing record.
   */
  async getOrCreateUsage(userId: string) {
    const sub = await this.subscriptions.getActiveSubscription(userId);
    const cycleStart = sub.currentPeriodStart ?? new Date();
    const cycleEnd = sub.currentPeriodEnd ?? new Date();
    const existing = await this.prisma.usage.findUnique({
      where: {
        companyId_billingCycleStart: {
          companyId: userId,
          billingCycleStart: cycleStart,
        },
      },
    });
    if (existing) return existing;
    try {
      return await this.prisma.usage.create({
        data: {
          companyId: userId,
          subscriptionId: sub.id,
          billingCycleStart: cycleStart,
          billingCycleEnd: cycleEnd,
        },
      });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      return this.prisma.usage.findUniqueOrThrow({
        where: {
          companyId_billingCycleStart: {
            companyId: userId,
            billingCycleStart: cycleStart,
          },
        },
      });
    }
  }

  /**
   * Records a finished call exactly once and debits its credits. The
   * CallUsage row, the Usage aggregate and the credit debit commit in one
   * transaction; `usage:<callId>` is the ledger idempotency key, so a
   * retried recording can never charge twice.
   */
  async recordCallUsage(
    userId: string,
    callId: string,
    data: {
      audioMinutes: number;
      videoMinutes: number;
      screenShareMinutes: number;
      participants: number;
      startedAt?: Date;
      endedAt?: Date;
    },
  ) {
    const usage = await this.getOrCreateUsage(userId);
    const existing = await this.prisma.callUsage.findFirst({
      where: { callId },
    });
    if (existing) {
      this.logger.warn(
        `Usage for call ${callId} was already recorded — skipping duplicate debit.`,
      );
      return usage;
    }

    const [config, rates] = await Promise.all([
      this.config.get(),
      this.getRates(),
    ]);
    const credits = this.config.creditsFor(data, config);
    const costPaise = this.internalCostPaise(data, rates);
    const before = await this.credits.getSummary(
      userId,
      usage.billingCycleStart,
    );

    const result = await this.credits.withWallet(userId, async (tx) => {
      const dup = await tx.callUsage.findFirst({
        where: { callId },
        select: { id: true },
      });
      if (dup) return null;
      const debit = await this.credits.debit(
        {
          userId,
          amount: credits.totalCredits,
          type: CreditTransactionType.USAGE_DEBIT,
          referenceType: 'Call',
          referenceId: callId,
          idempotencyKey: `usage:${callId}`,
          allowPartial: true,
          metadata: {
            callId,
            audioMinutes: round2(data.audioMinutes),
            videoMinutes: round2(data.videoMinutes),
            screenShareMinutes: round2(data.screenShareMinutes),
            participants: data.participants,
            audioCredits: credits.audioCredits,
            videoCredits: credits.videoCredits,
            screenShareCredits: credits.screenShareCredits,
          },
        },
        tx,
      );
      const updated = await tx.usage.update({
        where: { id: usage.id },
        data: {
          audioMinutes: { increment: data.audioMinutes },
          videoMinutes: { increment: data.videoMinutes },
          screenShareMinutes: { increment: data.screenShareMinutes },
          participants: { increment: data.participants },
          callsCompleted: { increment: 1 },
          usageCostPaise: { increment: costPaise },
          creditsUsed: { increment: debit.debited },
        },
      });
      await tx.callUsage.create({
        data: {
          usageId: usage.id,
          callId,
          audioMinutes: data.audioMinutes,
          videoMinutes: data.videoMinutes,
          screenShareMinutes: data.screenShareMinutes,
          participants: data.participants,
          costPaise,
          creditsCharged: debit.debited,
          startedAt: data.startedAt ?? null,
          endedAt: data.endedAt ?? new Date(),
        },
      });
      return { updated, debit };
    });

    if (!result) return usage;
    if (result.debit.shortfall > 0) {
      this.logger.warn(
        `Call ${callId} for ${userId} needed ${credits.totalCredits} credits; ${result.debit.shortfall} were not covered by the balance.`,
      );
    }
    this.logger.log(
      `Recorded call ${callId} for ${userId}: ${result.debit.debited} credits`,
    );
    await this.notifyThresholds(
      userId,
      usage.subscriptionId ?? usage.id,
      usage.billingCycleStart,
      before,
    );
    return result.updated;
  }

  /**
   * Low-credit notices when this debit crossed a configured threshold of the
   * period's credits (e.g. 80/90/100%). Only the highest crossed threshold
   * is sent; the per-period dedupe key stops repeats.
   */
  private async notifyThresholds(
    userId: string,
    periodRef: string,
    periodStart: Date,
    before: { granted: number; balance: number; usedPercent: number },
  ) {
    try {
      const [config, after] = await Promise.all([
        this.config.get(),
        this.credits.getSummary(userId, periodStart),
      ]);
      if (after.granted <= 0) return;
      const beforePct =
        before.granted > 0
          ? ((before.granted - before.balance) / before.granted) * 100
          : 0;
      const afterPct =
        after.balance <= 0
          ? 100
          : ((after.granted - after.balance) / after.granted) * 100;
      const crossed = [...config.lowCreditThresholds]
        .sort((a, b) => b - a)
        .find((t) => beforePct < t && afterPct >= t);
      if (!crossed) return;
      await this.notify.creditsThreshold(
        userId,
        crossed,
        `${periodRef}:${periodStart.toISOString()}`,
      );
    } catch (err) {
      this.logger.warn(
        `Credit threshold check failed for ${userId}: ${String(err)}`,
      );
    }
  }

  /** The single eligibility rule for starting a call (BillingGuard + CallService). */
  async canStartCall(
    ownerId: string,
    type: 'AUDIO' | 'VIDEO',
  ): Promise<CallEligibility> {
    return this.entitlements.canStartCall(ownerId, type);
  }

  private async getAggregatedCallUsage(usageId: string) {
    const agg = await this.prisma.callUsage.aggregate({
      where: { usageId },
      _sum: {
        audioMinutes: true,
        videoMinutes: true,
        screenShareMinutes: true,
        participants: true,
        creditsCharged: true,
      },
      _count: true,
    });
    return {
      audioMinutes: agg._sum.audioMinutes ?? 0,
      videoMinutes: agg._sum.videoMinutes ?? 0,
      screenShareMinutes: agg._sum.screenShareMinutes ?? 0,
      participants: agg._sum.participants ?? 0,
      creditsCharged: agg._sum.creditsCharged ?? 0,
      callsCompleted: agg._count,
    };
  }

  /** Current period: minutes, credits consumed per media, wallet and plan. */
  async getCurrentUsage(userId: string) {
    const usage = await this.getOrCreateUsage(userId);
    const sub = await this.subscriptions.getActiveSubscription(userId);
    const [totals, config, wallet, media] = await Promise.all([
      this.getAggregatedCallUsage(usage.id),
      this.config.get(),
      this.credits.getSummary(userId, sub.currentPeriodStart),
      this.entitlements.mediaCreditsUsed(
        userId,
        sub.currentPeriodStart ?? usage.billingCycleStart,
      ),
    ]);
    return {
      cycle: { start: usage.billingCycleStart, end: usage.billingCycleEnd },
      usage: {
        audioMinutes: totals.audioMinutes,
        videoMinutes: totals.videoMinutes,
        screenShareMinutes: totals.screenShareMinutes,
        participants: totals.participants,
        callsCreated: usage.callsCreated,
        callsCompleted: totals.callsCompleted,
      },
      credits: {
        audio: media.audioCredits,
        video: media.videoCredits,
        screenShare: media.screenShareCredits,
        total:
          media.audioCredits + media.videoCredits + media.screenShareCredits,
        charged: totals.creditsCharged,
      },
      creditRates: {
        audioCreditsPerMinute: config.audioCreditsPerMinute,
        videoCreditsPerMinute: config.videoCreditsPerMinute,
        screenShareCreditsPerMinute: config.screenShareCreditsPerMinute,
      },
      wallet,
      subscription: this.subscriptions.serialize(sub),
    };
  }

  /** Per-call usage + credits for the current period (newest first). */
  async getCallUsage(userId: string, pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(100, Number(process.env.PAGE_SIZE) || 10);
    const usage = await this.getOrCreateUsage(userId);
    const where = { usageId: usage.id };
    const [total, pageData] = await Promise.all([
      this.prisma.callUsage.count({ where }),
      this.prisma.callUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const callIds = pageData.map((c) => c.callId);
    const segmentsByCall = new Map<
      string,
      {
        callSeconds: number;
        audioSeconds: number;
        videoSeconds: number;
        screenShareSeconds: number;
      }
    >();
    if (callIds.length) {
      const segs = await this.prisma.usageSegment.findMany({
        where: { callId: { in: callIds } },
      });
      for (const seg of segs) {
        const entry = segmentsByCall.get(seg.callId) ?? {
          callSeconds: 0,
          audioSeconds: 0,
          videoSeconds: 0,
          screenShareSeconds: 0,
        };
        const seconds = Math.max(
          0,
          (seg.endedAt.getTime() - seg.startedAt.getTime()) / 1000,
        );
        // Wall-clock only (display context); credits come from the
        // per-participant minutes on the CallUsage row.
        entry.callSeconds += seconds;
        if (seg.audio) entry.audioSeconds += seconds;
        if (seg.video) entry.videoSeconds += seconds;
        if (seg.screenShare) entry.screenShareSeconds += seconds;
        segmentsByCall.set(seg.callId, entry);
      }
    }

    return {
      data: pageData
        .map((row) => omit(row, 'costPaise'))
        .map((call) => ({
          ...call,
          durationSeconds: segmentsByCall.get(call.callId) ?? {
            callSeconds: 0,
            audioSeconds: 0,
            videoSeconds: 0,
            screenShareSeconds: 0,
          },
        })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Usage per subscription period (newest first), including the current one. */
  async getUsageHistory(userId: string, pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where = { companyId: userId };
    const [total, data] = await Promise.all([
      this.prisma.usage.count({ where }),
      this.prisma.usage.findMany({
        where,
        orderBy: { billingCycleStart: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data: data.map((row) => omit(row, 'usageCostPaise')),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Admin: platform usage since a date (minutes, credits, internal cost). */
  async summarizeAdminUsage(since: Date) {
    const [aggregate, lineItems, creditsDebited] = await Promise.all([
      this.prisma.usage.aggregate({
        where: { billingCycleStart: { gte: since } },
        _sum: {
          audioMinutes: true,
          videoMinutes: true,
          screenShareMinutes: true,
          participants: true,
          usageCostPaise: true,
          callsCompleted: true,
        },
        _count: true,
      }),
      this.prisma.callUsage.aggregate({
        where: { createdAt: { gte: since } },
        _sum: {
          audioMinutes: true,
          videoMinutes: true,
          screenShareMinutes: true,
          participants: true,
          costPaise: true,
          creditsCharged: true,
        },
        _count: true,
      }),
      this.prisma.creditTransaction.aggregate({
        where: { type: 'USAGE_DEBIT', createdAt: { gte: since } },
        _sum: { amount: true },
      }),
    ]);
    const rates = await this.getRates();
    return {
      since,
      usage: {
        audioMinutes: aggregate._sum.audioMinutes ?? 0,
        videoMinutes: aggregate._sum.videoMinutes ?? 0,
        screenShareMinutes: aggregate._sum.screenShareMinutes ?? 0,
        participants: aggregate._sum.participants ?? 0,
        internalCostPaise: aggregate._sum.usageCostPaise ?? 0,
        callsCompleted: aggregate._sum.callsCompleted ?? 0,
        activeAccounts: aggregate._count,
      },
      lineItems: {
        audioMinutes: lineItems._sum.audioMinutes ?? 0,
        videoMinutes: lineItems._sum.videoMinutes ?? 0,
        screenShareMinutes: lineItems._sum.screenShareMinutes ?? 0,
        participants: lineItems._sum.participants ?? 0,
        internalCostPaise: lineItems._sum.costPaise ?? 0,
        creditsCharged: lineItems._sum.creditsCharged ?? 0,
        calls: lineItems._count,
      },
      creditsConsumed: -(creditsDebited._sum.amount ?? 0),
      internalRates: rates,
      currency: 'INR',
    };
  }

  /** Throws if a call is not owned by the user (helper for controllers). */
  async assertCallOwner(callId: string, userId: string) {
    const call = await this.prisma.call.findFirst({
      where: { id: callId, project: { ownerId: userId } },
      select: { id: true },
    });
    if (!call) throw new NotFoundException('Call not found');
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
