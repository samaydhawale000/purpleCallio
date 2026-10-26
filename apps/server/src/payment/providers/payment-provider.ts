/**
 * Provider-agnostic payment abstraction used by prepaid billing: one-time
 * checkout payments plus recurring mandates for auto-renew.
 *
 * The billing engine only knows about a `Payment` and these operations —
 * never a provider SDK. Razorpay is the first implementation; Stripe, bank
 * transfer or manual invoicing can be added by implementing this interface
 * and registering it in PaymentProviderRegistry.
 *
 * Deliberately has no "charge a saved card" operation: we never initiate a
 * charge ourselves. Payments are either completed by the customer at
 * checkout, or are renewals the provider charges against a mandate the
 * customer authorised (createSubscription) for auto-renew.
 */

export interface ProviderCheckoutInput {
  /** Our Payment.id — sent to the provider as the receipt/reference. */
  paymentId: string;
  amountPaise: number;
  currency: string;
  description: string;
  /** Echoed back on the provider payment/webhook (ids only, no secrets). */
  notes: Record<string, string>;
  customer?: {
    name?: string | null;
    email?: string | null;
    contact?: string | null;
  };
}

export interface ProviderCheckout {
  provider: string;
  providerOrderId: string;
  /** Publishable key the browser needs to open checkout (never a secret). */
  publicKey: string | null;
  amountPaise: number;
  currency: string;
  /** True when running without real credentials (local/dev only). */
  mock: boolean;
}

export interface ProviderPaymentVerification {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export type ProviderPaymentState =
  | 'captured'
  | 'authorized'
  | 'failed'
  | 'pending'
  | 'refunded';

export interface ProviderPayment {
  providerPaymentId: string;
  providerOrderId: string | null;
  status: ProviderPaymentState;
  amountPaise: number;
  currency: string;
  method: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
}

/** Razorpay Charge-at-Will / eMandate.  This is intentionally separate from
 * subscriptions: the merchant, not Razorpay's subscription scheduler,
 * creates each subsequent payment. */
export interface ProviderChargeAtWillAuthorizationInput {
  authorizationId: string;
  customer: { name?: string | null; email: string; contact: string };
  currency: string;
  maxAmountPaise: number;
  expiresAt: Date;
  /** Account-approved Razorpay eMandate method, e.g. netbanking. */
  authType: string;
  notes: Record<string, string>;
}
export interface ProviderChargeAtWillAuthorization {
  providerOrderId: string;
  providerCustomerId: string;
  publicKey: string;
  currency: string;
}
/** Where an eMandate authorization stands, read straight from the provider. */
export interface ProviderMandateStatus {
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  tokenId: string | null;
  failureReason?: string | null;
}

export interface ProviderChargeAtWillChargeInput {
  paymentId: string;
  providerOrderId: string;
  providerCustomerId: string;
  providerTokenId: string;
  amountPaise: number;
  currency: string;
  email: string;
  contact: string;
  description: string;
  notes: Record<string, string>;
}

export type ProviderEventType =
  | 'payment.captured'
  | 'payment.authorized'
  | 'payment.failed'
  | 'order.paid'
  | 'refund.processed'
  | 'payment.dispute.created'
  | 'subscription.authenticated'
  | 'subscription.activated'
  | 'subscription.charged'
  | 'subscription.pending'
  | 'subscription.halted'
  | 'subscription.cancelled'
  | 'subscription.completed'
  | 'token.confirmed'
  | 'token.rejected'
  | 'token.cancelled'
  | 'token.paused'
  | 'unknown';

// ── Recurring mandates (auto-renew) ─────────────────────────────────────
export interface ProviderRecurringPlanInput {
  amountPaise: number;
  currency: string;
  /** MONTH | YEAR | CUSTOM (CUSTOM = intervalCount days). */
  billingInterval: 'MONTH' | 'YEAR' | 'CUSTOM';
  intervalCount: number;
  name: string;
}

export interface ProviderSubscriptionInput {
  providerPlanId: string;
  /** First charge at this time; omitted = charge now on authorization. */
  startAt?: Date | null;
  notes: Record<string, string>;
}

export interface ProviderSubscription {
  providerSubscriptionId: string;
  status: string;
  /** End of the provider's current billing cycle, when known. */
  currentEnd: Date | null;
}

export interface ProviderWebhookEvent {
  /** Provider's unique event id — the idempotency key for redeliveries. */
  eventId: string;
  type: ProviderEventType;
  rawType: string;
  payment: ProviderPayment | null;
  subscription: ProviderSubscription | null;
  refund: {
    providerRefundId: string;
    providerPaymentId: string;
    amountPaise: number;
  } | null;
  raw: Record<string, any>;
}

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  createCheckout(input: ProviderCheckoutInput): Promise<ProviderCheckout>;
  /**
   * Verifies the browser's completion proof (signature) and then confirms
   * the payment state with the provider server-side. Never trust the
   * browser's word that a payment succeeded.
   */
  verifyPayment(
    input: ProviderPaymentVerification,
  ): Promise<ProviderPayment | null>;
  getPayment(providerPaymentId: string): Promise<ProviderPayment>;
  refundPayment(
    providerPaymentId: string,
    amountPaise?: number,
  ): Promise<{ providerRefundId: string; amountPaise: number }>;
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<ProviderWebhookEvent>;

  /**
   * Recurring mandates for auto-renew. The provider owns the charging
   * schedule, e-mandate registration (card / UPI Autopay), pre-debit
   * notices and retries; we only react to its verified webhooks.
   */
  createRecurringPlan(input: ProviderRecurringPlanInput): Promise<string>;
  createSubscription(
    input: ProviderSubscriptionInput,
  ): Promise<ProviderSubscription>;
  /** Verifies the Checkout proof for a subscription's first (or auth) payment. */
  verifySubscriptionPayment(input: {
    providerSubscriptionId: string;
    providerPaymentId: string;
    signature: string;
  }): Promise<ProviderPayment | null>;
  /** Moves the mandate to another recurring plan from the next cycle. */
  changeSubscriptionPlan(
    providerSubscriptionId: string,
    providerPlanId: string,
  ): Promise<void>;
  cancelSubscription(
    providerSubscriptionId: string,
    atCycleEnd: boolean,
  ): Promise<void>;
  createChargeAtWillAuthorization(
    input: ProviderChargeAtWillAuthorizationInput,
  ): Promise<ProviderChargeAtWillAuthorization>;
  createChargeAtWillPayment(input: ProviderChargeAtWillChargeInput): Promise<ProviderPayment>;
  /**
   * The mandate's current state for an authorization order. Lets us confirm
   * a mandate without waiting for the token webhook (which never reaches a
   * local server and can be delayed in production).
   */
  getMandateStatus(providerOrderId: string, providerCustomerId: string): Promise<ProviderMandateStatus>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
