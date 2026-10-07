/**
 * Provider-agnostic one-time payment abstraction used by prepaid billing.
 *
 * The billing engine only knows about a `Payment` and these operations —
 * never a provider SDK. Razorpay is the first implementation; Stripe, bank
 * transfer or manual invoicing can be added by implementing this interface
 * and registering it in PaymentProviderRegistry.
 *
 * Deliberately has no "charge a saved card" operation: prepaid billing only
 * ever takes payments the customer completes themselves at checkout.
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

export type ProviderEventType =
  | 'payment.captured'
  | 'payment.authorized'
  | 'payment.failed'
  | 'order.paid'
  | 'refund.processed'
  | 'payment.dispute.created'
  | 'unknown';

export interface ProviderWebhookEvent {
  /** Provider's unique event id — the idempotency key for redeliveries. */
  eventId: string;
  type: ProviderEventType;
  rawType: string;
  payment: ProviderPayment | null;
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
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
