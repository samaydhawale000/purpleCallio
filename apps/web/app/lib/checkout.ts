'use client';

import {
  getPaymentOutcome,
  reportPaymentFailure,
  startAutoRenew,
  startCheckout,
  verifyAutoRenew,
  verifyPayment,
  type AutoRenewState,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentOutcome,
} from './billing';

declare global {
  interface Window {
    Razorpay: any;
  }
}

export type CheckoutResult =
  | { kind: 'paid'; outcome: PaymentOutcome }
  | { kind: 'failed'; outcome: PaymentOutcome | null; message: string }
  | { kind: 'pending'; outcome: PaymentOutcome }
  | { kind: 'dismissed'; session: CheckoutSession };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/** After a verified-but-not-yet-captured payment, wait for the webhook. */
async function waitForSettlement(paymentId: string, first: PaymentOutcome): Promise<CheckoutResult> {
  let outcome = first;
  for (let i = 0; i < 15 && outcome.status === 'PENDING'; i++) {
    await sleep(2000);
    outcome = await getPaymentOutcome(paymentId);
  }
  if (outcome.status === 'PAID') return { kind: 'paid', outcome };
  if (outcome.status === 'PENDING') return { kind: 'pending', outcome };
  return { kind: 'failed', outcome, message: outcome.failureReason ?? 'Payment failed' };
}

/**
 * Runs one prepaid checkout: the server creates the order (amount is
 * computed server-side), the customer pays in Razorpay Checkout, and the
 * server verifies the payment before anything is activated. The browser's
 * "success" callback is only a hint — the returned outcome always comes
 * from the server.
 *
 * Without Razorpay credentials (local/dev) the server returns a mock order
 * and this simulates a successful payment.
 */
export async function runCheckout(req: CheckoutRequest, opts: { onOpen?: () => void } = {}): Promise<CheckoutResult> {
  const session = await startCheckout(req);

  if (session.mock || !session.publicKey) {
    await sleep(700);
    const outcome = await verifyPayment(session.paymentId, {
      providerOrderId: session.providerOrderId,
      providerSubscriptionId: session.providerSubscriptionId,
      providerPaymentId: `pay_mock_${Date.now()}`,
      signature: 'mock_signature',
    });
    return outcome.status === 'PAID'
      ? { kind: 'paid', outcome }
      : waitForSettlement(session.paymentId, outcome);
  }

  if (!(await loadRazorpay())) {
    return { kind: 'failed', outcome: null, message: 'Could not load the payment window. Check your connection and try again.' };
  }

  return new Promise<CheckoutResult>((resolve) => {
    let settled = false;
    // Razorpay lets the customer retry inside the same modal after a
    // failure, so a failure is only final once the modal closes.
    let lastFailure: { outcome: PaymentOutcome | null; message: string } | null = null;
    const finish = (r: CheckoutResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    const viaMandate = session.mode === 'subscription';
    const rzp = new window.Razorpay({
      key: session.publicKey,
      // Auto-renew: the customer authorizes a recurring mandate (card / UPI
      // Autopay) and pays the first period in the same step.
      ...(viaMandate
        ? { subscription_id: session.providerSubscriptionId }
        : { order_id: session.providerOrderId, amount: session.amountPaise, currency: session.currency }),
      name: 'PurpleCallio',
      description: session.description,
      prefill: {
        name: session.prefill.name ?? undefined,
        email: session.prefill.email ?? undefined,
        contact: session.prefill.contact ?? undefined,
      },
      notes: { paymentId: session.paymentId },
      theme: { color: '#7F40E8' },
      handler: async (response: any) => {
        try {
          const outcome = await verifyPayment(session.paymentId, {
            ...(viaMandate
              ? { providerSubscriptionId: response?.razorpay_subscription_id ?? session.providerSubscriptionId }
              : { providerOrderId: response?.razorpay_order_id ?? session.providerOrderId }),
            providerPaymentId: response?.razorpay_payment_id,
            signature: response?.razorpay_signature,
          });
          finish(outcome.status === 'PAID' ? { kind: 'paid', outcome } : await waitForSettlement(session.paymentId, outcome));
        } catch (e: any) {
          // The browser path failed to verify; the webhook may still confirm
          // a real capture, so ask the server for its view once more.
          const message = e?.response?.data?.message ?? 'We could not confirm this payment.';
          try {
            const outcome = await getPaymentOutcome(session.paymentId);
            finish(outcome.status === 'PAID' ? { kind: 'paid', outcome } : { kind: 'failed', outcome, message });
          } catch {
            finish({ kind: 'failed', outcome: null, message });
          }
        }
      },
      modal: {
        ondismiss: async () => {
          // A dismissed modal might still have a payment in flight.
          try {
            const outcome = await getPaymentOutcome(session.paymentId);
            if (outcome.status === 'PAID') return finish({ kind: 'paid', outcome });
          } catch {
            /* ignore */
          }
          finish(lastFailure ? { kind: 'failed', ...lastFailure } : { kind: 'dismissed', session });
        },
      },
    });

    rzp.on('payment.failed', async (resp: any) => {
      const message = resp?.error?.description ?? 'Payment failed';
      let outcome: PaymentOutcome | null = null;
      try {
        outcome = await reportPaymentFailure(session.paymentId, {
          providerPaymentId: resp?.error?.metadata?.payment_id,
          code: resp?.error?.code,
          description: message,
        });
      } catch {
        /* the server keeps its own state */
      }
      lastFailure = { outcome, message };
    });

    opts.onOpen?.();
    rzp.open();
  });
}

export type AutoRenewSetupResult =
  | { kind: 'enabled'; state: AutoRenewState }
  | { kind: 'failed'; message: string }
  | { kind: 'dismissed' };

/**
 * Turns auto-renew on for a plan that was bought without it. The customer
 * authorizes a recurring mandate in Razorpay Checkout; nothing is charged
 * until the current period ends (cards may see a small authorization that
 * the bank reverses). The server verifies the authorization.
 */
export async function runAutoRenewSetup(): Promise<AutoRenewSetupResult> {
  const session = await startAutoRenew();
  if (session.mock || !session.publicKey) {
    await sleep(500);
    const state = await verifyAutoRenew({
      providerSubscriptionId: session.providerSubscriptionId,
      providerPaymentId: `pay_mock_${Date.now()}`,
      signature: 'mock_signature',
    });
    return { kind: 'enabled', state };
  }
  if (!(await loadRazorpay())) {
    return { kind: 'failed', message: 'Could not load the payment window. Check your connection and try again.' };
  }
  return new Promise<AutoRenewSetupResult>((resolve) => {
    let settled = false;
    let lastFailure: string | null = null;
    const finish = (r: AutoRenewSetupResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const rzp = new window.Razorpay({
      key: session.publicKey,
      subscription_id: session.providerSubscriptionId,
      name: 'PurpleCallio',
      description: session.description,
      prefill: {
        name: session.prefill.name ?? undefined,
        email: session.prefill.email ?? undefined,
        contact: session.prefill.contact ?? undefined,
      },
      theme: { color: '#7F40E8' },
      handler: async (response: any) => {
        try {
          const state = await verifyAutoRenew({
            providerSubscriptionId: response?.razorpay_subscription_id ?? session.providerSubscriptionId,
            providerPaymentId: response?.razorpay_payment_id,
            signature: response?.razorpay_signature,
          });
          finish({ kind: 'enabled', state });
        } catch (e: any) {
          finish({ kind: 'failed', message: e?.response?.data?.message ?? 'We could not confirm the auto-renew setup.' });
        }
      },
      modal: { ondismiss: () => finish(lastFailure ? { kind: 'failed', message: lastFailure } : { kind: 'dismissed' }) },
    });
    rzp.on('payment.failed', (resp: any) => {
      lastFailure = resp?.error?.description ?? 'Authorization failed';
    });
    rzp.open();
  });
}
