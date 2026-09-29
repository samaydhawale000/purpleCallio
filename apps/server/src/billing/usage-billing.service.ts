import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { CustomerDiscountService } from './customer-discount.service';
import { calculateDiscountPaise } from './discount.util';

export interface UsageSnapshot {
  audioMinutes: number;
  videoMinutes: number;
  screenShareMinutes: number;
  participants: number;
  callsCreated: number;
  callsCompleted: number;
}

export interface UsageCost {
  audioPaise: number;
  videoPaise: number;
  screenSharePaise: number;
  totalPaise: number;
}

export interface BillingRates {
  audioPaise: number;
  videoPaise: number;
  screenSharePaise: number;
  freeAudioMins: number;
  freeVideoMins: number;
  taxPercent: number;
}

/**
 * Usage-based, per-participant-minute billing engine (PurpleCallio v2).
 *
 * Rates:
 *  - Audio       ₹0.20 / participant-minute
 *  - Video       ₹0.80 / participant-minute
 *  - Screen share +₹0.10 / participant-minute (add-on to video)
 *
 * Developer Free Tier: 500 audio + 200 video participant-minutes / month.
 * Screen sharing is always billable (no free allowance).
 *
 * Rates + free allowances are stored in the `BillingRate` table so admins
 * can edit them from the admin portal.
 */
@Injectable()
export class UsageBillingService {
  private readonly logger = new Logger(UsageBillingService.name);

  constructor(
    private prisma: PrismaService,
    private billingService: BillingService,
    private customerDiscounts: CustomerDiscountService,
  ) {}

  /** Fetch the default billing rates (fall back to defaults if not seeded). */
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

  /** Compute the cost (in paise) for a usage snapshot at the current rates. */
  async computeCost(snapshot: UsageSnapshot): Promise<UsageCost> {
    const rates = await this.getRates();
    const audioPaise = snapshot.audioMinutes * rates.audioPaise;
    const videoPaise = snapshot.videoMinutes * rates.videoPaise;
    const screenSharePaise =
      snapshot.screenShareMinutes * rates.screenSharePaise;
    return {
      audioPaise,
      videoPaise,
      screenSharePaise,
      totalPaise: audioPaise + videoPaise + screenSharePaise,
    };
  }

  /**
   * Get (or create) the current usage record for a user, keyed to their
   * subscription's own anchored billing cycle (currentPeriodStart/End) —
   * NOT the calendar month. This is the single source of truth for "the
   * current cycle" so this service and the legacy subscription-anchored
   * code (BillingService, BillingJobsService) always write to the same
   * Usage row. Creates a free subscription if the user has none yet,
   * instead of hand-rolling cycle math here.
   */
  async getOrCreateUsage(userId: string) {
    const sub = await this.getOrCreateSubscriptionForUsage(userId);
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

    return this.prisma.usage.create({
      data: {
        companyId: userId,
        subscriptionId: sub.id,
        billingCycleStart: cycleStart,
        billingCycleEnd: cycleEnd,
        minutesUsed: 0,
        minutesPurchased: 0,
        callsCreated: 0,
        callsCompleted: 0,
        participants: 0,
        apiRequests: 0,
        audioMinutes: 0,
        videoMinutes: 0,
        screenShareMinutes: 0,
        usageCostPaise: 0,
      },
    });
  }

  /**
   * Resolve the subscription whose currentPeriodStart/End defines "the
   * current cycle" for this user, creating a free one via BillingService's
   * single subscription-creation path if none exists yet — so there is
   * exactly one place a Subscription row is ever created.
   */
  private async getOrCreateSubscriptionForUsage(userId: string) {
    return this.billingService.getOrCreateFreeSubscription(userId);
  }

  /**
   * Record a completed call's usage and write a per-call line item.
   *
   * @param userId   owner of the project the call belongs to
   * @param callId   the call id
   * @param data     minutes + participants per media type
   */
  /**
   * Records a completed call's usage exactly once. Callers (CallService.
   * endCall) are expected to have already claimed an atomic status
   * transition so this only runs once per call in practice; this existence
   * check is a second layer so a duplicate call here (e.g. a retried job)
   * is a no-op rather than double-billing. NOTE: this check-then-act is not
   * itself race-proof — the durable fix is a DB unique constraint on
   * CallUsage.callId (see schema.prisma TODO), blocked for now by
   * pre-existing duplicate rows that need manual cleanup first.
   *
   * Minutes are kept as fractional participant-minutes (not rounded) so
   * free-allowance exhaustion and cumulative billing stay accurate; round
   * only when displaying to users.
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

    const existing = await this.prisma.callUsage.findFirst({ where: { callId } });
    if (existing) {
      this.logger.warn(
        `Usage for call ${callId} was already recorded — skipping duplicate billing.`,
      );
      return usage;
    }

    const cost = await this.computeCost({
      audioMinutes: data.audioMinutes,
      videoMinutes: data.videoMinutes,
      screenShareMinutes: data.screenShareMinutes,
      participants: data.participants,
      callsCreated: 0,
      callsCompleted: 1,
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.usage.update({
        where: { id: usage.id },
        data: {
          audioMinutes: { increment: data.audioMinutes },
          videoMinutes: { increment: data.videoMinutes },
          screenShareMinutes: { increment: data.screenShareMinutes },
          participants: { increment: data.participants },
          callsCompleted: { increment: 1 },
          usageCostPaise: { increment: cost.totalPaise },
        },
      }),
      this.prisma.callUsage.create({
        data: {
          usageId: usage.id,
          callId,
          audioMinutes: data.audioMinutes,
          videoMinutes: data.videoMinutes,
          screenShareMinutes: data.screenShareMinutes,
          participants: data.participants,
          costPaise: cost.totalPaise,
          startedAt: data.startedAt ?? null,
          endedAt: data.endedAt ?? new Date(),
        },
      }),
    ]);

    this.logger.log(
      `Recorded call ${callId} for user ${userId}: ${data.audioMinutes}a/${data.videoMinutes}v/${data.screenShareMinutes}ss mins, ${cost.totalPaise} paise`,
    );
    return updated;
  }

  private async getAggregatedCallUsage(usageId: string) {
    const agg = await this.prisma.callUsage.aggregate({
      where: { usageId },
      _sum: {
        audioMinutes: true,
        videoMinutes: true,
        screenShareMinutes: true,
        participants: true,
      },
      _count: true,
    });
    return {
      audioMinutes: agg._sum.audioMinutes ?? 0,
      videoMinutes: agg._sum.videoMinutes ?? 0,
      screenShareMinutes: agg._sum.screenShareMinutes ?? 0,
      participants: agg._sum.participants ?? 0,
      callsCompleted: agg._count,
    };
  }

  /**
   * Current usage + cost for the user's current cycle.
   */
  async getCurrentUsage(userId: string) {
    const usage = await this.getOrCreateUsage(userId);
    const rates = await this.getRates();
    const totals = await this.getAggregatedCallUsage(usage.id);
    const cost = await this.computeCost({
      audioMinutes: totals.audioMinutes,
      videoMinutes: totals.videoMinutes,
      screenShareMinutes: totals.screenShareMinutes,
      participants: totals.participants,
      callsCreated: usage.callsCreated,
      callsCompleted: totals.callsCompleted,
    });

    // Free-tier + payment-method status so the UI can decide whether to show
    // costs and when to prompt the user to add a card.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { razorpayTokenId: true },
    });
    const hasPaymentMethod = !!user?.razorpayTokenId;
    const isFreeTier = !hasPaymentMethod;

    // Free-allowance usage percentage (max of audio/video) for the 90% warning.
    const audioPct = rates.freeAudioMins > 0
      ? Math.round((totals.audioMinutes / rates.freeAudioMins) * 100)
      : 0;
    const videoPct = rates.freeVideoMins > 0
      ? Math.round((totals.videoMinutes / rates.freeVideoMins) * 100)
      : 0;
    const freeUsagePercent = Math.max(audioPct, videoPct);

    // Free allowance only covers audio + video (screen share always paid).
    const billableAudio = Math.max(
      0,
      totals.audioMinutes - rates.freeAudioMins,
    );
    const billableVideo = Math.max(
      0,
      totals.videoMinutes - rates.freeVideoMins,
    );
    // Screen share is always billable.
    const billableScreenShare = totals.screenShareMinutes;

    const billableCostAudio = billableAudio * rates.audioPaise;
    const billableCostVideo = billableVideo * rates.videoPaise;
    const billableCostScreenShare =
      billableScreenShare * rates.screenSharePaise;
    const billableTotal = billableCostAudio + billableCostVideo + billableCostScreenShare;

    // Estimate end-of-month based on elapsed days in the cycle.
    const start = usage.billingCycleStart.getTime();
    const now = Date.now();
    const elapsedDays = Math.max(1, (now - start) / 86400000);
    const daysInMonth = Math.max(
      1,
      (usage.billingCycleEnd.getTime() - start) / 86400000,
    );
    const projectedPaise = Math.round(
      (billableTotal / elapsedDays) * daysInMonth,
    );

    return {
      cycle: {
        start: usage.billingCycleStart,
        end: usage.billingCycleEnd,
      },
      usage: {
        audioMinutes: totals.audioMinutes,
        videoMinutes: totals.videoMinutes,
        screenShareMinutes: totals.screenShareMinutes,
        participants: totals.participants,
        callsCreated: usage.callsCreated,
        callsCompleted: totals.callsCompleted,
      },
      freeAllowance: {
        audioMinutes: rates.freeAudioMins,
        videoMinutes: rates.freeVideoMins,
      },
      rates: {
        audioPaise: rates.audioPaise,
        videoPaise: rates.videoPaise,
        screenSharePaise: rates.screenSharePaise,
      },
cost: {
        audioPaise: billableCostAudio,
        videoPaise: billableCostVideo,
        screenSharePaise: billableCostScreenShare,
        totalPaise: billableTotal,
      },
      estimatedMonthEndPaise: projectedPaise,
      nextBillingDate: new Date(usage.billingCycleEnd.getTime() + 1),
      // Flags for the UI: free-tier status, card presence, free-usage %.
      isFreeTier,
      hasPaymentMethod,
      freeUsagePercent,
    };
  }

  /**
   * Per-call line items for a user's current cycle (call analytics).
   */
  async getCallUsage(userId: string, pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Number(process.env.PAGE_SIZE) || 10,
    );
    const usage = await this.getOrCreateUsage(userId);
    const rates = await this.getRates();
    // Apply the monthly audio/video allowance to calls in the order they
    // occurred. `CallUsage.costPaise` is the raw rated amount retained for
    // internal analytics; customers must see the amount actually chargeable
    // after their free allowance has been consumed.
    let remainingAudioMinutes = rates.freeAudioMins;
    let remainingVideoMinutes = rates.freeVideoMins;

    const calls = await this.prisma.callUsage.findMany({
      where: { usageId: usage.id },
      orderBy: { createdAt: 'asc' },
    });

    const ratedCalls = calls
      .map((call) => {
        const billableAudioMinutes = Math.max(
          0,
          call.audioMinutes - remainingAudioMinutes,
        );
        const billableVideoMinutes = Math.max(
          0,
          call.videoMinutes - remainingVideoMinutes,
        );

        remainingAudioMinutes = Math.max(
          0,
          remainingAudioMinutes - call.audioMinutes,
        );
        remainingVideoMinutes = Math.max(
          0,
          remainingVideoMinutes - call.videoMinutes,
        );

        // Screen sharing has no free allowance; it is an add-on to video.
        const billedCostPaise = Math.round(
          billableAudioMinutes * rates.audioPaise +
            billableVideoMinutes * rates.videoPaise +
            call.screenShareMinutes * rates.screenSharePaise,
        );

        return {
          ...call,
          billedCostPaise,
          billableAudioMinutes,
          billableVideoMinutes,
        };
      })
      .reverse();

    const total = ratedCalls.length;
    const pageData = ratedCalls.slice((page - 1) * pageSize, page * pageSize);

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
        // Wall-clock only (display context). Billable usage is the
        // per-participant audioMinutes/videoMinutes/screenShareMinutes on
        // the CallUsage row itself — never derive it from these seconds.
        entry.callSeconds += seconds;
        if (seg.audio) entry.audioSeconds += seconds;
        if (seg.video) entry.videoSeconds += seconds;
        if (seg.screenShare) entry.screenShareSeconds += seconds;
        segmentsByCall.set(seg.callId, entry);
      }
    }

    return {
      data: pageData.map((call) => ({
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

  /**
   * Paginated history of a user's past billing cycles' usage (newest
   * first), including the still-open current cycle. Each row is one
   * anchored cycle now that Usage is keyed to Subscription.currentPeriod*
   * rather than the calendar month.
   */
  async getUsageHistory(userId: string, pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(process.env.PAGE_SIZE) || 10));
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

    const now = Date.now();
    const rates = await this.getRates();
    const withCurrentRecomputed = await Promise.all(
      data.map(async (row) => {
        if (row.billingCycleEnd.getTime() > now) {
          const totals = await this.getAggregatedCallUsage(row.id);
          const billableVideo = Math.max(0, totals.videoMinutes - rates.freeVideoMins);
          const billableAudio = Math.max(0, totals.audioMinutes - rates.freeAudioMins);
          return {
            ...row,
            audioMinutes: totals.audioMinutes,
            videoMinutes: totals.videoMinutes,
            screenShareMinutes: totals.screenShareMinutes,
            participants: totals.participants,
            callsCompleted: totals.callsCompleted,
            usageCostPaise:
              billableAudio * rates.audioPaise +
              billableVideo * rates.videoPaise +
              totals.screenShareMinutes * rates.screenSharePaise,
          };
        }
        return row;
      }),
    );

    return { data: withCurrentRecomputed, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * Whether the user can still start a new AUDIO/VIDEO call under the free
   * allowance. Screen-share is always allowed (billable). Returns remaining
   * free minutes so the caller can decide.
   */
  async getFreeAllowanceStatus(userId: string) {
    const usage = await this.getOrCreateUsage(userId);
    const rates = await this.getRates();
    const totals = await this.getAggregatedCallUsage(usage.id);
    return {
      audioRemaining: Math.max(0, rates.freeAudioMins - totals.audioMinutes),
      videoRemaining: Math.max(0, rates.freeVideoMins - totals.videoMinutes),
      audioExhausted: totals.audioMinutes >= rates.freeAudioMins,
      videoExhausted: totals.videoMinutes >= rates.freeVideoMins,
    };
  }

  /**
   * Whether the project owner has a billing relationship that can cover
   * paid usage once the free allowance runs out: a saved Razorpay card, or
   * (legacy) an active subscription.
   */
  async hasPaymentMethod(ownerId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findFirst({
      where: { companyId: ownerId },
      orderBy: { createdAt: 'desc' },
    });
    if (sub && sub.status === 'ACTIVE') return true;

    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { razorpayCustomerId: true, razorpayTokenId: true },
    });
    return !!user?.razorpayCustomerId && !!user?.razorpayTokenId;
  }

  /**
   * The single source of truth for "can this project owner start a new call
   * of this type right now": free allowance first, then a saved payment
   * method for paid usage. Screen-share is always allowed (always billable,
   * no free allowance). Used by both BillingGuard (HTTP calls) and
   * CallService (calls started outside the guarded HTTP path, e.g. the
   * playground) so the two never diverge.
   */
  async canStartCall(
    ownerId: string,
    type: 'AUDIO' | 'VIDEO',
  ): Promise<{ allowed: boolean; reason?: string }> {
    const status = await this.getFreeAllowanceStatus(ownerId);
    const exhausted = type === 'AUDIO' ? status.audioExhausted : status.videoExhausted;
    if (!exhausted) return { allowed: true };

    if (!(await this.hasPaymentMethod(ownerId))) {
      return {
        allowed: false,
        reason: `Your free ${type.toLowerCase()} allowance is used up. Add a payment method to continue making calls.`,
      };
    }

    // Paid usage from here on — enforce the customer's own spending cap (if
    // they set one). Protects both them (a leaked API key running up a
    // surprise bill) and us (unbounded exposure if a card later fails).
    return this.checkSpendingLimit(ownerId);
  }

  /**
   * Whether the owner's current-cycle billed cost is still under their
   * self-set monthly spending cap. No cap set → always allowed.
   *
   * Compared net of any active customer discount (not the raw billable
   * cost): the spending limit exists to protect the customer from a
   * surprise bill and cap PurpleCallio's exposure to unpaid usage — both of
   * those are about the amount that will actually be charged, so a
   * discounted customer's cap reflects their real, lower cost rather than
   * the pre-discount rate card. This does NOT include tax, matching the
   * pre-discount behavior this replaces (which also compared a pre-tax
   * figure) — only the discount adjustment was added.
   */
  async checkSpendingLimit(
    ownerId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { spendingLimitPaise: true },
    });
    if (!user?.spendingLimitPaise) return { allowed: true };

    const current = await this.getCurrentUsage(ownerId);
    const discount = await this.customerDiscounts.getActiveDiscount(ownerId);
    const discountPaise = calculateDiscountPaise(
      current.cost.totalPaise,
      discount?.percentage,
    );
    const netPaise = current.cost.totalPaise - discountPaise;

    if (netPaise >= user.spendingLimitPaise) {
      return {
        allowed: false,
        reason: `You've reached your monthly spending limit of ₹${(user.spendingLimitPaise / 100).toFixed(2)}. Raise or remove it in Billing settings to continue making calls.`,
      };
    }
    return { allowed: true };
  }

  /** Get the customer's self-set monthly spending cap (paise), if any. */
  async getSpendingLimit(userId: string): Promise<{ spendingLimitPaise: number | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { spendingLimitPaise: true },
    });
    return { spendingLimitPaise: user?.spendingLimitPaise ?? null };
  }

  /** Set (or clear, with null) the customer's monthly spending cap (paise). */
  async setSpendingLimit(
    userId: string,
    spendingLimitPaise: number | null,
  ): Promise<{ spendingLimitPaise: number | null }> {
    if (spendingLimitPaise != null && (!Number.isFinite(spendingLimitPaise) || spendingLimitPaise < 0)) {
      throw new BadRequestException('spendingLimitPaise must be a non-negative number or null.');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { spendingLimitPaise },
      select: { spendingLimitPaise: true },
    });
    return { spendingLimitPaise: updated.spendingLimitPaise };
  }

/**
   * Admin: aggregate usage across all users since a given date.
   * Sums per-media-type minutes + cost for all Usage rows in the window.
   */
  async summarizeAdminUsage(since: Date) {
    const [aggregate, lineItems] = await Promise.all([
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
        },
        _count: true,
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
        estimatedCostPaise: aggregate._sum.usageCostPaise ?? 0,
        callsCompleted: aggregate._sum.callsCompleted ?? 0,
        activeAccounts: aggregate._count,
      },
      lineItems: {
        audioMinutes: lineItems._sum.audioMinutes ?? 0,
        videoMinutes: lineItems._sum.videoMinutes ?? 0,
        screenShareMinutes: lineItems._sum.screenShareMinutes ?? 0,
        participants: lineItems._sum.participants ?? 0,
        costPaise: lineItems._sum.costPaise ?? 0,
        calls: lineItems._count,
      },
      rates,
      currency: 'INR',
    };
  }

  /** Update billing rates (admin). */
  async updateRates(data: Partial<BillingRates>) {
    const existing = await this.prisma.billingRate.findUnique({
      where: { key: 'default' },
    });
    if (!existing) {
      throw new NotFoundException('Billing rate not found. Run the seed.');
    }
    return this.prisma.billingRate.update({
      where: { id: existing.id },
      data: {
        ...(data.audioPaise !== undefined && { audioPaise: data.audioPaise }),
        ...(data.videoPaise !== undefined && { videoPaise: data.videoPaise }),
        ...(data.screenSharePaise !== undefined && {
          screenSharePaise: data.screenSharePaise,
        }),
        ...(data.freeAudioMins !== undefined && {
          freeAudioMins: data.freeAudioMins,
        }),
        ...(data.freeVideoMins !== undefined && {
          freeVideoMins: data.freeVideoMins,
        }),
        ...(data.taxPercent !== undefined && { taxPercent: data.taxPercent }),
      },
    });
  }
}
