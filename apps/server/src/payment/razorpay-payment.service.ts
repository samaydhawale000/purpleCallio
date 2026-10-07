import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  PAYMENT_SERVICE,
  PaymentService,
  CreateCustomerInput,
  CreateCheckoutInput,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  SubscriptionResult,
  InvoiceResult,
  PaymentMethodResult,
  CheckoutResult,
  TopUpResult,
  SetupIntentResult,
  PaymentIntentResult,
} from './payment.service';

/**
 * Razorpay implementation of the PaymentService interface.
 *
 * If RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set, the service runs in
 * "mock" mode: every method returns simulated data so the rest of the
 * platform is still fully testable without payment credentials.
 *
 * Saved-card flow (no Stripe-style SetupIntents):
 *  1. createSetupIntent() → creates a ₹1 card-mandate authorisation order
 *     (order_id) which the frontend uses to open the Razorpay Checkout modal
 *     with recurring = true.
 *  2. attachPaymentMethod() → the Checkout handler returns a card token
 *     (token_xxx) + card metadata; we persist them on the User. This method
 *     is a no-op for Razorpay (the token is already created server-side).
 *  3. createPaymentIntent() → charges the saved card token directly via
 *     POST /v1/payments.
 */
@Injectable()
export class RazorpayPaymentService implements PaymentService {
  private readonly logger = new Logger(RazorpayPaymentService.name);
  private readonly razorpay: any;

  constructor() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (keyId && keySecret) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Razorpay = require('razorpay');
      this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      if (process.env.NODE_ENV === 'production' && !webhookSecret) {
        // Payments can be taken but incoming webhooks (payment confirmation,
        // failures, refunds) could never be verified — that's a silent
        // integrity hole, not something to boot into.
        throw new Error(
          'RAZORPAY_WEBHOOK_SECRET is not set. Refusing to start in production without it.',
        );
      }
    } else if (process.env.NODE_ENV === 'production') {
      // Fail closed: a production deploy must never silently fall back to
      // mock billing just because credentials weren't set. That would let a
      // real customer interact with a fake payment flow.
      throw new Error(
        'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set. Refusing to start in production without real payment credentials.',
      );
    } else {
      this.razorpay = null;
      this.logger.warn(
        'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — running payment service in mock mode.',
      );
    }
  }

  isConfigured(): boolean {
    return !!this.razorpay;
  }

  private assertConfigured() {
    if (!this.razorpay) {
      throw new Error(
        'Payment provider is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      );
    }
  }

  async createCustomer(input: CreateCustomerInput): Promise<string> {
    this.assertConfigured();
    const customer = await this.razorpay.customers.create({
      email: input.email,
      name: input.name || undefined,
      contact: input.contact || undefined,
      notes: { userId: input.userId },
    });
    return customer.id;
  }

  async customerExists(customerId: string): Promise<boolean> {
    this.assertConfigured();
    try {
      await this.razorpay.customers.fetch(customerId);
      return true;
    } catch (e: any) {
      // Razorpay answers 404 for malformed ids and 400 "The id provided does
      // not exist" for well-formed ids from another account/mode.
      const description = e?.error?.description ?? '';
      if (e?.statusCode === 404 || (e?.statusCode === 400 && /does not exist/i.test(description))) {
        return false;
      }
      throw e;
    }
  }

  /**
   * Razorpay validates the *customer's* contact field before authorising a
   * recurring card mandate for them ("The contact field is required for
   * recurring links") — createCustomer alone isn't enough for customers
   * created before a phone number was on file.
   */
  async updateCustomerContact(customerId: string, contact: string): Promise<void> {
    this.assertConfigured();
    await this.razorpay.customers.edit(customerId, { contact });
  }

  /**
   * Creates a ₹1 order (the Razorpay minimum) flagged as a card-mandate
   * authorisation (`method: 'card'` + `token`), which is what makes Razorpay
   * actually save a reusable token against `customerId` once the frontend
   * completes Checkout with `recurring: true`. Without `customer_id` +
   * `method` + `token` here, Checkout only takes a one-off payment — no
   * token is ever created, regardless of what the frontend passes.
   *
   * `token.max_amount` is capped at ₹15,000 (Razorpay's ceiling for
   * authenticating a mandate without per-charge step-up authentication) so
   * later off-session auto-charges via createPaymentIntent don't require the
   * customer to be present. `token.expire_at` is set 10 years out as a
   * effectively-non-expiring mandate for this subscription.
   */
  async createSetupIntent(customerId: string): Promise<SetupIntentResult> {
    this.assertConfigured();
    const order = await this.razorpay.orders.create({
      amount: 100, // ₹1 minimum — Razorpay rejects amounts below ₹1.
      currency: 'INR',
      customer_id: customerId,
      method: 'card',
      token: {
        max_amount: 1500000, // ₹15,000 — Razorpay's no-AFA ceiling.
        expire_at: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60,
        frequency: 'monthly',
      },
      receipt: `setup_${Date.now()}`,
      notes: { customerId },
    });
    return { clientSecret: order.id, customerId };
  }

  /**
   * Razorpay creates the card token during Checkout, so there is nothing to
   * attach server-side. The token id + card metadata are persisted on the
   * User by the caller.
   */
  async attachPaymentMethod(_input: {
    customerId: string;
    paymentMethodId: string;
    tokenId?: string | null;
    card?: {
      brand?: string | null;
      last4?: string | null;
      expMonth?: number | null;
      expYear?: number | null;
    } | null;
    setDefault?: boolean;
  }): Promise<void> {
    // No-op for Razorpay. Token is already linked to the customer.
    return;
  }

  /**
   * Auto-charge a saved card token (off-session / server-to-server).
   *
   * Razorpay's recurring-card charge is a two-step call, not a plain
   * payments.create(): an order must exist for the charge amount, then
   * POST /payments/create/recurring debits the token against that order.
   * email + contact are mandatory on that second call even though the
   * customer isn't present — Razorpay uses them for the charge notification.
   */
  async createPaymentIntent(input: {
    customerId: string;
    amountPaise: number;
    currency?: string;
    tokenId?: string | null;
    email: string;
    contact: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntentResult> {
    this.assertConfigured();
    if (!input.tokenId) {
      throw new Error(
        'Razorpay tokenId is required to charge a saved card.',
      );
    }
    const currency = input.currency || 'INR';
    const order = await this.razorpay.orders.create({
      amount: input.amountPaise,
      currency,
      payment_capture: true,
      notes: input.metadata,
    });
    const payment = await this.razorpay.payments.createRecurringPayment({
      email: input.email,
      contact: input.contact,
      amount: input.amountPaise,
      currency,
      order_id: order.id,
      customer_id: input.customerId,
      token: input.tokenId,
      recurring: true,
      notes: input.metadata,
    });
    return {
      id: payment.id,
      clientSecret: null,
      status: payment.status,
      amount: payment.amount,
      currency: (payment.currency || 'INR').toUpperCase(),
    };
  }

  /**
   * Razorpay Checkout is a client-side modal, not a hosted URL. We create an
   * order and let the frontend open Checkout with the returned order id.
   * Used mainly by the legacy plan-selection flow; the new usage-based flow
   * uses createSetupIntent + createPaymentIntent instead.
   */
  async createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<CheckoutResult> {
    this.assertConfigured();
    const order = await this.razorpay.orders.create({
      amount: 100, // ₹1 placeholder — plan-based checkout is being retired.
      currency: 'INR',
      receipt: `checkout_${Date.now()}`,
      notes: {
        customerId: input.customerId,
        priceId: input.priceId,
        ...(input.metadata || {}),
      },
    });
    return { url: null, sessionId: order.id, mode: 'payment' };
  }

  async createSubscription(
    _input: CreateSubscriptionInput,
  ): Promise<SubscriptionResult> {
    // No subscriptions in the new usage-based model. Returning a mock keeps
    // the interface intact until the legacy plan UI is fully removed.
    this.logger.warn('createSubscription called — subscriptions are retired.');
    return {
      id: `mock_sub_${Date.now()}`,
      status: 'active',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      defaultPaymentMethod: null,
    };
  }

  async updateSubscription(
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionResult> {
    return this.getSubscription(input.subscriptionId);
  }

  async cancelSubscription(subscriptionId: string): Promise<SubscriptionResult> {
    this.logger.warn(`cancelSubscription(${subscriptionId}) — no-op (retired).`);
    return {
      id: subscriptionId,
      status: 'canceled',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      defaultPaymentMethod: null,
    };
  }

  async resumeSubscription(subscriptionId: string): Promise<void> {
    this.logger.warn(`resumeSubscription(${subscriptionId}) — no-op (retired).`);
  }

  async getSubscription(subscriptionId: string): Promise<SubscriptionResult> {
    return {
      id: subscriptionId,
      status: 'active',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      defaultPaymentMethod: null,
    };
  }

  async getInvoices(_customerId: string): Promise<InvoiceResult[]> {
    // Razorpay does not create provider invoices for token charges — we store
    // invoices in our own DB (UsageInvoice / Invoices tables).
    return [];
  }

  async getPaymentMethods(
    customerId: string,
  ): Promise<PaymentMethodResult[]> {
    this.assertConfigured();
    try {
      const res = await this.razorpay.customers.fetchTokens(customerId);
      const items: any[] = Array.isArray(res)
        ? res
        : res?.items ?? res?.data ?? [];
      return items.map((t: any) => {
        const card = t?.card || t || {};
        return {
          id: t?.token ?? t?.id ?? null,
          brand: card?.network ?? card?.brand ?? card?.issuer ?? null,
          last4: card?.last4 ?? card?.last_4 ?? card?.lastFour ?? null,
          expMonth: this.readCardNumber(card, 'expirymonth', 'expiry_month', 'expMonth'),
          expYear: this.readCardNumber(card, 'expiryyear', 'expiry_year', 'expYear'),
        };
      });
    } catch {
      return [];
    }
  }

  async getPaymentMethod(
    customerId: string,
    tokenId: string,
  ): Promise<PaymentMethodResult | null> {
    this.assertConfigured();
    try {
      const t = await this.razorpay.customers.fetchToken(customerId, tokenId);
      const card = t?.card || t || {};
      return {
        id: t?.token ?? tokenId,
        brand: card?.network ?? card?.brand ?? card?.issuer ?? null,
        last4: card?.last4 ?? card?.last_4 ?? card?.lastFour ?? null,
        expMonth: this.readCardNumber(card, 'expirymonth', 'expiry_month', 'expMonth'),
        expYear: this.readCardNumber(card, 'expiryyear', 'expiry_year', 'expYear'),
      };
    } catch {
      return null;
    }
  }

  private readCardNumber(card: any, ...keys: string[]): number | null {
    const value = keys.map((key) => card?.[key]).find((candidate) => candidate != null);
    return value != null && value !== '' ? Number(value) : null;
  }

  async deletePaymentMethod(customerId: string, tokenId: string): Promise<void> {
    this.assertConfigured();
    await this.razorpay.customers.deleteToken(customerId, tokenId);
  }

  async verifyCardSetupPayment(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): Promise<{ verified: boolean }> {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) return { verified: false };
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest('hex');
    return { verified: expected === input.signature };
  }

  /**
   * Resolves the card token the `token.request = true` Checkout flow saved
   * against this customer as a side effect of the given (already verified)
   * payment. We deliberately do NOT derive the token from the payment id —
   * a razorpay_payment_id is not a card token — instead we ask Razorpay for
   * the customer's saved tokens directly via the same fetchTokens API
   * getPaymentMethods() uses, and confirm the payment actually succeeded
   * first so a failed/pending payment can never attach a stale token.
   */
  async resolveSavedCardToken(
    customerId: string,
    paymentId: string,
  ): Promise<PaymentMethodResult> {
    this.assertConfigured();
    const payment = await this.razorpay.payments.fetch(paymentId);
    if (!payment || !['captured', 'authorized'].includes(payment.status)) {
      throw new Error(
        `Card setup payment was not successful (status: ${payment?.status ?? 'unknown'}).`,
      );
    }
    if (payment.customer_id && payment.customer_id !== customerId) {
      throw new Error('Payment does not belong to this customer.');
    }

    const tokens = await this.getPaymentMethods(customerId);
    if (!tokens.length) {
      throw new Error(
        'Razorpay has not saved a card token for this customer yet.',
      );
    }
    // fetchTokens returns the customer's saved tokens; the one just created
    // by this Checkout session is the most recent.
    const token = tokens[0];
    const paymentCard = payment?.card || {};
    return {
      ...token,
      brand: token.brand ?? paymentCard.network ?? paymentCard.brand ?? paymentCard.issuer ?? null,
      last4: token.last4 ?? paymentCard.last4 ?? paymentCard.last_4 ?? null,
      expMonth: token.expMonth ?? this.readCardNumber(paymentCard, 'expirymonth', 'expiry_month', 'expMonth'),
      expYear: token.expYear ?? this.readCardNumber(paymentCard, 'expiryyear', 'expiry_year', 'expYear'),
    };
  }

  async createPortalSession(_customerId: string): Promise<string> {
    const base = process.env.APP_URL || 'http://localhost:3000';
    return `${base}/dashboard/billing`;
  }

  async createTopUpSession(input: {
    customerId: string;
    amount: number;
    currency?: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<TopUpResult> {
    this.assertConfigured();
    const order = await this.razorpay.orders.create({
      amount: input.amount,
      currency: input.currency || 'INR',
      receipt: `topup_${Date.now()}`,
      notes: {
        customerId: input.customerId,
        ...(input.metadata || {}),
      },
    });
    return { url: null, sessionId: order.id };
  }

  async verifyWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<Record<string, any>> {
    this.assertConfigured();
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('RAZORPAY_WEBHOOK_SECRET is not set.');
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const actual = (signature || '').replace(/^v1_/, '');
    if (expected !== actual) {
      throw new Error('Invalid Razorpay webhook signature.');
    }
    try {
      return JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('Invalid webhook payload.');
    }
  }

  async handleWebhook(event: Record<string, any>): Promise<void> {
    // Business handling of Razorpay events (payment captured / failed).
    // The BillingService subscribes to these where relevant.
    this.logger.log(`Received Razorpay event: ${event.event}`);
  }
}

export function paymentServiceFactory(): PaymentService {
  return new RazorpayPaymentService();
}

export const RazorpayPaymentServiceProvider = {
  provide: PAYMENT_SERVICE,
  useFactory: () => new RazorpayPaymentService(),
};