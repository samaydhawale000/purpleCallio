import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { BillingConfigService } from './billing-config.service';
import { UsageBillingService } from './usage-billing.service';
import { InvoiceBillingService } from './invoice-billing.service';
import { UsageSegmentService } from './usage-segment.service';
import { RatingEngineService } from './rating-engine.service';
import { InvoicePdfService, receiptLabel } from './invoice-pdf.service';
import { PlanService } from './plans/plan.service';
import { TopUpService } from './topups/topup.service';
import { CreditService } from './credits/credit.service';
import { SubscriptionService } from './subscriptions/subscription.service';
import { CheckoutService } from './checkout/checkout.service';
import type { CheckoutRequest } from './checkout/checkout.service';
import { BillingWebhookService } from './checkout/billing-webhook.service';
import { CustomPlanService } from './custom-plans/custom-plan.service';
import { omit } from './omit.util';

interface VerifyBody {
  paymentId?: string;
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

/**
 * Prepaid billing API (customer + public). Route names follow the billing
 * spec; checkout bodies only ever carry ids — amounts are server-derived.
 */
@Controller('billing')
export class BillingController {
  constructor(
    private prisma: PrismaService,
    private billingService: BillingService,
    private config: BillingConfigService,
    private usageBilling: UsageBillingService,
    private invoiceBilling: InvoiceBillingService,
    private segmentService: UsageSegmentService,
    private ratingEngine: RatingEngineService,
    private invoicePdf: InvoicePdfService,
    private plans: PlanService,
    private topUps: TopUpService,
    private credits: CreditService,
    private subscriptions: SubscriptionService,
    private checkout: CheckoutService,
    private webhooks: BillingWebhookService,
    private customPlans: CustomPlanService,
  ) {}

  // ── Public (pricing page, docs) ─────────────────────
  /** Single source of truth for public pricing: plans + features + top-ups + rates. */
  @Get('plans')
  async publicPlans() {
    const [plans, features, topUps, config] = await Promise.all([
      this.plans.listPublicPlans(),
      this.plans.listFeatures({ publicOnly: true }),
      this.topUps.listActive(),
      this.config.get(),
    ]);
    return {
      plans,
      features: features.map((f) => ({
        key: f.key,
        name: f.name,
        description: f.description,
        category: f.category,
      })),
      topUps,
      creditRates: this.publicRates(config),
    };
  }

  @Get('plans/available')
  @UseGuards(JwtGuard)
  async availablePlans(@Req() req: any) {
    const userId = req.user.userId;
    const [plans, sub] = await Promise.all([
      this.plans.listPlansForUser(userId),
      this.subscriptions.getActiveSubscription(userId),
    ]);
    return {
      current: this.subscriptions.serialize(sub),
      plans: plans.map((p) => ({
        ...p,
        isCurrent: p.id === sub.planId,
        relation:
          p.id === sub.planId
            ? 'current'
            : p.type === 'FREE'
              ? sub.planType === 'FREE'
                ? 'current'
                : 'downgrade'
              : p.customPricing
                ? 'contact'
                : sub.planType === 'FREE' ||
                    (p.version?.pricePaise ?? 0) > sub.pricePaise
                  ? 'upgrade'
                  : 'downgrade',
      })),
    };
  }

  @Get('plans/:id')
  async publicPlan(@Param('id') id: string) {
    const plan = await this.plans.getPlan(id, { publicOnly: true });
    return (await this.plans.listPublicPlans()).find((p) => p.id === plan.id);
  }

  @Get('topups')
  async publicTopUps() {
    return this.topUps.listActive();
  }

  @Get('credit-rates')
  async creditRates() {
    return this.publicRates(await this.config.get());
  }

  private publicRates(
    config: Awaited<ReturnType<BillingConfigService['get']>>,
  ) {
    return {
      audioCreditsPerMinute: config.audioCreditsPerMinute,
      videoCreditsPerMinute: config.videoCreditsPerMinute,
      screenShareCreditsPerMinute: config.screenShareCreditsPerMinute,
      taxPercent: config.taxPercent,
      topUpExpiryPolicy: config.topUpExpiryPolicy,
      topUpExpiryDays: config.topUpExpiryDays,
    };
  }

  // ── Subscription ────────────────────────────────────
  @Get('subscription')
  @UseGuards(JwtGuard)
  async subscription(@Req() req: any) {
    return this.subscriptions.getOverview(req.user.userId);
  }

  /** Everything the Billing overview screen needs in one call. */
  @Get('overview')
  @UseGuards(JwtGuard)
  async overview(@Req() req: any) {
    const userId = req.user.userId;
    const overview = await this.subscriptions.getOverview(userId);
    const [wallet, usage, customPlan] = await Promise.all([
      this.credits.getSummary(userId, overview.subscription.currentPeriodStart),
      this.usageBilling.getCurrentUsage(userId),
      this.customPlans.getCustomerRequest(userId),
    ]);
    return { ...overview, wallet, usage, customPlan };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('subscription/cancel')
  @UseGuards(JwtGuard)
  async cancel(@Req() req: any) {
    return this.subscriptions.serialize(
      await this.subscriptions.cancel(req.user.userId),
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('subscription/resume')
  @UseGuards(JwtGuard)
  async resume(@Req() req: any) {
    return this.subscriptions.serialize(
      await this.subscriptions.resume(req.user.userId),
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('subscription/downgrade')
  @UseGuards(JwtGuard)
  async downgrade(@Req() req: any, @Body() body: { planId: string }) {
    return this.subscriptions.serialize(
      await this.subscriptions.scheduleDowngrade(req.user.userId, body?.planId),
    );
  }

  // ── Checkout ────────────────────────────────────────
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('checkout/quote')
  @UseGuards(JwtGuard)
  async quote(@Req() req: any, @Body() body: CheckoutRequest) {
    return this.checkout.quote(req.user.userId, body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('checkout')
  @UseGuards(JwtGuard)
  async startCheckout(@Req() req: any, @Body() body: CheckoutRequest) {
    return this.checkout.start(req.user.userId, body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('subscriptions/checkout')
  @UseGuards(JwtGuard)
  async subscriptionCheckout(
    @Req() req: any,
    @Body() body: { planId: string },
  ) {
    return this.checkout.start(req.user.userId, {
      kind: 'plan',
      planId: body?.planId,
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('subscription/upgrade')
  @UseGuards(JwtGuard)
  async upgrade(@Req() req: any, @Body() body: { planId: string }) {
    return this.checkout.start(req.user.userId, {
      kind: 'plan',
      planId: body?.planId,
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('subscription/renew')
  @UseGuards(JwtGuard)
  async renew(@Req() req: any) {
    return this.checkout.start(req.user.userId, { kind: 'renewal' });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('topups/checkout')
  @UseGuards(JwtGuard)
  async topUpCheckout(
    @Req() req: any,
    @Body() body: { topUpPackageId: string },
  ) {
    return this.checkout.start(req.user.userId, {
      kind: 'topup',
      topUpPackageId: body?.topUpPackageId,
    });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('payments/:id/verify')
  @UseGuards(JwtGuard)
  async verifyPayment(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: VerifyBody,
  ) {
    return this.checkout.verify(req.user.userId, { ...body, paymentId: id });
  }

  // Spec aliases: verify with the payment id in the body.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('subscriptions/verify')
  @UseGuards(JwtGuard)
  async verifySubscription(@Req() req: any, @Body() body: VerifyBody) {
    return this.checkout.verify(req.user.userId, {
      ...body,
      paymentId: body?.paymentId ?? '',
    });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('topups/verify')
  @UseGuards(JwtGuard)
  async verifyTopUp(@Req() req: any, @Body() body: VerifyBody) {
    return this.checkout.verify(req.user.userId, {
      ...body,
      paymentId: body?.paymentId ?? '',
    });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('payments/:id/failure')
  @UseGuards(JwtGuard)
  async paymentFailure(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: { providerPaymentId?: string; code?: string; description?: string },
  ) {
    return this.checkout.reportFailure(req.user.userId, id, body ?? {});
  }

  // ── Payments & receipts ─────────────────────────────
  @Get('payments')
  @UseGuards(JwtGuard)
  async payments(@Req() req: any, @Query('page') pageValue?: string) {
    const userId = req.user.userId;
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where = { userId, purpose: { not: 'LEGACY' as const } };
    const [total, data] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          purpose: true,
          paymentStatus: true,
          description: true,
          amount: true,
          subtotalPaise: true,
          discountPaise: true,
          taxPaise: true,
          taxPercent: true,
          currency: true,
          credits: true,
          paymentMethod: true,
          receiptNumber: true,
          failureReason: true,
          refundedPaise: true,
          paidAt: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      data: data.map((p) => ({
        ...p,
        receipt: p.receiptNumber ? receiptLabel(p.receiptNumber, p.id) : null,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  @Get('payments/:id')
  @UseGuards(JwtGuard)
  async payment(@Req() req: any, @Param('id') id: string) {
    return this.checkout.getStatus(req.user.userId, id);
  }

  @Get('receipts')
  @UseGuards(JwtGuard)
  async receipts(@Req() req: any, @Query('page') pageValue?: string) {
    const userId = req.user.userId;
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where = { userId, receiptNumber: { not: null } };
    const [total, data] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data: data.map((p) => ({
        id: p.id,
        receipt: receiptLabel(p.receiptNumber, p.id),
        purpose: p.purpose,
        description: p.description,
        status: p.paymentStatus,
        amount: p.amount,
        subtotalPaise: p.subtotalPaise,
        discountPaise: p.discountPaise,
        taxPaise: p.taxPaise,
        taxPercent: p.taxPercent,
        currency: p.currency,
        credits: p.credits,
        lineItems: p.lineItems,
        paymentMethod: p.paymentMethod,
        refundedPaise: p.refundedPaise,
        paidAt: p.paidAt,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  @Get('receipts/:id/pdf')
  @UseGuards(JwtGuard)
  async receiptPdf(
    @Req() req: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, userId: req.user.userId, receiptNumber: { not: null } },
      include: {
        user: { select: { name: true, email: true, companyName: true } },
      },
    });
    if (!payment) throw new NotFoundException('Receipt not found');
    const pdf = await this.invoicePdf.renderReceiptPdf(payment);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${receiptLabel(payment.receiptNumber, payment.id)}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }

  // ── Credits ─────────────────────────────────────────
  @Get('credits')
  @UseGuards(JwtGuard)
  async creditSummary(@Req() req: any) {
    const sub = await this.subscriptions.getActiveSubscription(req.user.userId);
    return this.credits.getSummary(req.user.userId, sub.currentPeriodStart);
  }

  @Get('credits/history')
  @UseGuards(JwtGuard)
  async creditHistory(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('type') type?: string,
  ) {
    return this.credits.getHistory(req.user.userId, { page, type });
  }

  // ── Custom plans ────────────────────────────────────
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('custom-plan/request')
  @UseGuards(JwtGuard)
  async requestCustomPlan(@Req() req: any) {
    return this.customPlans.requestCustomPlan(req.user.userId);
  }

  @Get('custom-plan/request')
  @UseGuards(JwtGuard)
  async customPlanRequest(@Req() req: any) {
    return this.customPlans.getCustomerRequest(req.user.userId);
  }

  @Get('offers')
  @UseGuards(JwtGuard)
  async offers(@Req() req: any) {
    return this.customPlans.listCustomerOffers(req.user.userId);
  }

  @Get('offers/:id')
  @UseGuards(JwtGuard)
  async offer(@Req() req: any, @Param('id') id: string) {
    return this.customPlans.getCustomerOffer(req.user.userId, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('offers/:id/accept')
  @UseGuards(JwtGuard)
  async acceptOffer(@Req() req: any, @Param('id') id: string) {
    return this.checkout.start(req.user.userId, { kind: 'offer', offerId: id });
  }

  // ── Payment methods ─────────────────────────────────
  // Payment is chosen at checkout (cards, UPI, netbanking via Razorpay).
  // These list/remove cards saved earlier; nothing here can charge them.
  @Get('payment-methods')
  @UseGuards(JwtGuard)
  async paymentMethods(@Req() req: any) {
    return this.billingService.getPaymentMethods(req.user.userId);
  }

  @Delete('payment-method/:id')
  @UseGuards(JwtGuard)
  async removePaymentMethod(@Req() req: any, @Param('id') id: string) {
    return this.billingService.removePaymentMethod(req.user.userId, id);
  }

  // ── Usage (participant-minutes → credits) ───────────
  @Get('current-usage')
  @UseGuards(JwtGuard)
  async currentUsage(@Req() req: any) {
    return this.usageBilling.getCurrentUsage(req.user.userId);
  }

  @Get('call-usage')
  @UseGuards(JwtGuard)
  async callUsage(@Req() req: any, @Query('page') page?: string) {
    return this.usageBilling.getCallUsage(req.user.userId, page);
  }

  @Get('usage-history')
  @UseGuards(JwtGuard)
  async usageHistory(@Req() req: any, @Query('page') page?: string) {
    return this.usageBilling.getUsageHistory(req.user.userId, page);
  }

  @Get('call/:id/segments')
  @UseGuards(JwtGuard)
  async callSegments(@Req() req: any, @Param('id') callId: string) {
    await this.usageBilling.assertCallOwner(callId, req.user.userId);
    const [segments, rated, config] = await Promise.all([
      this.segmentService.getSegmentsForCall(callId),
      this.ratingEngine.rateCall(callId),
      this.config.get(),
    ]);
    const credits = this.config.creditsFor(
      {
        audioMinutes: rated.totals.audioMins,
        videoMinutes: rated.totals.videoMins,
        screenShareMinutes: rated.totals.screenShareMins,
      },
      config,
    );
    // rateCall reads the same segments in the same order; attach each
    // segment's per-participant minutes for display.
    return {
      callId,
      segments: segments
        .map((s) => omit(s, 'costPaise'))
        .map((seg, i) => ({
          ...seg,
          audioMinutes: rated.segments[i]?.audioMins ?? seg.audioMinutes,
          videoMinutes: rated.segments[i]?.videoMins ?? seg.videoMinutes,
          screenShareMinutes:
            rated.segments[i]?.screenShareMins ?? seg.screenShareMinutes,
        })),
      totals: {
        audioMins: rated.totals.audioMins,
        videoMins: rated.totals.videoMins,
        screenShareMins: rated.totals.screenShareMins,
        credits,
      },
    };
  }

  // ── Legacy pay-as-you-go invoices (read-only history) ──
  @Get('invoices')
  @UseGuards(JwtGuard)
  async invoices(@Req() req: any) {
    return this.billingService.getInvoices(req.user.userId);
  }

  @Get('usage-invoices')
  @UseGuards(JwtGuard)
  async usageInvoices(@Req() req: any, @Query('page') page?: string) {
    return this.invoiceBilling.getInvoicesForUser(req.user.userId, page);
  }

  @Get('usage-invoices/:id')
  @UseGuards(JwtGuard)
  async usageInvoiceDetail(@Req() req: any, @Param('id') id: string) {
    return this.invoiceBilling.getInvoiceForUser(req.user.userId, id);
  }

  @Get('usage-invoices/:id/pdf')
  @UseGuards(JwtGuard)
  async usageInvoicePdf(
    @Req() req: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const invoice = await this.invoiceBilling.getInvoiceForPdf(
      req.user.userId,
      id,
    );
    const pdf = await this.invoicePdf.renderInvoicePdf(invoice);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoiceNumber ?? invoice.id}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }

  // ── Provider webhook ────────────────────────────────
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<any>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    return this.webhooks.handle(req.rawBody, headers);
  }
}
