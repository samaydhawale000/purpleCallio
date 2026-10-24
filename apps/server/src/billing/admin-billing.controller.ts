import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  NotFoundException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CreditBucketSource, CreditTransactionType } from '@prisma/client';
import type { CustomPlanRequestStatus } from '@prisma/client';
import { AdminGuard } from '../admin/guards/admin.guard';
import { AdminBillingService } from './admin-billing.service';
import { BillingConfigService } from './billing-config.service';
import type { BillingConfigUpdate } from './billing-config.service';
import { BillingService } from './billing.service';
import { BillingAuditService } from './billing-audit.service';
import { CreditService } from './credits/credit.service';
import { CustomPlanService } from './custom-plans/custom-plan.service';
import type { CustomOfferInput } from './custom-plans/custom-plan.service';
import { BillingFulfillmentService } from './checkout/fulfillment.service';
import { PlanService } from './plans/plan.service';
import type { PlanInput } from './plans/plan.service';
import { RatingEngineService } from './rating-engine.service';
import { SubscriptionService } from './subscriptions/subscription.service';
import { TopUpService } from './topups/topup.service';
import type { TopUpInput } from './topups/topup.service';
import { UsageBillingService } from './usage-billing.service';
import type { BillingRates } from './usage-billing.service';
import { UsageSegmentService } from './usage-segment.service';
import { AutoRenewService } from './subscriptions/auto-renew.service';
import { CreditPricingService } from './credit-pricing.service';
import type { CreditPricingInput } from './credit-pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { creditExpiryFromDays } from './credit-pricing.util';
import { BillingNotificationService } from './billing-notification.service';

type FeatureBody = Parameters<PlanService['upsertFeature']>[0];

/**
 * Admin → Billing. Everything pricing-related is configured here at
 * runtime (no deployment needed) and every change is audit-logged.
 */
@UseGuards(AdminGuard)
@Controller('admin/billing')
export class AdminBillingController {
  constructor(
    private plans: PlanService,
    private topUps: TopUpService,
    private config: BillingConfigService,
    private subscriptions: SubscriptionService,
    private credits: CreditService,
    private customPlans: CustomPlanService,
    private fulfillment: BillingFulfillmentService,
    private adminBilling: AdminBillingService,
    private billing: BillingService,
    private usageBilling: UsageBillingService,
    private segments: UsageSegmentService,
    private ratingEngine: RatingEngineService,
    private audit: BillingAuditService,
    private autoRenew: AutoRenewService,
    private creditPricing: CreditPricingService,
    private prisma: PrismaService,
    private billingNotifications: BillingNotificationService,
  ) {}

  // ── Plans ───────────────────────────────────────────
  @Get('plans')
  listPlans() {
    return this.plans.listPlansForAdmin();
  }

  @Post('plans')
  createPlan(@Req() req: any, @Body() body: PlanInput) {
    return this.plans.createPlan(body, req.user.userId);
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string) {
    return this.plans.getPlanForAdmin(id);
  }

  @Patch('plans/:id')
  async updatePlan(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: PlanInput,
  ) {
    const updated = await this.plans.updatePlan(id, body, req.user.userId);
    // Price changes apply to auto-renewing customers from their next renewal.
    this.autoRenew.inBackground(
      () => this.autoRenew.syncPlan(id),
      `plan ${id}`,
    );
    return updated;
  }

  @Post('plans/:id/archive')
  async archivePlan(@Req() req: any, @Param('id') id: string) {
    const archived = await this.plans.archivePlan(id, req.user.userId);
    // Archived plans can't renew: their mandates are stopped at period end.
    this.autoRenew.inBackground(
      () => this.autoRenew.syncPlan(id),
      `archive ${id}`,
    );
    return archived;
  }

  @Post('plans/:id/duplicate')
  duplicatePlan(@Req() req: any, @Param('id') id: string) {
    return this.plans.duplicatePlan(id, req.user.userId);
  }

  @Get('plans/:id/subscribers')
  planSubscribers(@Param('id') id: string, @Query('page') page?: string) {
    return this.plans.listSubscribers(id, page);
  }

  // ── Feature registry ────────────────────────────────
  @Get('features')
  listFeatures() {
    return this.plans.listFeatures();
  }

  @Post('features')
  upsertFeature(@Req() req: any, @Body() body: FeatureBody) {
    return this.plans.upsertFeature(body, req.user.userId);
  }

  // ── Top-ups ─────────────────────────────────────────
  @Get('credit-pricing')
  async listCreditPricing() {
    return {
      versions: await this.creditPricing.list(),
      active: await this.creditPricing.current('INR'),
    };
  }

  @Post('credit-pricing/preview')
  previewCreditPricing(@Body() body: CreditPricingInput) {
    return this.creditPricing.preview(body);
  }

  @Post('credit-pricing')
  createCreditPricingDraft(@Req() req: any, @Body() body: CreditPricingInput) {
    return this.creditPricing.createDraft(body, req.user.userId);
  }

  @Patch('credit-pricing/:id')
  updateCreditPricingDraft(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CreditPricingInput,
  ) {
    return this.creditPricing.updateDraft(id, body, req.user.userId);
  }

  @Post('credit-pricing/:id/publish')
  publishCreditPricing(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { confirm?: boolean },
  ) {
    return this.creditPricing.publish(
      id,
      req.user.userId,
      body?.confirm === true,
    );
  }

  @Post('credit-pricing/:id/cancel')
  cancelCreditPricing(@Req() req: any, @Param('id') id: string) {
    return this.creditPricing.cancel(id, req.user.userId);
  }

  @Post('promotional-credits')
  async grantPromotionalCredits(
    @Req() req: any,
    @Body()
    body: {
      userId?: string;
      credits?: number;
      reason?: string;
      validityDays?: number;
      campaignReference?: string;
      idempotencyKey?: string;
    },
  ) {
    if (!body?.userId?.trim())
      throw new BadRequestException('userId is required.');
    if (!Number.isSafeInteger(body.credits) || (body.credits as number) <= 0)
      throw new BadRequestException('credits must be a positive whole number.');
    if (!body.reason?.trim() || body.reason.trim().length > 300)
      throw new BadRequestException(
        'A reason of at most 300 characters is required.',
      );
    if (
      !Number.isInteger(body.validityDays) ||
      (body.validityDays as number) < 1 ||
      (body.validityDays as number) > 3650
    )
      throw new BadRequestException('validityDays must be between 1 and 3650.');
    if (
      !body.idempotencyKey ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(body.idempotencyKey)
    )
      throw new BadRequestException('A valid idempotencyKey is required.');
    const customer = await this.prisma.user.findUnique({
      where: { id: body.userId.trim() },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    const expiresAt = creditExpiryFromDays(
      new Date(),
      body.validityDays as number,
    );
    const idempotencyKey = `promotion:${req.user.userId}:${body.idempotencyKey}`;
    const result = await this.credits.grant({
      userId: customer.id,
      amount: body.credits as number,
      type: CreditTransactionType.PROMOTION,
      source: CreditBucketSource.PROMOTION,
      expiresAt,
      referenceType: 'AdminPromotion',
      referenceId: body.campaignReference?.trim() || null,
      idempotencyKey,
      metadata: {
        reason: body.reason.trim(),
        campaignReference: body.campaignReference?.trim() || null,
      },
      actorId: req.user.userId,
    });
    if (!result.duplicate) {
      await this.audit.log({
        action: 'PROMOTIONAL_CREDITS_GRANTED',
        actorId: req.user.userId,
        entity: 'CreditBucket',
        entityId: result.bucketId,
        newValue: {
          userId: customer.id,
          amount: body.credits,
          expiresAt,
          reason: body.reason.trim(),
          campaignReference: body.campaignReference?.trim() || null,
          ledgerTransactionId: result.transaction.id,
        },
      });
      await this.billingNotifications.promotionalCreditsGranted(
        customer.id,
        body.credits as number,
        expiresAt,
        body.reason.trim(),
        result.bucketId!,
      );
    }
    return {
      bucketId: result.bucketId,
      transactionId: result.transaction.id,
      expiresAt,
      duplicate: result.duplicate,
    };
  }

  @Patch('customers/:userId/prepaid')
  async updatePrepaidAccess(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body()
    body: {
      prepaidAccess?: boolean;
      creditPurchaseBlocked?: boolean;
      reason?: string;
    },
  ) {
    if (
      typeof body?.prepaidAccess !== 'boolean' &&
      typeof body?.creditPurchaseBlocked !== 'boolean'
    )
      throw new BadRequestException(
        'Set prepaidAccess or creditPurchaseBlocked to true or false.',
      );
    if (!body.reason?.trim() || body.reason.trim().length > 300)
      throw new BadRequestException(
        'A reason of at most 300 characters is required.',
      );
    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        prepaidSince: true,
        creditPurchaseBlocked: true,
      },
    });
    if (!before) throw new NotFoundException('Customer not found.');
    const data: { prepaidSince?: Date | null; creditPurchaseBlocked?: boolean } = {};
    if (typeof body.prepaidAccess === 'boolean')
      data.prepaidSince = body.prepaidAccess
        ? before.prepaidSince ?? new Date()
        : null;
    if (typeof body.creditPurchaseBlocked === 'boolean')
      data.creditPurchaseBlocked = body.creditPurchaseBlocked;
    const after = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        prepaidSince: true,
        creditPurchaseBlocked: true,
      },
    });
    if (typeof body.prepaidAccess === 'boolean')
      await this.audit.log({
        action: 'PREPAID_ACCESS_CHANGED',
        actorId: req.user.userId,
        entity: 'User',
        entityId: userId,
        oldValue: { prepaidSince: before.prepaidSince },
        newValue: { prepaidSince: after.prepaidSince, reason: body.reason.trim() },
      });
    if (typeof body.creditPurchaseBlocked === 'boolean')
      await this.audit.log({
        action: 'CREDIT_PURCHASE_BLOCK_CHANGED',
        actorId: req.user.userId,
        entity: 'User',
        entityId: userId,
        oldValue: { creditPurchaseBlocked: before.creditPurchaseBlocked },
        newValue: {
          creditPurchaseBlocked: after.creditPurchaseBlocked,
          reason: body.reason.trim(),
        },
      });
    return after;
  }

  @Get('topups')
  listTopUps() {
    return this.topUps.listAll();
  }

  @Post('topups')
  createTopUp(@Req() req: any, @Body() body: TopUpInput) {
    return this.topUps.create(body, req.user.userId);
  }

  @Patch('topups/:id')
  updateTopUp(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: TopUpInput,
  ) {
    return this.topUps.update(id, body, req.user.userId);
  }

  // ── Credit rates & settings (one config record) ─────
  @Get('credit-rates')
  getCreditRates() {
    return this.config.get();
  }

  @Patch('credit-rates')
  async updateCreditRates(@Req() req: any, @Body() body: BillingConfigUpdate) {
    const updated = await this.config.update(body, req.user.userId);
    if (body?.taxPercent !== undefined) {
      this.autoRenew.inBackground(() => this.autoRenew.syncAll(), 'tax change');
    }
    return updated;
  }

  @Get('settings')
  getSettings() {
    return this.config.get();
  }

  @Patch('settings')
  async updateSettings(@Req() req: any, @Body() body: BillingConfigUpdate) {
    const updated = await this.config.update(body, req.user.userId);
    if (body?.taxPercent !== undefined) {
      this.autoRenew.inBackground(() => this.autoRenew.syncAll(), 'tax change');
    }
    return updated;
  }

  // ── Subscriptions ───────────────────────────────────
  @Get('subscriptions')
  listSubscriptions(
    @Query('page') page?: string,
    @Query('status') status?: string,
    @Query('planId') planId?: string,
    @Query('search') search?: string,
    @Query('legacy') legacy?: string,
  ) {
    return this.subscriptions.listForAdmin({
      page,
      status,
      planId,
      search,
      legacy,
    });
  }

  // ── Payments ────────────────────────────────────────
  @Get('payments')
  listPayments(
    @Query('page') page?: string,
    @Query('status') status?: string,
    @Query('purpose') purpose?: string,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
  ) {
    return this.adminBilling.listPayments({
      page,
      status,
      purpose,
      search,
      userId,
    });
  }

  @Post('payments/:id/refund')
  refundPayment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.fulfillment.refund(id, req.user.userId, body?.reason);
  }

  // ── Customers: billing view + credit adjustments ────
  @Get('customers/:id')
  customerBilling(@Param('id') id: string) {
    return this.adminBilling.getCustomerBilling(id);
  }

  @Post('customers/:id/credits')
  async adjustCredits(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      amount: number;
      reason: string;
      expiresAt?: string | null;
      promotion?: boolean;
    },
  ) {
    const result = await this.credits.adjust(
      id,
      Number(body?.amount),
      req.user.userId,
      body?.reason,
      {
        expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
        type: body?.promotion ? 'PROMOTION' : 'ADMIN_ADJUSTMENT',
      },
    );
    await this.audit.log({
      action: 'CREDITS_ADJUSTED',
      actorId: req.user.userId,
      entity: 'CreditWallet',
      entityId: id,
      newValue: {
        amount: Number(body?.amount),
        reason: body?.reason,
        expiresAt: body?.expiresAt ?? null,
      },
    });
    return result;
  }

  // ── Custom plans ────────────────────────────────────
  @Get('custom-plans')
  listCustomPlans(
    @Query('page') page?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.customPlans.listForAdmin({ page, status, search });
  }

  @Get('custom-plans/:id')
  getCustomPlan(@Param('id') id: string) {
    return this.customPlans.getForAdmin(id);
  }

  @Patch('custom-plans/:id')
  updateCustomPlan(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      status?: CustomPlanRequestStatus;
      assignedAdminId?: string | null;
      notes?: string | null;
      estimatedMonthlyCredits?: number | null;
    },
  ) {
    return this.customPlans.updateRequest(id, body ?? {}, req.user.userId);
  }

  @Post('custom-plans/:id/offer')
  createOffer(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CustomOfferInput,
  ) {
    return this.customPlans.createOffer(id, body, req.user.userId);
  }

  @Post('custom-plans/offers/:offerId/withdraw')
  withdrawOffer(@Req() req: any, @Param('offerId') offerId: string) {
    return this.customPlans.withdrawOffer(offerId, req.user.userId);
  }

  // ── Reporting ───────────────────────────────────────
  @Get('revenue')
  revenue() {
    return this.billing.getRevenue();
  }

  @Get('usage-summary')
  usageSummary() {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return this.usageBilling.summarizeAdminUsage(start);
  }

  @Get('segment-analytics')
  async segmentAnalytics() {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const segs = await this.segments.getSegmentsSince(start);
    const rated = await this.ratingEngine.rateSegments(segs);
    return { since: start, segmentCount: segs.length, totals: rated };
  }

  /** Internal cost basis (legacy per-minute paise rates) — never customer-facing. */
  @Get('internal-rates')
  internalRates() {
    return this.usageBilling.getRates();
  }

  @Patch('internal-rates')
  async updateInternalRates(
    @Req() req: any,
    @Body() body: Partial<BillingRates>,
  ) {
    const before = await this.usageBilling.getRates();
    const after = await this.usageBilling.updateRates(body ?? {});
    await this.audit.log({
      action: 'BILLING_CONFIG_UPDATED',
      actorId: req.user.userId,
      entity: 'BillingRate (internal cost basis)',
      entityId: after.id,
      oldValue: before,
      newValue: after,
    });
    return after;
  }

  @Get('migration')
  migration() {
    return this.adminBilling.getMigrationSummary();
  }
}
