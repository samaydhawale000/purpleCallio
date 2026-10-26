import { Injectable, Logger } from '@nestjs/common';
import { CreditBucketSource, CreditTransactionType } from '@prisma/client';

import { BillingConfigService } from '../billing-config.service';
import { creditExpiryFromDays } from '../credit-pricing.util';
import { CreditService } from './credit.service';

/**
 * One-time free credits for a new account (BillingConfig.signupFreeCredits).
 * They are free credits: audio, video and screen share only, never AI.
 */
@Injectable()
export class SignupCreditsService {
  private readonly logger = new Logger(SignupCreditsService.name);

  constructor(
    private config: BillingConfigService,
    private credits: CreditService,
  ) {}

  /** Idempotent per account; returns the credits granted (0 when off or already granted). */
  async grant(userId: string): Promise<number> {
    const config = await this.config.get();
    const amount = config.signupFreeCredits;
    if (!(amount > 0)) return 0;
    const days = config.signupFreeCreditsValidityDays;
    const result = await this.credits.grant({
      userId,
      amount,
      type: CreditTransactionType.PROMOTION,
      source: CreditBucketSource.SIGNUP,
      expiresAt: days ? creditExpiryFromDays(new Date(), days) : null,
      referenceType: 'Signup',
      referenceId: userId,
      idempotencyKey: `signup:${userId}`,
      metadata: { reason: 'Welcome credits for audio, video and screen share' },
    });
    if (result.duplicate) return 0;
    this.logger.log(`Granted ${amount} signup credits to ${userId}`);
    return amount;
  }
}
