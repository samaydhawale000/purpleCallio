import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AutoTopUpAttemptStatus, AutoTopUpMandateStatus, PaymentPurpose, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_PROVIDER } from '../../payment/providers/payment-provider';
import type { PaymentProvider, ProviderPayment } from '../../payment/providers/payment-provider';
import { CreditService } from '../credits/credit.service';
import { BillingFulfillmentService } from '../checkout/fulfillment.service';
import { BillingConfigService } from '../billing-config.service';
import { CheckoutService } from '../checkout/checkout.service';

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const consentVersion = 'auto-topup-emandate-v1';

/** The merchant-owned state machine around Razorpay Charge-at-Will. */
@Injectable()
export class AutoTopUpService {
  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
    private credits: CreditService,
    private checkout: CheckoutService,
    private fulfillment: BillingFulfillmentService,
    private config: BillingConfigService,
  ) {}

  private availability() {
    const configured = this.provider.isConfigured() && process.env.RAZORPAY_CHARGE_AT_WILL_ENABLED === 'true';
    const liveAllowed = process.env.NODE_ENV !== 'production' || process.env.RAZORPAY_CHARGE_AT_WILL_LIVE_ENABLED === 'true';
    const authType = process.env.RAZORPAY_EMANDATE_AUTH_TYPE;
    return { available: configured && liveAllowed && !!authType, reason: !configured ? 'Razorpay test credentials and RAZORPAY_CHARGE_AT_WILL_ENABLED=true are required.' : !liveAllowed ? 'Live charging remains disabled pending verified test-mode flow.' : !authType ? 'Set the account-approved RAZORPAY_EMANDATE_AUTH_TYPE before accepting authorizations.' : null };
  }

  /**
   * Confirms a PENDING mandate by asking Razorpay directly, so Auto Top-Up
   * doesn't depend on the token webhook arriving (it can't reach a local
   * server and may be delayed). The webhook still works as before.
   */
  async syncMandate(userId: string) {
    const s = await this.prisma.autoTopUpSetting.findUnique({ where: { userId } });
    if (!s || s.mandateStatus !== AutoTopUpMandateStatus.PENDING || !s.mandateOrderId || !s.providerCustomerId) return s;
    let result;
    try {
      result = await this.provider.getMandateStatus(s.mandateOrderId, s.providerCustomerId);
    } catch {
      return s; // Provider unreachable: stay PENDING and try again next time.
    }
    if (result.status === 'pending') {
      return result.tokenId && result.tokenId !== s.providerTokenId
        ? this.prisma.autoTopUpSetting.update({ where: { id: s.id }, data: { providerTokenId: result.tokenId } })
        : s;
    }
    const where = { id: s.id, mandateStatus: AutoTopUpMandateStatus.PENDING, mandateOrderId: s.mandateOrderId };
    await this.prisma.autoTopUpSetting.updateMany({
      where,
      data:
        result.status === 'confirmed'
          ? { providerTokenId: result.tokenId, mandateStatus: AutoTopUpMandateStatus.ACTIVE, attentionReason: null }
          : {
              enabled: false,
              mandateStatus: result.status === 'cancelled' ? AutoTopUpMandateStatus.REVOKED : AutoTopUpMandateStatus.FAILED,
              attentionReason: 'mandate_inactive',
              attentionAt: new Date(),
            },
    });
    return this.prisma.autoTopUpSetting.findUnique({ where: { userId } });
  }

  async get(userId: string) {
    await this.syncMandate(userId);
    const [setting, wallet] = await Promise.all([
      this.prisma.autoTopUpSetting.findUnique({ where: { userId } }), this.credits.getSummary(userId),
    ]);
    const attempts = setting ? await this.prisma.autoTopUpAttempt.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }) : [];
    const spent = setting ? await this.prisma.autoTopUpAttempt.aggregate({ where: { userId, monthKey: monthKey(), status: { in: [AutoTopUpAttemptStatus.PENDING, AutoTopUpAttemptStatus.PROCESSING, AutoTopUpAttemptStatus.SUCCEEDED] } }, _sum: { totalPaise: true } }) : null;
    return { setting, attempts, wallet, availability: this.availability(), month: { key: monthKey(), committedAndInFlightPaise: spent?._sum.totalPaise ?? 0 } };
  }

  async save(userId: string, input: { thresholdCredits: number; amountPaise: number; monthlyLimitPaise: number; currency?: string }) {
    if (![input.thresholdCredits, input.amountPaise, input.monthlyLimitPaise].every(Number.isSafeInteger) || input.thresholdCredits < 0 || input.amountPaise <= 0 || input.monthlyLimitPaise <= 0)
      throw new BadRequestException('Auto Top-Up values must be positive whole numbers.');
    const { resolved, quote } = await this.checkout.snapshotCreditTopUp(userId, input.amountPaise, input.currency ?? 'INR');
    if (input.monthlyLimitPaise < quote.totalPaise) throw new BadRequestException('Monthly limit must cover at least one top-up including GST.');
    return this.prisma.autoTopUpSetting.upsert({ where: { userId }, create: { userId, enabled: false, thresholdCredits: input.thresholdCredits, amountPaise: input.amountPaise, monthlyLimitPaise: input.monthlyLimitPaise, currency: resolved.currency }, update: { thresholdCredits: input.thresholdCredits, amountPaise: input.amountPaise, monthlyLimitPaise: input.monthlyLimitPaise, currency: resolved.currency, attentionReason: null } });
  }

  async startMandate(userId: string, consent: boolean, version?: string) {
    if (!consent || version !== consentVersion) throw new BadRequestException('Explicit current Auto Top-Up consent is required.');
    const availability = this.availability(); if (!availability.available) throw new BadRequestException(availability.reason!);
    const setting = await this.prisma.autoTopUpSetting.findUnique({ where: { userId } });
    if (!setting) throw new BadRequestException('Save Auto Top-Up settings first.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, phone: true } });
    if (!user.email || !user.phone) throw new BadRequestException('Add a verified email address and phone number before authorizing Auto Top-Up.');
    const { quote } = await this.checkout.snapshotCreditTopUp(userId, setting.amountPaise, setting.currency);
    const maxAmount = Math.min(setting.monthlyLimitPaise, Math.max(quote.totalPaise, setting.mandateMaxAmountPaise ?? 0));
    const auth = await this.provider.createChargeAtWillAuthorization({ authorizationId: setting.id, customer: { name: user.name, email: user.email, contact: user.phone }, currency: setting.currency, maxAmountPaise: maxAmount, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60_000), authType: process.env.RAZORPAY_EMANDATE_AUTH_TYPE!, notes: { autoTopUpSettingId: setting.id, userId } });
    const updated = await this.prisma.autoTopUpSetting.update({ where: { userId }, data: { enabled: false, consentAt: new Date(), consentVersion: version, providerCustomerId: auth.providerCustomerId, mandateOrderId: auth.providerOrderId, mandateMaxAmountPaise: maxAmount, mandateExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60_000), mandateMethod: process.env.RAZORPAY_EMANDATE_AUTH_TYPE, mandateStatus: AutoTopUpMandateStatus.PENDING, attentionReason: null } });
    return { setting: updated, providerOrderId: auth.providerOrderId, customerId: auth.providerCustomerId, publicKey: auth.publicKey, currency: auth.currency, recurring: true };
  }

  async disable(userId: string) { return this.prisma.autoTopUpSetting.update({ where: { userId }, data: { enabled: false, disabledReason: 'customer_disabled' } }); }
  async enable(userId: string) {
    const s = await this.prisma.autoTopUpSetting.findUniqueOrThrow({ where: { userId } });
    if (s.mandateStatus !== AutoTopUpMandateStatus.ACTIVE || !s.providerTokenId || !s.consentAt) throw new BadRequestException('A confirmed Razorpay mandate is required before enabling Auto Top-Up.');
    if (s.mandateExpiresAt && s.mandateExpiresAt <= new Date()) throw new BadRequestException('The mandate has expired. Please authorize a new one.');
    return this.prisma.autoTopUpSetting.update({ where: { userId }, data: { enabled: true, disabledReason: null, attentionReason: null } });
  }

  /** Called only from a verified Razorpay token webhook. */
  async onTokenEvent(rawType: string, raw: Record<string, any>) {
    const payment = raw.payload?.payment?.entity;
    const token = raw.payload?.token?.entity ?? payment?.token;
    const orderId = payment?.order_id ?? token?.order_id;
    const setting = orderId ? await this.prisma.autoTopUpSetting.findFirst({ where: { mandateOrderId: orderId } }) : null;
    if (!setting) return;
    const active = rawType === 'token.confirmed';
    await this.prisma.autoTopUpSetting.update({ where: { id: setting.id }, data: active ? { providerTokenId: token?.id ?? payment?.token_id ?? setting.providerTokenId, mandateStatus: AutoTopUpMandateStatus.ACTIVE, attentionReason: null } : { enabled: false, mandateStatus: rawType === 'token.cancelled' ? AutoTopUpMandateStatus.REVOKED : AutoTopUpMandateStatus.FAILED, attentionReason: 'mandate_inactive', attentionAt: new Date() } });
  }

  /** A lock plus unique idempotency key makes concurrent low-balance events safe. */
  async trigger(userId: string) {
    const s = await this.prisma.autoTopUpSetting.findUnique({ where: { userId } });
    if (!s?.enabled || s.mandateStatus !== AutoTopUpMandateStatus.ACTIVE || !s.providerTokenId || !s.providerCustomerId) return { skipped: true };
    const wallet = await this.credits.getSummary(userId); if (wallet.available > s.thresholdCredits) return { skipped: true };
    if (s.mandateExpiresAt && s.mandateExpiresAt <= new Date()) { await this.prisma.autoTopUpSetting.update({ where: { id: s.id }, data: { enabled: false, attentionReason: 'mandate_inactive' } }); return { skipped: true }; }
    const config = await this.config.get();
    const previousFailure = await this.prisma.autoTopUpAttempt.findFirst({ where: { settingId: s.id, status: AutoTopUpAttemptStatus.FAILED }, orderBy: { completedAt: 'desc' } });
    if (previousFailure?.nextRetryAt && previousFailure.nextRetryAt > new Date()) return { skipped: true, reason: 'retry_pending' };
    if (previousFailure && previousFailure.retryCount >= config.autoTopUpMaxRetries) return this.attention(s.id, 'payment_failed');
    const { resolved, quote } = await this.checkout.snapshotCreditTopUp(userId, s.amountPaise, s.currency);
    if ((s.mandateMaxAmountPaise ?? 0) < quote.totalPaise) return this.attention(s.id, 'mandate_limit');
    const key = `${s.id}:${monthKey()}:${Math.floor(Date.now() / 60_000)}`;
    try {
      const attempt = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "AutoTopUpSetting" WHERE "id" = ${s.id} FOR UPDATE`;
        const fresh = await tx.autoTopUpSetting.findUniqueOrThrow({ where: { id: s.id } });
        if (!fresh.enabled || fresh.mandateStatus !== AutoTopUpMandateStatus.ACTIVE) throw new BadRequestException('Auto Top-Up is no longer enabled.');
        // A bank response can be asynchronous. Never open another debit while
        // the preceding one is still undecided.
        const inFlight = await tx.autoTopUpAttempt.findFirst({ where: { settingId: s.id, status: { in: [AutoTopUpAttemptStatus.PENDING, AutoTopUpAttemptStatus.PROCESSING] } } });
        if (inFlight) throw Object.assign(new Error('Auto Top-Up already in progress.'), { code: 'AUTO_TOPUP_IN_FLIGHT' });
        const total = await tx.autoTopUpAttempt.aggregate({ where: { settingId: s.id, monthKey: monthKey(), status: { in: [AutoTopUpAttemptStatus.PENDING, AutoTopUpAttemptStatus.PROCESSING, AutoTopUpAttemptStatus.SUCCEEDED] } }, _sum: { totalPaise: true } });
        if ((total._sum.totalPaise ?? 0) + quote.totalPaise > s.monthlyLimitPaise) throw new BadRequestException('Monthly Auto Top-Up limit reached.');
        const payment = await tx.payment.create({ data: { userId, purpose: PaymentPurpose.AUTO_TOPUP, provider: this.provider.name, amount: quote.totalPaise, subtotalPaise: quote.subtotalPaise, discountPaise: quote.discountPaise, discountPercent: quote.discountPercent, taxPercent: quote.taxPercent, taxPaise: quote.taxPaise, currency: quote.currency, credits: resolved.credits, creditPricingVersionId: resolved.creditPricingVersionId, creditPricePaise: resolved.creditPricePaise, creditExpiryAt: resolved.creditExpiryAt, description: `Automatic ${resolved.description}`, lineItems: quote.lineItems } });
        return tx.autoTopUpAttempt.create({ data: { userId, settingId: s.id, paymentId: payment.id, idempotencyKey: key, status: AutoTopUpAttemptStatus.PROCESSING, amountPaise: s.amountPaise, taxPaise: quote.taxPaise, totalPaise: quote.totalPaise, credits: resolved.credits, currency: quote.currency, creditPricingVersionId: resolved.creditPricingVersionId!, creditPricePaise: resolved.creditPricePaise!, triggerBalance: wallet.available, monthKey: monthKey(), retryOfId: previousFailure?.id, retryCount: previousFailure ? previousFailure.retryCount + 1 : 0 }, include: { setting: true, } });
      });
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, phone: true } });
      if (!user.email || !user.phone) throw new Error('Customer contact details are missing.');
      const order = await this.provider.createCheckout({ paymentId: attempt.paymentId!, amountPaise: attempt.totalPaise, currency: attempt.currency, description: 'Auto Top-Up', notes: { paymentId: attempt.paymentId!, autoTopUpAttemptId: attempt.id } });
      await this.prisma.payment.update({ where: { id: attempt.paymentId! }, data: { providerOrderId: order.providerOrderId } });
      const charge = await this.provider.createChargeAtWillPayment({ paymentId: attempt.paymentId!, providerOrderId: order.providerOrderId, providerCustomerId: attempt.setting.providerCustomerId!, providerTokenId: attempt.setting.providerTokenId!, amountPaise: attempt.totalPaise, currency: attempt.currency, email: user.email, contact: user.phone, description: 'PurpleCallio Auto Top-Up', notes: { paymentId: attempt.paymentId!, autoTopUpAttemptId: attempt.id } });
      await this.prisma.autoTopUpAttempt.update({ where: { id: attempt.id }, data: { providerPaymentId: charge.providerPaymentId } });
      if (charge.status === 'captured') {
        await this.fulfillment.fulfill(attempt.paymentId!, charge, 'webhook');
        await this.succeedAttempt(attempt.paymentId!, charge.providerPaymentId);
      } else if (charge.status === 'failed') await this.failAttempt(attempt.paymentId!, charge.errorCode ?? null, charge.errorDescription ?? 'Charge failed');
      return { attemptId: attempt.id, status: charge.status };
    } catch (e: any) { if (e?.code === 'P2002' || e?.code === 'AUTO_TOPUP_IN_FLIGHT') return { skipped: true, duplicate: true }; throw e; }
  }
  async triggerDue(limit = 100) {
    const settings = await this.prisma.autoTopUpSetting.findMany({
      where: { enabled: true, mandateStatus: AutoTopUpMandateStatus.ACTIVE },
      select: { userId: true }, take: limit,
    });
    let triggered = 0;
    for (const { userId } of settings) {
      try { const result = await this.trigger(userId); if (!result.skipped) triggered++; } catch { /* next scheduled run retries safely */ }
    }
    return triggered;
  }
  private async attention(id: string, reason: string) { await this.prisma.autoTopUpSetting.update({ where: { id }, data: { attentionReason: reason, attentionAt: new Date() } }); return { skipped: true, reason }; }
  async failAttempt(paymentId: string, code: string | null, reason: string) { const config = await this.config.get(); await this.prisma.autoTopUpAttempt.updateMany({ where: { paymentId, status: { not: AutoTopUpAttemptStatus.SUCCEEDED } }, data: { status: AutoTopUpAttemptStatus.FAILED, failureCode: code, failureReason: reason.slice(0, 300), completedAt: new Date(), nextRetryAt: new Date(Date.now() + config.autoTopUpRetryDelayHours * 3_600_000) } }); }
  async succeedAttempt(paymentId: string, providerPaymentId: string) { const a = await this.prisma.autoTopUpAttempt.findFirst({ where: { paymentId } }); if (!a) return; await this.prisma.$transaction([this.prisma.autoTopUpAttempt.update({ where: { id: a.id }, data: { status: AutoTopUpAttemptStatus.SUCCEEDED, providerPaymentId, completedAt: new Date() } }), this.prisma.autoTopUpSetting.update({ where: { id: a.settingId }, data: { lastSucceededAt: new Date(), attentionReason: null } })]); }

  async onPaymentEvent(payment: ProviderPayment) {
    const local = payment.providerOrderId ? await this.prisma.payment.findUnique({ where: { providerOrderId: payment.providerOrderId } }) : null;
    if (!local || local.purpose !== PaymentPurpose.AUTO_TOPUP) return false;
    if (payment.status === 'captured') {
      await this.fulfillment.fulfill(local.id, payment, 'webhook');
      await this.succeedAttempt(local.id, payment.providerPaymentId);
    } else if (payment.status === 'failed') {
      await this.fulfillment.markFailed(local.id, payment, payment.errorDescription ?? 'Charge failed');
      await this.failAttempt(local.id, payment.errorCode ?? null, payment.errorDescription ?? 'Charge failed');
      const a = await this.prisma.autoTopUpAttempt.findFirst({ where: { paymentId: local.id } });
      if (a) await this.attention(a.settingId, 'payment_failed');
    }
    return true;
  }
}
