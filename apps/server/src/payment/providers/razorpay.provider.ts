import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  PaymentProvider,
  ProviderCheckout,
  ProviderCheckoutInput,
  ProviderEventType,
  ProviderPayment,
  ProviderPaymentState,
  ProviderPaymentVerification,
  ProviderRecurringPlanInput,
  ProviderSubscription,
  ProviderSubscriptionInput,
  ProviderWebhookEvent,
} from './payment-provider';

/** Constant-time hex digest comparison. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export const MOCK_SIGNATURE = 'mock_signature';

/**
 * Razorpay one-time payments (Orders + Checkout + signature verification).
 *
 * Without RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET (local/dev only — production
 * refuses to boot, see RazorpayPaymentService) it runs in mock mode: orders
 * are simulated in memory and a completion proof is accepted only when it
 * carries MOCK_SIGNATURE for a mock order this process created.
 */
@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';
  private readonly logger = new Logger(RazorpayProvider.name);
  private readonly razorpay: any;
  private readonly mockOrders = new Map<
    string,
    { amountPaise: number; currency: string }
  >();
  private readonly mockPlans = new Map<
    string,
    { amountPaise: number; currency: string }
  >();
  private readonly mockSubscriptions = new Map<
    string,
    { providerPlanId: string; startAt: Date | null }
  >();

  constructor() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (keyId && keySecret) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Razorpay = require('razorpay');
      this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are required in production.',
        );
      }
      this.razorpay = null;
    }
  }

  isConfigured(): boolean {
    return !!this.razorpay;
  }

  async createCheckout(
    input: ProviderCheckoutInput,
  ): Promise<ProviderCheckout> {
    if (!this.razorpay) {
      const providerOrderId = `order_mock_${input.paymentId.replace(/-/g, '').slice(0, 20)}`;
      this.mockOrders.set(providerOrderId, {
        amountPaise: input.amountPaise,
        currency: input.currency,
      });
      return {
        provider: this.name,
        providerOrderId,
        publicKey: null,
        amountPaise: input.amountPaise,
        currency: input.currency,
        mock: true,
      };
    }

    const order = await this.razorpay.orders.create({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.paymentId.slice(0, 40),
      payment_capture: 1,
      notes: input.notes,
    });
    return {
      provider: this.name,
      providerOrderId: order.id,
      publicKey: process.env.RAZORPAY_KEY_ID ?? null,
      amountPaise: order.amount,
      currency: (order.currency || input.currency).toUpperCase(),
      mock: false,
    };
  }

  async verifyPayment(
    input: ProviderPaymentVerification,
  ): Promise<ProviderPayment | null> {
    if (!this.razorpay) {
      const order = this.mockOrders.get(input.providerOrderId);
      if (!order || input.signature !== MOCK_SIGNATURE) return null;
      return {
        providerPaymentId: input.providerPaymentId,
        providerOrderId: input.providerOrderId,
        status: 'captured',
        amountPaise: order.amountPaise,
        currency: order.currency,
        method: 'mock',
      };
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
      .update(`${input.providerOrderId}|${input.providerPaymentId}`)
      .digest('hex');
    if (!safeEqual(expected, input.signature)) return null;

    let payment = await this.getPayment(input.providerPaymentId);
    if (payment.providerOrderId !== input.providerOrderId) return null;
    // Orders are created with auto-capture, but the payment can still be
    // `authorized` for a moment right after Checkout closes.
    if (payment.status === 'authorized') {
      try {
        await this.razorpay.payments.capture(
          input.providerPaymentId,
          payment.amountPaise,
          payment.currency,
        );
        payment = { ...payment, status: 'captured' };
      } catch (e: any) {
        this.logger.warn(
          `Capture of ${input.providerPaymentId} failed: ${e?.error?.description ?? e?.message}`,
        );
        payment = await this.getPayment(input.providerPaymentId);
      }
    }
    return payment;
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    if (!this.razorpay) throw new Error('Payment provider is not configured.');
    const p = await this.razorpay.payments.fetch(providerPaymentId);
    return this.toProviderPayment(p);
  }

  async refundPayment(providerPaymentId: string, amountPaise?: number) {
    if (!this.razorpay) {
      return {
        providerRefundId: `rfnd_mock_${Date.now()}`,
        amountPaise: amountPaise ?? 0,
      };
    }
    const refund = await this.razorpay.payments.refund(
      providerPaymentId,
      amountPaise ? { amount: amountPaise } : {},
    );
    return { providerRefundId: refund.id, amountPaise: refund.amount };
  }

  async parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<ProviderWebhookEvent> {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set.');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const signature = (headers['x-razorpay-signature'] || '').replace(
      /^v1_/,
      '',
    );
    if (!safeEqual(expected, signature))
      throw new Error('Invalid Razorpay webhook signature.');

    let body: Record<string, any>;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('Invalid webhook payload.');
    }

    const rawType: string = body.event ?? 'unknown';
    const known: ProviderEventType[] = [
      'payment.captured',
      'payment.authorized',
      'payment.failed',
      'order.paid',
      'refund.processed',
      'payment.dispute.created',
      'subscription.authenticated',
      'subscription.activated',
      'subscription.charged',
      'subscription.pending',
      'subscription.halted',
      'subscription.cancelled',
      'subscription.completed',
    ];
    const paymentEntity = body.payload?.payment?.entity;
    const subscriptionEntity = body.payload?.subscription?.entity;
    const refundEntity = body.payload?.refund?.entity;
    // Razorpay sends a unique id per event in x-razorpay-event-id; fall back
    // to a content hash so a redelivered body still dedupes.
    const eventId =
      headers['x-razorpay-event-id'] ||
      crypto.createHash('sha256').update(rawBody).digest('hex');

    return {
      eventId,
      type: (known as string[]).includes(rawType)
        ? (rawType as ProviderEventType)
        : 'unknown',
      rawType,
      payment: paymentEntity ? this.toProviderPayment(paymentEntity) : null,
      subscription: subscriptionEntity
        ? this.toProviderSubscription(subscriptionEntity)
        : null,
      refund: refundEntity
        ? {
            providerRefundId: refundEntity.id,
            providerPaymentId: refundEntity.payment_id,
            amountPaise: refundEntity.amount ?? 0,
          }
        : null,
      raw: body,
    };
  }

  // ── Recurring mandates (Razorpay Subscriptions) ─────────────────────
  async createRecurringPlan(
    input: ProviderRecurringPlanInput,
  ): Promise<string> {
    if (!this.razorpay) {
      const id = `plan_mock_${input.amountPaise}_${input.billingInterval}_${input.intervalCount}`;
      this.mockPlans.set(id, {
        amountPaise: input.amountPaise,
        currency: input.currency,
      });
      return id;
    }
    const period =
      input.billingInterval === 'YEAR'
        ? 'yearly'
        : input.billingInterval === 'CUSTOM'
          ? 'daily'
          : 'monthly';
    const plan = await this.razorpay.plans.create({
      period,
      interval: Math.max(1, input.intervalCount),
      item: {
        name: input.name.slice(0, 80),
        amount: input.amountPaise,
        currency: input.currency,
      },
    });
    return plan.id;
  }

  async createSubscription(
    input: ProviderSubscriptionInput,
  ): Promise<ProviderSubscription> {
    if (!this.razorpay) {
      const id = `sub_mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      this.mockSubscriptions.set(id, {
        providerPlanId: input.providerPlanId,
        startAt: input.startAt ?? null,
      });
      return {
        providerSubscriptionId: id,
        status: 'created',
        currentEnd: null,
      };
    }
    const sub = await this.razorpay.subscriptions.create({
      plan_id: input.providerPlanId,
      // Razorpay needs a finite cycle count; this is effectively "until cancelled".
      total_count: 120,
      customer_notify: 1,
      ...(input.startAt
        ? { start_at: Math.floor(input.startAt.getTime() / 1000) }
        : {}),
      notes: input.notes,
    });
    return this.toProviderSubscription(sub);
  }

  async verifySubscriptionPayment(input: {
    providerSubscriptionId: string;
    providerPaymentId: string;
    signature: string;
  }): Promise<ProviderPayment | null> {
    if (!this.razorpay) {
      const sub = this.mockSubscriptions.get(input.providerSubscriptionId);
      if (!sub || input.signature !== MOCK_SIGNATURE) return null;
      const plan = this.mockPlans.get(sub.providerPlanId);
      return {
        providerPaymentId: input.providerPaymentId,
        providerOrderId: null,
        // A future-start mandate only authorizes; nothing is charged yet.
        status: sub.startAt ? 'authorized' : 'captured',
        amountPaise: sub.startAt ? 0 : (plan?.amountPaise ?? 0),
        currency: plan?.currency ?? 'INR',
        method: 'mock',
      };
    }
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
      .update(`${input.providerPaymentId}|${input.providerSubscriptionId}`)
      .digest('hex');
    if (!safeEqual(expected, input.signature)) return null;
    return this.getPayment(input.providerPaymentId);
  }

  async changeSubscriptionPlan(
    providerSubscriptionId: string,
    providerPlanId: string,
  ) {
    if (!this.razorpay) {
      const sub = this.mockSubscriptions.get(providerSubscriptionId);
      if (sub) sub.providerPlanId = providerPlanId;
      return;
    }
    await this.razorpay.subscriptions.update(providerSubscriptionId, {
      plan_id: providerPlanId,
      schedule_change_at: 'cycle_end',
      customer_notify: 1,
    });
  }

  async cancelSubscription(
    providerSubscriptionId: string,
    atCycleEnd: boolean,
  ) {
    if (!this.razorpay) {
      this.mockSubscriptions.delete(providerSubscriptionId);
      return;
    }
    await this.razorpay.subscriptions.cancel(
      providerSubscriptionId,
      atCycleEnd,
    );
  }

  private toProviderSubscription(sub: any): ProviderSubscription {
    return {
      providerSubscriptionId: sub.id,
      status: sub.status ?? 'created',
      currentEnd: sub.current_end
        ? new Date(Number(sub.current_end) * 1000)
        : null,
    };
  }

  private toProviderPayment(p: any): ProviderPayment {
    const map: Record<string, ProviderPaymentState> = {
      captured: 'captured',
      authorized: 'authorized',
      failed: 'failed',
      refunded: 'refunded',
      created: 'pending',
    };
    return {
      providerPaymentId: p.id,
      providerOrderId: p.order_id ?? null,
      status: map[p.status] ?? 'pending',
      amountPaise: p.amount ?? 0,
      currency: (p.currency || 'INR').toUpperCase(),
      method: p.method ?? null,
      errorCode: p.error_code ?? null,
      errorDescription: p.error_description ?? null,
    };
  }
}
