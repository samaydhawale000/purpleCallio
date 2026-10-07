/**
 * Provider-agnostic payment abstraction.
 *
 * All billing business logic talks to this interface only — never directly
 * to a provider SDK (Stripe, Razorpay, etc.). This lets us add new payment
 * providers without touching business logic.
 */

export interface CreateCustomerInput {
  email: string;
  name?: string | null;
  contact?: string | null;
  userId: string;
}

export interface CreateCheckoutInput {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CreateSubscriptionInput {
  customerId: string;
  priceId: string;
  metadata?: Record<string, string>;
}

export interface UpdateSubscriptionInput {
  subscriptionId: string;
  priceId?: string;
  prorationBehavior?: 'create_prorations' | 'none';
}

export interface SubscriptionResult {
  id: string;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  defaultPaymentMethod?: string | null;
}

export interface InvoiceResult {
  id: string;
  number: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  amount: number;
  currency: string;
  status: string;
  generatedAt: Date | null;
}

export interface PaymentMethodResult {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

export interface CheckoutResult {
  url: string | null;
  sessionId: string;
  mode?: 'subscription' | 'payment';
}

export interface TopUpResult {
  url: string | null;
  sessionId: string;
}

export interface SetupIntentResult {
  clientSecret: string;
  customerId: string;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string | null;
  status: string;
  amount: number;
  currency: string;
}

export interface PaymentService {
  createCustomer(input: CreateCustomerInput): Promise<string>;
  /**
   * False only when the provider definitively reports the customer doesn't
   * exist on the current account (e.g. a test-mode id after switching to
   * live keys). Transient/network errors are re-thrown, never reported as
   * "missing", so a blip can't wipe a valid customer.
   */
  customerExists(customerId: string): Promise<boolean>;
  createSetupIntent(customerId: string): Promise<SetupIntentResult>;
  attachPaymentMethod(input: {
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
  }): Promise<void>;
  createPaymentIntent(input: {
    customerId: string;
    amountPaise: number;
    currency?: string;
    tokenId?: string | null;
    email: string;
    contact: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentIntentResult>;
  createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<CheckoutResult>;
  createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<SubscriptionResult>;
  updateSubscription(
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionResult>;
  cancelSubscription(subscriptionId: string): Promise<SubscriptionResult>;
  resumeSubscription(subscriptionId: string): Promise<void>;
  getSubscription(subscriptionId: string): Promise<SubscriptionResult>;
getInvoices(customerId: string): Promise<InvoiceResult[]>;
  getPaymentMethods(
    customerId: string,
  ): Promise<PaymentMethodResult[]>;
  getPaymentMethod(
    customerId: string,
    tokenId: string,
  ): Promise<PaymentMethodResult | null>;
  deletePaymentMethod(customerId: string, tokenId: string): Promise<void>;
  /**
   * Syncs the customer's contact number on the payment provider. Razorpay
   * requires the underlying Customer record — not just the Checkout call —
   * to carry a contact number before it will authorise a recurring card
   * mandate for that customer.
   */
  updateCustomerContact(customerId: string, contact: string): Promise<void>;
  /**
   * Verifies the HMAC signature Razorpay Checkout returns for a completed
   * payment (order_id|payment_id signed with the key secret). This is the
   * only way to know the `razorpay_payment_id` the frontend hands us was
   * really issued by Razorpay for this order, rather than a client-supplied
   * string — a payment id is not a card token and must never be trusted
   * as one without this check plus resolveSavedCardToken below.
   */
  verifyCardSetupPayment(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): Promise<{ verified: boolean }>;
  /**
   * Resolves the real saved-card token created by a verified card-setup
   * payment, by asking Razorpay directly (never derived from the payment id
   * itself). Throws if the payment didn't succeed or no token exists yet.
   */
  resolveSavedCardToken(
    customerId: string,
    paymentId: string,
  ): Promise<PaymentMethodResult>;
  createPortalSession(customerId: string): Promise<string>;
  createTopUpSession(input: {
    customerId: string;
    amount: number;
    currency?: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<TopUpResult>;
  verifyWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<Record<string, any>>;
  handleWebhook(event: Record<string, any>): Promise<void>;
  isConfigured(): boolean;
}

export const PAYMENT_SERVICE = 'PAYMENT_SERVICE';
