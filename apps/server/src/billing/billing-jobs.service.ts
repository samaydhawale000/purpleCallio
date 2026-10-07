import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingStatus, PaymentStatus, PlanType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingConfigService } from './billing-config.service';
import { BillingNotificationService } from './billing-notification.service';
import { CheckoutService } from './checkout/checkout.service';
import { CreditService } from './credits/credit.service';
import { SubscriptionService } from './subscriptions/subscription.service';

/**
 * Prepaid billing housekeeping. None of these jobs moves money:
 *  - roll subscriptions whose period ended (Free refresh, or paid → expired
 *    → Free fallback),
 *  - expire credit buckets past their expiry,
 *  - remind customers before a paid plan ends (renewal is always manual),
 *  - abandon checkouts that were never paid.
 *
 * The pay-as-you-go jobs that used to live here (close the cycle, generate a
 * usage invoice, auto-charge the saved card, dunning retries on a
 * 1/3/7-day schedule) have been removed — no background job charges a
 * customer anymore.
 *
 * Every step is idempotent (atomic claims, ledger idempotency keys,
 * notification dedupe keys), so overlapping runs are harmless.
 */
@Injectable()
export class BillingJobsService {
  private readonly logger = new Logger(BillingJobsService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private subscriptions: SubscriptionService,
    private credits: CreditService,
    private config: BillingConfigService,
    private checkout: CheckoutService,
    private notify: BillingNotificationService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.rollOverSubscriptions();
      await this.expireCredits();
      await this.abandonStaleCheckouts();
    } catch (err) {
      this.logger.error(`Billing housekeeping failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async hourly() {
    try {
      await this.sendRenewalReminders();
    } catch (err) {
      this.logger.error(`Renewal reminders failed: ${String(err)}`);
    }
  }

  async rollOverSubscriptions(now = new Date()) {
    const due = await this.subscriptions.findDueForRollover(now);
    const users = Array.from(new Set(due.map((d) => d.companyId)));
    for (const userId of users) {
      try {
        await this.subscriptions.getActiveSubscription(userId);
      } catch (err) {
        this.logger.error(`Rollover failed for ${userId}: ${String(err)}`);
      }
    }
    return users.length;
  }

  async expireCredits(now = new Date()) {
    const due = await this.prisma.creditBucket.findMany({
      where: { expiredAt: null, expiresAt: { lte: now } },
      select: { userId: true },
      distinct: ['userId'],
      take: 500,
    });
    for (const { userId } of due) {
      try {
        await this.credits.expireDue(userId);
      } catch (err) {
        this.logger.error(`Credit expiry failed for ${userId}: ${String(err)}`);
      }
    }
    return due.length;
  }

  async sendRenewalReminders(now = new Date()) {
    const config = await this.config.get();
    if (config.renewalReminderDays <= 0) return 0;
    const horizon = new Date(
      now.getTime() + config.renewalReminderDays * 86_400_000,
    );
    const ending = await this.prisma.subscription.findMany({
      where: {
        status: BillingStatus.ACTIVE,
        planType: { not: PlanType.FREE },
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { gt: now, lte: horizon },
      },
      take: 500,
    });
    for (const sub of ending) await this.notify.planExpiringSoon(sub);
    return ending.length;
  }

  async abandonStaleCheckouts(now = new Date()) {
    const config = await this.config.get();
    const cutoff = new Date(
      now.getTime() - config.pendingCheckoutTtlHours * 3_600_000,
    );
    const stale = await this.prisma.payment.findMany({
      where: {
        purpose: { not: 'LEGACY' },
        paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
        createdAt: { lte: cutoff },
      },
      select: { id: true },
      take: 500,
    });
    for (const p of stale)
      await this.checkout.abandon(p.id, 'checkout_abandoned');
    return stale.length;
  }
}
