import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingStatus,
  CreditBucketSource,
  CreditTransactionType,
  Payment,
  PlanStatus,
  PlanType,
  PlanVersion,
  Prisma,
  Subscription,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditService } from '../credits/credit.service';
import { PlanService, PlanWithVersion } from '../plans/plan.service';
import { BillingAuditService } from '../billing-audit.service';
import { BillingNotificationService } from '../billing-notification.service';
import { addBillingInterval } from './period.util';

type Tx = Prisma.TransactionClient;
type PostCommit = (() => Promise<unknown>)[];

export interface EntitlementsSnapshot {
  features: string[];
  /** Optional per-media caps within the plan's credits (null = no cap). */
  mediaCredits: {
    audio: number | null;
    video: number | null;
    screenShare: number | null;
  };
}

export function entitlementsFromVersion(v: PlanVersion): EntitlementsSnapshot {
  return {
    features: v.features,
    mediaCredits: {
      audio: v.includedAudioCredits,
      video: v.includedVideoCredits,
      screenShare: v.includedScreenShareCredits,
    },
  };
}

/** Snapshot of a plan version's terms onto a Subscription row. */
export function snapshotData(
  plan: { id: string; name: string; type: PlanType },
  v: PlanVersion,
) {
  return {
    planId: plan.id,
    planVersionId: v.id,
    planName: plan.name,
    planType: plan.type,
    pricePaise: v.pricePaise,
    currency: v.currency,
    includedCredits: v.includedCredits,
    billingInterval: v.billingInterval,
    intervalCount: v.intervalCount,
    entitlementsSnapshot: entitlementsFromVersion(
      v,
    ) as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Subscription lifecycle for prepaid billing.
 *
 *  - Every customer always has exactly one ACTIVE subscription; with
 *    nothing paid it is the Free plan.
 *  - Free credits refresh each month (re-snapshotting the current Free
 *    plan, so admin changes to the Free allowance apply from the next month).
 *  - A paid period that ends without a renewal payment becomes EXPIRED (or
 *    CANCELED if the customer cancelled) and the customer falls back to
 *    Free. Nothing is ever charged automatically.
 *  - Paid activation/renewal only happens from BillingFulfillmentService,
 *    after the provider payment is verified.
 *
 * Every state change runs under the customer's wallet lock
 * (CreditService.withWallet), so it serializes with credit debits/grants.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private prisma: PrismaService,
    private credits: CreditService,
    private plans: PlanService,
    private audit: BillingAuditService,
    private notify: BillingNotificationService,
  ) {}

  // ── Current subscription ─────────────────────────────────
  /**
   * The customer's ACTIVE subscription, rolled forward to the current
   * period with its credits allocated. Fast path is a single read; the
   * locked slow path runs only when something needs creating/rolling.
   */
  async getActiveSubscription(userId: string): Promise<Subscription> {
    const now = new Date();
    const sub = await this.prisma.subscription.findFirst({
      where: { companyId: userId, status: BillingStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    if (
      sub &&
      sub.planId &&
      sub.currentPeriodStart &&
      sub.currentPeriodEnd &&
      sub.currentPeriodEnd > now
    ) {
      if (sub.includedCredits <= 0) return sub;
      const allocated = await this.prisma.creditTransaction.findUnique({
        where: { idempotencyKey: this.allocationKey(sub) },
        select: { id: true },
      });
      if (allocated) return sub;
    }

    const postCommit: PostCommit = [];
    const result = await this.credits.withWallet(userId, (tx) =>
      this.ensureCurrentLocked(tx, userId, postCommit),
    );
    await this.flush(postCommit);
    return result;
  }

  /** Same as getActiveSubscription, for callers already holding the lock. */
  async ensureCurrentLocked(
    tx: Tx,
    userId: string,
    postCommit: PostCommit,
    now = new Date(),
  ): Promise<Subscription> {
    let sub = await tx.subscription.findFirst({
      where: { companyId: userId, status: BillingStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });

    // Legacy pay-as-you-go anchor rows (no plan yet) → Free plan, keeping
    // their current period. See LegacyBillingMigrationService.
    if (sub && !sub.planId) {
      const free = await this.plans.getDefaultFreePlan(tx);
      sub = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          ...snapshotData(free, free.currentVersion),
          migrationSource: sub.migrationSource ?? 'legacy_payg',
          activatedAt: sub.activatedAt ?? sub.createdAt,
          currentPeriodStart: sub.currentPeriodStart ?? now,
          currentPeriodEnd:
            sub.currentPeriodEnd ?? addBillingInterval(now, 'MONTH'),
        },
      });
    }

    if (!sub) {
      sub = await this.createFreeSubscription(tx, userId, now);
    } else if (!sub.currentPeriodEnd || sub.currentPeriodEnd <= now) {
      sub = await this.rollover(tx, sub, now, postCommit);
    }

    await this.ensureAllocation(tx, sub);
    return sub;
  }

  private async createFreeSubscription(
    tx: Tx,
    userId: string,
    start: Date,
    previous?: Subscription,
  ) {
    const free = await this.plans.getDefaultFreePlan(tx);
    return tx.subscription.create({
      data: {
        companyId: userId,
        status: BillingStatus.ACTIVE,
        ...snapshotData(free, free.currentVersion),
        currentPeriodStart: start,
        currentPeriodEnd: addBillingInterval(start, 'MONTH'),
        billingAnchorDay: start.getDate(),
        activatedAt: start,
        previousSubscriptionId: previous?.id ?? null,
      },
    });
  }

  /** The current period has ended: refresh Free, or end a paid period. */
  private async rollover(
    tx: Tx,
    sub: Subscription,
    now: Date,
    postCommit: PostCommit,
  ): Promise<Subscription> {
    if (sub.planType === PlanType.FREE) {
      const free = await this.plans.getDefaultFreePlan(tx);
      const anchor =
        sub.billingAnchorDay ?? (sub.currentPeriodStart ?? now).getDate();
      let start = sub.currentPeriodEnd ?? now;
      let end = addBillingInterval(start, 'MONTH', 1, anchor);
      // Skip whole months nobody used rather than allocating each of them.
      for (let i = 0; end <= now && i < 600; i++) {
        start = end;
        end = addBillingInterval(start, 'MONTH', 1, anchor);
      }
      if (end <= now) {
        start = now;
        end = addBillingInterval(now, 'MONTH');
      }
      const claimed = await tx.subscription.updateMany({
        where: {
          id: sub.id,
          status: BillingStatus.ACTIVE,
          currentPeriodEnd: sub.currentPeriodEnd,
        },
        data: {
          ...snapshotData(free, free.currentVersion),
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
      });
      return claimed.count
        ? tx.subscription.findUniqueOrThrow({ where: { id: sub.id } })
        : sub;
    }

    // Paid / custom period ended without renewal.
    const endedAt = sub.currentPeriodEnd ?? now;
    const status = sub.cancelAtPeriodEnd
      ? BillingStatus.CANCELED
      : BillingStatus.EXPIRED;
    const claimed = await tx.subscription.updateMany({
      where: { id: sub.id, status: BillingStatus.ACTIVE },
      data: {
        status,
        ...(status === BillingStatus.CANCELED
          ? { canceledAt: endedAt }
          : { expiredAt: endedAt }),
      },
    });
    if (!claimed.count) {
      return (await tx.subscription.findFirst({
        where: { companyId: sub.companyId, status: BillingStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
      }))!;
    }
    const free = await this.createFreeSubscription(tx, sub.companyId, now, sub);
    await this.audit.log(
      {
        action: 'SUBSCRIPTION_EXPIRED',
        actorId: sub.companyId,
        entity: 'Subscription',
        entityId: sub.id,
        oldValue: { status: 'ACTIVE', plan: sub.planName },
        newValue: {
          status,
          fallbackSubscriptionId: free.id,
          scheduledPlanId: sub.scheduledPlanId,
        },
      },
      tx,
    );
    postCommit.push(() =>
      this.notify.planEnded(sub, status === BillingStatus.CANCELED),
    );
    return free;
  }

  allocationKey(sub: Pick<Subscription, 'id' | 'currentPeriodStart'>) {
    return `alloc:${sub.id}:${(sub.currentPeriodStart ?? new Date(0)).toISOString()}`;
  }

  /** Grant the current period's included credits (idempotent per period). */
  private async ensureAllocation(tx: Tx, sub: Subscription) {
    if (
      sub.includedCredits <= 0 ||
      !sub.currentPeriodStart ||
      !sub.currentPeriodEnd
    )
      return;
    await this.credits.grant(
      {
        userId: sub.companyId,
        amount: sub.includedCredits,
        type: CreditTransactionType.SUBSCRIPTION_ALLOCATION,
        source: CreditBucketSource.SUBSCRIPTION,
        expiresAt: sub.currentPeriodEnd,
        subscriptionId: sub.id,
        referenceType: 'Subscription',
        referenceId: sub.id,
        idempotencyKey: this.allocationKey(sub),
        metadata: {
          plan: sub.planName,
          periodStart: sub.currentPeriodStart.toISOString(),
          periodEnd: sub.currentPeriodEnd.toISOString(),
        },
      },
      tx,
    );
  }

  // ── Activation / renewal (called by fulfillment, lock held) ───
  /**
   * PENDING_PAYMENT → ACTIVE after a verified payment. Replaces the
   * customer's previous ACTIVE subscription (its remaining credits stay
   * usable until their own expiry — an upgrade never forfeits paid credits).
   */
  async activatePending(
    tx: Tx,
    pendingId: string,
    payment: Payment,
    postCommit: PostCommit,
    now = new Date(),
  ) {
    const pending = await tx.subscription.findUnique({
      where: { id: pendingId },
    });
    if (!pending) throw new NotFoundException('Subscription not found');
    if (pending.status === BillingStatus.ACTIVE) return pending;

    const current = await tx.subscription.findFirst({
      where: {
        companyId: pending.companyId,
        status: BillingStatus.ACTIVE,
        id: { not: pending.id },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (current) {
      await tx.subscription.update({
        where: { id: current.id },
        data: {
          status: BillingStatus.CANCELED,
          canceledAt: now,
          replacedBySubscriptionId: pending.id,
        },
      });
    }

    const end = addBillingInterval(
      now,
      pending.billingInterval ?? 'MONTH',
      pending.intervalCount,
    );
    const activated = await tx.subscription.update({
      where: { id: pending.id },
      data: {
        status: BillingStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        billingAnchorDay: now.getDate(),
        activatedAt: now,
        previousSubscriptionId: current?.id ?? null,
      },
    });
    await this.ensureAllocation(tx, activated);
    await this.audit.log(
      {
        action: 'SUBSCRIPTION_ACTIVATED',
        actorId: activated.companyId,
        entity: 'Subscription',
        entityId: activated.id,
        oldValue: current
          ? { subscriptionId: current.id, plan: current.planName }
          : null,
        newValue: {
          plan: activated.planName,
          pricePaise: activated.pricePaise,
          includedCredits: activated.includedCredits,
          periodEnd: end,
        },
        extra: { paymentId: payment.id },
      },
      tx,
    );
    postCommit.push(() => this.notify.planActivated(activated));
    return activated;
  }

  /**
   * Extends an ACTIVE subscription by one period from its current end and
   * grants the new period's credits now (expiring at the new end). The
   * renewal is billed at — and snapshots — the plan's current version.
   */
  async extendForRenewal(
    tx: Tx,
    subscriptionId: string,
    payment: Payment,
    postCommit: PostCommit,
  ) {
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== BillingStatus.ACTIVE || !sub.currentPeriodEnd) {
      throw new BadRequestException(
        'Only an active subscription can be extended.',
      );
    }
    const version = payment.planVersionId
      ? await tx.planVersion.findUnique({
          where: { id: payment.planVersionId },
          include: { plan: true },
        })
      : null;
    const newEnd = addBillingInterval(
      sub.currentPeriodEnd,
      version?.billingInterval ?? sub.billingInterval ?? 'MONTH',
      version?.intervalCount ?? sub.intervalCount,
      sub.billingAnchorDay ?? sub.currentPeriodEnd.getDate(),
    );
    const updated = await tx.subscription.update({
      where: { id: sub.id },
      data: {
        ...(version ? snapshotData(version.plan, version) : {}),
        currentPeriodEnd: newEnd,
        cancelAtPeriodEnd: false,
        scheduledPlanId: null,
      },
    });
    const credits = version?.includedCredits ?? sub.includedCredits;
    if (credits > 0) {
      await this.credits.grant(
        {
          userId: sub.companyId,
          amount: credits,
          type: CreditTransactionType.SUBSCRIPTION_ALLOCATION,
          source: CreditBucketSource.SUBSCRIPTION,
          expiresAt: newEnd,
          subscriptionId: sub.id,
          referenceType: 'Payment',
          referenceId: payment.id,
          idempotencyKey: `alloc:${sub.id}:renewal:${payment.id}`,
          metadata: {
            plan: updated.planName,
            renewal: true,
            periodEnd: newEnd.toISOString(),
          },
        },
        tx,
      );
    }
    await this.audit.log(
      {
        action: 'SUBSCRIPTION_RENEWED',
        actorId: sub.companyId,
        entity: 'Subscription',
        entityId: sub.id,
        oldValue: { periodEnd: sub.currentPeriodEnd },
        newValue: { periodEnd: newEnd, credits },
        extra: { paymentId: payment.id },
      },
      tx,
    );
    postCommit.push(() => this.notify.planRenewed(updated, credits));
    return updated;
  }

  // ── Customer actions ─────────────────────────────────────
  /** Cancel at period end — the plan stays active (and paid-for) until then. */
  async cancel(userId: string) {
    const sub = await this.getActiveSubscription(userId);
    if (sub.planType === PlanType.FREE)
      throw new BadRequestException('The Free plan cannot be cancelled.');
    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, scheduledPlanId: null },
    });
    await this.audit.log({
      action: 'SUBSCRIPTION_CANCELED',
      actorId: userId,
      entity: 'Subscription',
      entityId: sub.id,
      newValue: { cancelAtPeriodEnd: true, activeUntil: sub.currentPeriodEnd },
    });
    return updated;
  }

  /** Undo a pending cancellation or scheduled downgrade. */
  async resume(userId: string) {
    const sub = await this.getActiveSubscription(userId);
    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: false, scheduledPlanId: null },
    });
    await this.audit.log({
      action: 'SUBSCRIPTION_RESUMED',
      actorId: userId,
      entity: 'Subscription',
      entityId: sub.id,
      newValue: { cancelAtPeriodEnd: false, scheduledPlanId: null },
    });
    return updated;
  }

  /**
   * Downgrades take effect at the end of the paid period: the current plan
   * keeps all its entitlements until then. Moving to Free just lets the
   * plan end; moving to a cheaper paid plan makes that plan the renewal
   * offer (the customer pays for it when the period ends).
   */
  async scheduleDowngrade(userId: string, planId: string) {
    const sub = await this.getActiveSubscription(userId);
    if (sub.planType === PlanType.FREE)
      throw new BadRequestException('You are already on the Free plan.');
    const target = await this.plans.getPlan(planId);
    if (target.status !== PlanStatus.ACTIVE || !target.currentVersion) {
      throw new BadRequestException('That plan is not available.');
    }
    if (target.type === PlanType.CUSTOM && target.assignedUserId !== userId) {
      throw new BadRequestException('That plan is not available.');
    }
    if (target.id === sub.planId)
      throw new BadRequestException('You are already on this plan.');
    if (
      target.type !== PlanType.FREE &&
      target.currentVersion.pricePaise >= sub.pricePaise
    ) {
      throw new BadRequestException(
        'That plan costs the same or more — upgrade instead.',
      );
    }
    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        scheduledPlanId: target.id,
        cancelAtPeriodEnd: target.type === PlanType.FREE,
      },
    });
    await this.audit.log({
      action: 'SUBSCRIPTION_DOWNGRADE_SCHEDULED',
      actorId: userId,
      entity: 'Subscription',
      entityId: sub.id,
      oldValue: { plan: sub.planName },
      newValue: {
        scheduledPlan: target.name,
        effectiveAt: sub.currentPeriodEnd,
      },
    });
    return updated;
  }

  // ── Reads ─────────────────────────────────────────────────
  /** Dashboard view of the current subscription. */
  async getOverview(userId: string) {
    const sub = await this.getActiveSubscription(userId);
    const [plan, scheduledPlan, lastEnded, pending] = await Promise.all([
      sub.planId
        ? this.prisma.plan.findUnique({
            where: { id: sub.planId },
            include: { currentVersion: true },
          })
        : null,
      sub.scheduledPlanId
        ? this.prisma.plan.findUnique({
            where: { id: sub.scheduledPlanId },
            include: { currentVersion: true },
          })
        : null,
      this.prisma.subscription.findFirst({
        where: {
          companyId: userId,
          status: { in: [BillingStatus.EXPIRED, BillingStatus.CANCELED] },
          planType: { not: PlanType.FREE },
          replacedBySubscriptionId: null,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.subscription.findFirst({
        where: { companyId: userId, status: BillingStatus.PENDING_PAYMENT },
        orderBy: { createdAt: 'desc' },
        select: { id: true, planName: true, createdAt: true },
      }),
    ]);
    return {
      subscription: this.serialize(sub),
      plan: plan
        ? {
            id: plan.id,
            slug: plan.slug,
            name: plan.name,
            type: plan.type,
            status: plan.status,
            currentVersionId: plan.currentVersionId,
          }
        : null,
      // Renewal is priced from the plan's current version (shown at checkout).
      renewal:
        plan &&
        plan.status === PlanStatus.ACTIVE &&
        plan.currentVersion &&
        sub.planType !== PlanType.FREE
          ? {
              planId: plan.id,
              pricePaise: plan.currentVersion.pricePaise,
              includedCredits: plan.currentVersion.includedCredits,
              termsChanged: plan.currentVersionId !== sub.planVersionId,
            }
          : null,
      scheduledPlan: scheduledPlan
        ? {
            id: scheduledPlan.id,
            name: scheduledPlan.name,
            type: scheduledPlan.type,
            pricePaise: scheduledPlan.currentVersion?.pricePaise ?? 0,
          }
        : null,
      // A paid plan that recently ended — the dashboard offers "Renew".
      lastEndedPaidSubscription:
        sub.planType === PlanType.FREE &&
        lastEnded &&
        lastEnded.updatedAt > new Date(Date.now() - 60 * 86_400_000)
          ? this.serialize(lastEnded)
          : null,
      pendingCheckout: pending,
    };
  }

  serialize(sub: Subscription) {
    return {
      id: sub.id,
      status: sub.status,
      planId: sub.planId,
      planVersionId: sub.planVersionId,
      planName: sub.planName,
      planType: sub.planType,
      pricePaise: sub.pricePaise,
      currency: sub.currency,
      includedCredits: sub.includedCredits,
      billingInterval: sub.billingInterval,
      intervalCount: sub.intervalCount,
      entitlements: sub.entitlementsSnapshot,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      scheduledPlanId: sub.scheduledPlanId,
      activatedAt: sub.activatedAt,
      expiredAt: sub.expiredAt,
      canceledAt: sub.canceledAt,
      migrationSource: sub.migrationSource,
    };
  }

  /** Admin list of subscriptions (filterable by status / plan / customer). */
  async listForAdmin(params: {
    page?: string;
    status?: string;
    planId?: string;
    search?: string;
    legacy?: string;
  }) {
    const page = Math.max(1, parseInt(params.page ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where: Prisma.SubscriptionWhereInput = {};
    if (
      params.status &&
      (Object.values(BillingStatus) as string[]).includes(params.status)
    ) {
      where.status = params.status as BillingStatus;
    }
    if (params.planId) where.planId = params.planId;
    if (params.legacy === 'true') where.migrationSource = { not: null };
    const search = params.search?.trim();
    if (search) {
      where.company = {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { companyName: { contains: search, mode: 'insensitive' } },
        ],
      };
    }
    const [total, data] = await Promise.all([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          company: {
            select: { id: true, email: true, name: true, companyName: true },
          },
        },
      }),
    ]);
    return {
      data: data.map((s) => ({
        ...this.serialize(s),
        customer: s.company,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Re-exported for jobs. */
  async findDueForRollover(now = new Date(), take = 500) {
    return this.prisma.subscription.findMany({
      where: { status: BillingStatus.ACTIVE, currentPeriodEnd: { lte: now } },
      select: { companyId: true },
      take,
    });
  }

  async flush(postCommit: PostCommit) {
    for (const fn of postCommit) {
      try {
        await fn();
      } catch (err) {
        this.logger.warn(`Post-commit billing task failed: ${String(err)}`);
      }
    }
  }

  /** Used by plan pickers to know what "upgrade" means for this customer. */
  isUpgrade(current: Subscription, target: PlanWithVersion) {
    if (!target.currentVersion) return false;
    if (current.planType === PlanType.FREE) return true;
    return target.currentVersion.pricePaise > current.pricePaise;
  }
}
