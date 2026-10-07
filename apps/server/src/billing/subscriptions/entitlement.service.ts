import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingConfigService } from '../billing-config.service';
import { CreditService } from '../credits/credit.service';
import { FeatureKeyValue } from '../plans/feature-registry';
import {
  EntitlementsSnapshot,
  SubscriptionService,
} from './subscription.service';

export interface CallEligibility {
  allowed: boolean;
  reason?: string;
  availableCredits?: number;
}

/**
 * Central entitlement checks. Code asks "does this customer have feature X /
 * room for another call" here — never by comparing plan names. Answers come
 * from the ACTIVE subscription's entitlements snapshot (what the customer
 * actually bought) plus their live credit balance.
 */
@Injectable()
export class EntitlementService {
  constructor(
    private prisma: PrismaService,
    private subscriptions: SubscriptionService,
    private credits: CreditService,
    private config: BillingConfigService,
  ) {}

  async getEntitlements(
    userId: string,
  ): Promise<EntitlementsSnapshot & { planName: string | null }> {
    const sub = await this.subscriptions.getActiveSubscription(userId);
    const snap = (sub.entitlementsSnapshot ??
      {}) as Partial<EntitlementsSnapshot>;
    return {
      planName: sub.planName,
      features: snap.features ?? [],
      mediaCredits: snap.mediaCredits ?? {
        audio: null,
        video: null,
        screenShare: null,
      },
    };
  }

  async hasFeature(
    userId: string,
    feature: FeatureKeyValue | (string & {}),
  ): Promise<boolean> {
    const ent = await this.getEntitlements(userId);
    return ent.features.includes(feature);
  }

  /**
   * Whether the project owner may start a new call of this media type.
   * Active calls are never interrupted — only new ones are gated.
   */
  async canStartCall(
    ownerId: string,
    type: 'AUDIO' | 'VIDEO',
  ): Promise<CallEligibility> {
    const sub = await this.subscriptions.getActiveSubscription(ownerId);
    const [config, wallet] = await Promise.all([
      this.config.get(),
      this.credits.getSummary(ownerId, sub.currentPeriodStart),
    ]);
    const snap = (sub.entitlementsSnapshot ??
      {}) as Partial<EntitlementsSnapshot>;

    if (wallet.available < Math.max(1, config.minimumCreditsToStartCall)) {
      return {
        allowed: false,
        availableCredits: wallet.available,
        reason:
          'Your PurpleCallio credits are used up. Buy a credit top-up or upgrade your plan in Billing to continue making calls.',
      };
    }

    // Optional per-media caps within the plan's credits.
    const cap =
      type === 'VIDEO' ? snap.mediaCredits?.video : snap.mediaCredits?.audio;
    if (cap != null && sub.currentPeriodStart) {
      const used = await this.mediaCreditsUsed(ownerId, sub.currentPeriodStart);
      const spent = type === 'VIDEO' ? used.videoCredits : used.audioCredits;
      if (spent >= cap) {
        return {
          allowed: false,
          availableCredits: wallet.available,
          reason: `Your plan's ${type.toLowerCase()} allowance for this period is used up. Upgrade your plan to make more ${type.toLowerCase()} calls.`,
        };
      }
    }

    return { allowed: true, availableCredits: wallet.available };
  }

  /** Credits consumed per media type since `since` (from the usage ledger). */
  async mediaCreditsUsed(userId: string, since: Date) {
    const rows = await this.prisma.$queryRaw<
      { audio: bigint | null; video: bigint | null; screen: bigint | null }[]
    >(Prisma.sql`
      SELECT
        SUM(COALESCE(("metadata"->>'audioCredits')::int, 0)) AS audio,
        SUM(COALESCE(("metadata"->>'videoCredits')::int, 0)) AS video,
        SUM(COALESCE(("metadata"->>'screenShareCredits')::int, 0)) AS screen
      FROM "CreditTransaction"
      WHERE "userId" = ${userId} AND "type" = 'USAGE_DEBIT' AND "createdAt" >= ${since}`);
    const r = rows[0] ?? { audio: 0n, video: 0n, screen: 0n };
    return {
      audioCredits: Number(r.audio ?? 0),
      videoCredits: Number(r.video ?? 0),
      screenShareCredits: Number(r.screen ?? 0),
    };
  }
}
