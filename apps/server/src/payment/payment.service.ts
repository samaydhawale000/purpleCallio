/**
 * LEGACY saved-card management (pay-as-you-go era).
 *
 * The retired post-paid model saved a card mandate and auto-charged it at
 * month end. That charging path (createPaymentIntent → Razorpay recurring
 * payment) and the ₹1 mandate setup have been removed: prepaid billing only
 * takes payments the customer completes at checkout (see
 * providers/payment-provider.ts).
 *
 * What remains lets customers see and remove cards saved under the old
 * model, and keeps the Razorpay customer record (used to offer saved cards
 * inside Checkout) in sync. Nothing here can move money.
 */

export interface CreateCustomerInput {
  email: string;
  name?: string | null;
  contact?: string | null;
  userId: string;
}

export interface PaymentMethodResult {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
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
  updateCustomerContact(customerId: string, contact: string): Promise<void>;
  getPaymentMethods(customerId: string): Promise<PaymentMethodResult[]>;
  getPaymentMethod(
    customerId: string,
    tokenId: string,
  ): Promise<PaymentMethodResult | null>;
  deletePaymentMethod(customerId: string, tokenId: string): Promise<void>;
  isConfigured(): boolean;
}

export const PAYMENT_SERVICE = 'PAYMENT_SERVICE';
