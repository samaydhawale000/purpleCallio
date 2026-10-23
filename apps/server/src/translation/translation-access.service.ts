import { Injectable } from '@nestjs/common';

import { BillingConfigService } from '../billing/billing-config.service';
import { CreditService } from '../billing/credits/credit.service';
import { EntitlementService } from '../billing/subscriptions/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';

export const TRANSLATION_FEATURE = 'TRANSLATION';

export type TranslationStartCode =
  | 'TRANSLATION_NOT_IN_PLAN'
  | 'TRANSLATION_INSUFFICIENT_CREDITS';

export interface TranslationStartCheck {
  ok: boolean;
  code?: TranslationStartCode;
  /** Running on free trial minutes (plan lacks TRANSLATION). */
  trial: boolean;
}

/**
 * Account gates for Live Translate (PROTOCOL.md §1, §4). Only decide whether
 * translation may start; a running call is never cut off by these.
 */
@Injectable()
export class TranslationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly billingConfig: BillingConfigService,
    private readonly credits: CreditService,
  ) {}

  isEntitled(ownerId: string): Promise<boolean> {
    return this.entitlements.hasFeature(ownerId, TRANSLATION_FEATURE);
  }

  /** Free trial seconds left: translationTrialMinutes × 60 − Σ trialSecondsUsed. */
  async trialSecondsRemaining(ownerId: string): Promise<number> {
    const config = await this.billingConfig.get();
    const total = Math.max(0, config.translationTrialMinutes ?? 0) * 60;
    if (total <= 0) return 0;
    const used = await this.prisma.translationSession.aggregate({
      where: { ownerId },
      _sum: { trialSecondsUsed: true },
    });
    return Math.max(0, total - (used._sum.trialSecondsUsed ?? 0));
  }

  /** BillingConfig.translationMinimumCredits, else one minute of the mode's rate. */
  async minimumCreditsToStart(
    mode: 'voice' | 'captions',
    ownerId?: string,
  ): Promise<number> {
    const config = await this.billingConfig.get();
    if (config.translationMinimumCredits != null) {
      return Math.max(0, config.translationMinimumCredits);
    }
    const override = ownerId
      ? await this.prisma.translationRateOverride.findUnique({
          where: { userId: ownerId },
        })
      : null;
    return mode === 'voice'
      ? (override?.voiceCreditsPerMinute ?? config.translationVoiceCreditsPerMinute)
      : (override?.captionsCreditsPerMinute ??
          config.translationCaptionsCreditsPerMinute);
  }

  async canStart(
    ownerId: string,
    mode: 'off' | 'voice' | 'captions',
  ): Promise<TranslationStartCheck> {
    if (mode === 'off') return { ok: true, trial: false };
    const entitled = await this.isEntitled(ownerId);
    if (!entitled) {
      // Trial minutes are free: no credit minimum while they last.
      if ((await this.trialSecondsRemaining(ownerId)) > 0) {
        return { ok: true, trial: true };
      }
      return { ok: false, code: 'TRANSLATION_NOT_IN_PLAN', trial: false };
    }
    const [minimum, wallet] = await Promise.all([
      this.minimumCreditsToStart(mode, ownerId),
      this.credits.getSummary(ownerId),
    ]);
    if (wallet.available < Math.max(1, minimum)) {
      return { ok: false, code: 'TRANSLATION_INSUFFICIENT_CREDITS', trial: false };
    }
    return { ok: true, trial: false };
  }
}
