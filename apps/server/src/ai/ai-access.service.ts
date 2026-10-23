import { Injectable } from '@nestjs/common';
import { PlanType } from '@prisma/client';

import { BillingConfigService } from '../billing/billing-config.service';
import { CreditService } from '../billing/credits/credit.service';
import { SubscriptionService } from '../billing/subscriptions/subscription.service';

/**
 * Account-level gates for AI voice agents. A running call is never cut off by
 * these; they only decide whether a new session (or agent) may start.
 */
@Injectable()
export class AiAccessService {
  constructor(
    private subscriptions: SubscriptionService,
    private credits: CreditService,
    private billingConfig: BillingConfigService,
  ) {}

  /**
   * Every account has a Free subscription, so "paid" means any plan type
   * other than FREE (Custom plans included). A missing type fails closed.
   */
  async hasPaidPlan(userId: string): Promise<boolean> {
    const sub = await this.subscriptions.getActiveSubscription(userId);
    return sub.planType != null && sub.planType !== PlanType.FREE;
  }

  /**
   * The wallet must cover one AI minute and the start minimum:
   * available ≥ max(minimumCreditsToStartCall, aiCreditsPerMinute).
   */
  async hasCreditsToStart(userId: string): Promise<boolean> {
    const sub = await this.subscriptions.getActiveSubscription(userId);
    const [config, wallet] = await Promise.all([
      this.billingConfig.get(),
      this.credits.getSummary(userId, sub.currentPeriodStart),
    ]);
    const required = Math.max(
      1,
      config.minimumCreditsToStartCall,
      config.aiCreditsPerMinute ?? 1,
    );
    return wallet.available >= required;
  }
}
