import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  BillingStatus,
  CreditBucketSource,
  CreditTransactionType,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BillingAuditService } from './billing-audit.service';
import { BillingConfigService } from './billing-config.service';
import { CreditService } from './credits/credit.service';
import { PlanService } from './plans/plan.service';
import { SubscriptionService } from './subscriptions/subscription.service';

const SETTING_KEY = 'billing.prepaidMigration';
const TRANSITION_DAYS = 30;

/**
 * One-time move of existing accounts from pay-as-you-go to prepaid.
 *
 * Runs in the background after boot and is idempotent (per-user ledger
 * keys + a PlatformSetting completion marker), so redeploys and multiple
 * instances are safe. For every account:
 *  - legacy cycle-anchor subscriptions (incl. ones stuck PAST_DUE by the
 *    old dunning flow) become the Free plan, keeping the current period;
 *  - a credit wallet is created and the Free allowance allocated.
 *
 * Accounts that had a paying relationship (saved card, paid usage invoice
 * or a negotiated discount) are NOT silently cut down to the Free
 * allowance: they get a one-time transition grant equal to their recent
 * average monthly usage (in credits, valid 30 days), are flagged
 * `legacy_payg_paying` for admin follow-up, and admins get a summary.
 * No one is charged and no plan is purchased on anyone's behalf. Saved
 * cards and historical invoices/payments are left untouched.
 */
@Injectable()
export class LegacyBillingMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LegacyBillingMigrationService.name);

  constructor(
    private prisma: PrismaService,
    private plans: PlanService,
    private subscriptions: SubscriptionService,
    private credits: CreditService,
    private config: BillingConfigService,
    private audit: BillingAuditService,
    private notifications: NotificationService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      await this.plans.ensureDefaults();
    } catch (err) {
      this.logger.error(`Could not seed billing defaults: ${String(err)}`);
      return;
    }
    // Don't hold up boot; the request path also migrates lazily.
    setImmediate(() => {
      this.run().catch((err) =>
        this.logger.error(`Prepaid migration failed: ${String(err)}`),
      );
    });
  }

  async run() {
    const marker = await this.prisma.platformSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    if ((marker?.value as Record<string, unknown> | null)?.completedAt)
      return marker!.value;

    const config = await this.config.get();
    const free = await this.plans.getDefaultFreePlan();
    const users = await this.prisma.user.findMany({
      select: { id: true, razorpayTokenId: true },
    });
    const paying: { userId: string; transitionCredits: number }[] = [];

    for (const user of users) {
      try {
        // Retired dunning state: the unpaid legacy invoice stays on record
        // (visible to admins) but the account returns to good standing.
        await this.prisma.subscription.updateMany({
          where: {
            companyId: user.id,
            status: BillingStatus.PAST_DUE,
            planId: null,
          },
          data: {
            status: BillingStatus.ACTIVE,
            migrationSource: 'legacy_payg',
          },
        });
        await this.prisma.subscription.updateMany({
          where: { companyId: user.id, planId: null, migrationSource: null },
          data: { migrationSource: 'legacy_payg' },
        });
        const sub = await this.subscriptions.getActiveSubscription(user.id);
        // Exactly one ACTIVE subscription per account from here on.
        await this.prisma.subscription.updateMany({
          where: {
            companyId: user.id,
            status: BillingStatus.ACTIVE,
            id: { not: sub.id },
          },
          data: {
            status: BillingStatus.CANCELED,
            canceledAt: new Date(),
            replacedBySubscriptionId: sub.id,
          },
        });

        const [paidInvoices, discount] = await Promise.all([
          this.prisma.usageInvoice.count({
            where: { userId: user.id, status: 'paid' },
          }),
          this.prisma.customerDiscount.count({
            where: { companyId: user.id, active: true },
          }),
        ]);
        const wasPaying =
          !!user.razorpayTokenId || paidInvoices > 0 || discount > 0;
        if (!wasPaying) {
          await this.notifyCustomer(
            user.id,
            free.currentVersion.includedCredits,
            0,
          );
          continue;
        }

        const recent = await this.prisma.usage.findMany({
          where: { companyId: user.id },
          orderBy: { billingCycleStart: 'desc' },
          take: 3,
          select: {
            audioMinutes: true,
            videoMinutes: true,
            screenShareMinutes: true,
          },
        });
        const monthly = recent.length
          ? Math.ceil(
              recent.reduce(
                (s, u) => s + this.config.creditsFor(u, config).totalCredits,
                0,
              ) / recent.length,
            )
          : 0;
        const transitionCredits = Math.max(0, monthly - sub.includedCredits);
        if (transitionCredits > 0) {
          await this.credits.grant({
            userId: user.id,
            amount: transitionCredits,
            type: CreditTransactionType.MIGRATION,
            source: CreditBucketSource.MIGRATION,
            expiresAt: new Date(Date.now() + TRANSITION_DAYS * 86_400_000),
            referenceType: 'Migration',
            referenceId: 'prepaid',
            idempotencyKey: `migration:transition:${user.id}`,
            metadata: {
              reason: 'Pay-as-you-go to prepaid transition',
              averageMonthlyCredits: monthly,
            },
          });
        }
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { migrationSource: 'legacy_payg_paying' },
        });
        paying.push({ userId: user.id, transitionCredits });
        await this.notifyCustomer(
          user.id,
          free.currentVersion.includedCredits,
          transitionCredits,
        );
      } catch (err) {
        this.logger.error(
          `Prepaid migration failed for ${user.id}: ${String(err)}`,
        );
      }
    }

    const outstandingLegacyInvoices = await this.prisma.usageInvoice.count({
      where: { status: { in: ['open', 'processing', 'dunning'] } },
    });
    // Nothing retries these anymore; clear the schedule so it's explicit.
    await this.prisma.usageInvoice.updateMany({
      where: { status: 'dunning', nextRetryAt: { not: null } },
      data: { nextRetryAt: null },
    });

    const summary = {
      completedAt: new Date().toISOString(),
      accounts: users.length,
      payingAccounts: paying.length,
      transitionCreditsGranted: paying.reduce(
        (s, p) => s + p.transitionCredits,
        0,
      ),
      outstandingLegacyInvoices,
    };
    await this.prisma.platformSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: summary },
      update: { value: summary },
    });
    await this.audit.log({
      action: 'LEGACY_BILLING_MIGRATED',
      entity: 'Billing',
      newValue: summary,
    });
    if (paying.length || outstandingLegacyInvoices) {
      await this.notifications.notifyAdmins({
        type: NotificationType.PLAN_ACTIVATED,
        title: 'Prepaid billing migration complete',
        message: `${paying.length} account(s) that paid under pay-as-you-go received transition credits and are flagged "legacy" in Admin → Billing → Subscriptions for plan follow-up. ${outstandingLegacyInvoices} unpaid legacy invoice(s) remain on record and will not be charged automatically.`,
        dedupeKey: 'admin:prepaid-migration',
      });
    }
    this.logger.log(`Prepaid migration complete: ${JSON.stringify(summary)}`);
    return summary;
  }

  private notifyCustomer(
    userId: string,
    freeCredits: number,
    transitionCredits: number,
  ) {
    const fmt = (n: number) => n.toLocaleString('en-IN');
    return this.notifications.createNotification({
      userId,
      type: NotificationType.PLAN_ACTIVATED,
      title: 'Billing is now prepaid',
      message:
        `PurpleCallio now uses prepaid plans with included credits — no more usage invoices or automatic card charges. ` +
        `You're on the Free plan with ${fmt(freeCredits)} credits each month` +
        (transitionCredits > 0
          ? `, plus ${fmt(transitionCredits)} transition credits (valid ${TRANSITION_DAYS} days) based on your recent usage.`
          : '.') +
        ' Choose a plan in Billing whenever you need more.',
      dedupeKey: `migration:prepaid:${userId}`,
    });
  }
}
