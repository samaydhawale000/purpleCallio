import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { BillingController } from './billing.controller';
import { AdminBillingController } from './admin-billing.controller';
import { BillingService } from './billing.service';
import { BillingJobsService } from './billing-jobs.service';
import { UsageBillingService } from './usage-billing.service';
import { InvoiceBillingService } from './invoice-billing.service';
import { UsageSegmentService } from './usage-segment.service';
import { RatingEngineService } from './rating-engine.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { CustomerDiscountService } from './customer-discount.service';
import { BillingAuditService } from './billing-audit.service';
import { BillingConfigService } from './billing-config.service';
import { BillingNotificationService } from './billing-notification.service';
import { PlanService } from './plans/plan.service';
import { CreditService } from './credits/credit.service';
import { SubscriptionService } from './subscriptions/subscription.service';
import { EntitlementService } from './subscriptions/entitlement.service';
import { AutoRenewService } from './subscriptions/auto-renew.service';
import { TopUpService } from './topups/topup.service';
import { CheckoutService } from './checkout/checkout.service';
import { BillingFulfillmentService } from './checkout/fulfillment.service';
import { BillingWebhookService } from './checkout/billing-webhook.service';
import { CustomPlanService } from './custom-plans/custom-plan.service';
import { AdminBillingService } from './admin-billing.service';
import { LegacyBillingMigrationService } from './legacy-billing-migration.service';
import { BillingGuard } from '../common/guards/billing.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { PaymentModule } from '../payment/payment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SupportModule } from '../support/support.module';

/**
 * Prepaid billing domain: plans → checkout → verified payment →
 * subscription + credits → usage consumes credits.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    PaymentModule,
    PrismaModule,
    SupportModule,
    JwtModule.register({}),
  ],
  controllers: [BillingController, AdminBillingController],
  providers: [
    // Domain
    PlanService,
    CreditService,
    SubscriptionService,
    EntitlementService,
    AutoRenewService,
    TopUpService,
    CheckoutService,
    BillingFulfillmentService,
    BillingWebhookService,
    CustomPlanService,
    BillingConfigService,
    BillingAuditService,
    BillingNotificationService,
    BillingJobsService,
    LegacyBillingMigrationService,
    AdminBillingService,
    // Metering (participant-minutes → credits)
    UsageBillingService,
    UsageSegmentService,
    RatingEngineService,
    // Account / legacy history
    BillingService,
    InvoiceBillingService,
    InvoicePdfService,
    CustomerDiscountService,
    BillingGuard,
    AdminGuard,
  ],
  exports: [
    BillingService,
    UsageBillingService,
    InvoiceBillingService,
    UsageSegmentService,
    RatingEngineService,
    CustomerDiscountService,
    SubscriptionService,
    EntitlementService,
    AutoRenewService,
    CreditService,
    BillingGuard,
  ],
})
export class BillingModule {}
