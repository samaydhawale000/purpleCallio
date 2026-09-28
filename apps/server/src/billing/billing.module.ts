import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingJobsService } from './billing-jobs.service';
import { UsageBillingService } from './usage-billing.service';
import { InvoiceBillingService } from './invoice-billing.service';
import { UsageSegmentService } from './usage-segment.service';
import { RatingEngineService } from './rating-engine.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { CustomerDiscountService } from './customer-discount.service';
import { BillingGuard } from '../common/guards/billing.guard';
import { PaymentModule } from '../payment/payment.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PaymentModule,
    PrismaModule,
    JwtModule.register({}),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingJobsService,
    UsageBillingService,
    InvoiceBillingService,
    UsageSegmentService,
    RatingEngineService,
    InvoicePdfService,
    CustomerDiscountService,
    BillingGuard,
  ],
  exports: [
    BillingService,
    UsageBillingService,
    InvoiceBillingService,
    UsageSegmentService,
    RatingEngineService,
    CustomerDiscountService,
    BillingGuard,
  ],
})
export class BillingModule {}
