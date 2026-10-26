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
}

/**
 * Account gates for Live Translate (PROTOCOL.md §1, §4). Only decide whether
 * translation may start; a running call is never cut off by these.
 * Translation is always paid: free credits and trials never cover it.
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
    if (mode === 'off') return { ok: true };
    if (!(await this.isEntitled(ownerId))) {
      return { ok: false, code: 'TRANSLATION_NOT_IN_PLAN' };
    }
    const [minimum, wallet] = await Promise.all([
      this.minimumCreditsToStart(mode, ownerId),
      this.credits.getSummary(ownerId),
    ]);
    if (wallet.paidAvailable < Math.max(1, minimum)) {
      return { ok: false, code: 'TRANSLATION_INSUFFICIENT_CREDITS' };
    }
    return { ok: true };
  }
}
