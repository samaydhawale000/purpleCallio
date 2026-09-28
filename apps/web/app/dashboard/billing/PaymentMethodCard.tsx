'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CreditCard,
  Loader2,
  Lock,
  CheckCircle2,
  Star,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useAuthStore } from '../../store/auth.store';

const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '';

export interface PaymentMethod {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  default: boolean;
}

interface Props {
  paymentMethods: PaymentMethod[];
  onChanged: () => Promise<void> | void;
  showToast: (type: 'success' | 'error', message: string) => void;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

type FlowState = 'idle' | 'connecting' | 'processing' | 'success';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Collect a card via the Razorpay Checkout modal in "save card" mode.
 * Flow:
 *  1. POST /billing/payment-method/setup → { orderId, customerId } (a ₹1
 *     minimum order flagged server-side as a card-mandate authorisation).
 *  2. Open Razorpay Checkout with customer_id + recurring = true so the
 *     card token (token_xxx) is saved against the customer and can be
 *     resolved server-side afterwards. The contact number Razorpay requires
 *     for this comes from the user's profile (collected once at login by
 *     the profile-completion step on /login) — not re-asked here.
 *  3. POST /billing/payment-method/attach with the token + card details so
 *     the server persists them for auto-charge at month end (this becomes
 *     the new default card).
 * When Razorpay isn't configured (no key id), simulates the same states so
 * locals + demos still work end to end.
 */
export default function PaymentMethodCard({ paymentMethods, onChanged, showToast }: Props) {
  const phone = useAuthStore((s) => s.user?.phone);
  const [flow, setFlow] = useState<FlowState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRazorpayScript = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }, []);

  const finishAdd = useCallback(
    async (ok: boolean, message?: string) => {
      if (ok) {
        setFlow('success');
        showToast('success', 'Payment method added successfully.');
        await sleep(1100);
        await onChanged();
        setFlow('idle');
      } else {
        setError(message || 'Unable to save your payment method. Please try another card.');
        showToast('error', 'Unable to save your payment method. Please try another card.');
        setFlow('idle');
      }
    },
    [onChanged, showToast],
  );

  /** Dev/mock mode only: no real Razorpay to verify a payment against. */
  const attachMockCard = useCallback(
    async (tokenId: string, card: {
      brand?: string | null;
      last4?: string | null;
      expMonth?: number | null;
      expYear?: number | null;
    }) => {
      setFlow('processing');
      try {
        await api.post('/billing/payment-method/attach', {
          paymentMethodId: tokenId,
          tokenId,
          card,
        });
        await finishAdd(true);
      } catch (e: any) {
        await finishAdd(false, e?.response?.data?.message);
      }
    },
    [finishAdd],
  );

  /**
   * Real Razorpay mode: send the Checkout payment's proof (order id, payment
   * id, signature) — NOT a client-side token. razorpay_payment_id is a
   * payment id, not a card token; the server verifies the signature and asks
   * Razorpay directly for the token it saved against the customer.
   */
  const attachVerifiedCard = useCallback(
    async (proof: { orderId: string; paymentId: string; signature: string }) => {
      setFlow('processing');
      try {
        await api.post('/billing/payment-method/attach', {
          paymentMethodId: proof.paymentId,
          orderId: proof.orderId,
          paymentId: proof.paymentId,
          signature: proof.signature,
        });
        await finishAdd(true);
      } catch (e: any) {
        await finishAdd(false, e?.response?.data?.message);
      }
    },
    [finishAdd],
  );

  const handleAddCard = useCallback(async () => {
    setError(null);
    setFlow('connecting');

    if (!RAZORPAY_KEY_ID) {
      // Dev/demo mode: simulate the same state machine without a real gateway.
      await sleep(600);
      await attachMockCard(`token_mock_${Date.now()}`, {
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: new Date().getFullYear() + 3,
      });
      return;
    }

    if (!phone) {
      await finishAdd(false, 'Add a contact phone number to your account first.');
      return;
    }

    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        await finishAdd(false, 'Could not load Razorpay Checkout. Please try again.');
        return;
      }

      const setupRes = await api.post('/billing/payment-method/setup');
      const orderId = setupRes.data?.clientSecret ?? setupRes.data?.orderId;
      const customerId = setupRes.data?.customerId;
      if (!orderId || !customerId) {
        await finishAdd(false, 'Could not start card setup.');
        return;
      }

      const options = {
        key: RAZORPAY_KEY_ID,
        order_id: orderId,
        customer_id: customerId,
        name: 'PurpleCallio',
        description: 'Save your card for usage-based billing',
        prefill: { contact: phone },
        handler: async (response: any) => {
          const paymentId = response?.razorpay_payment_id;
          const signature = response?.razorpay_signature;
          const responseOrderId = response?.razorpay_order_id ?? orderId;
          if (!paymentId || !signature) {
            await finishAdd(false, 'Razorpay did not return a valid payment confirmation.');
            return;
          }
          // Send the payment's proof to the server — it verifies the
          // signature and asks Razorpay directly for the saved card token.
          // We never construct a token from the payment id ourselves.
          await attachVerifiedCard({
            orderId: responseOrderId,
            paymentId,
            signature,
          });
        },
        modal: {
          ondismiss: () => setFlow('idle'),
        },
        theme: { color: '#7F40E8' },
        recurring: true,
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        finishAdd(false, resp?.error?.description);
      });
      // Razorpay's own modal takes over the screen from here — drop our
      // "connecting" overlay so the two don't stack.
      setFlow('idle');
      rzp.open();
    } catch (e: any) {
      await finishAdd(false, e?.response?.data?.message || 'Could not start card setup.');
    }
  }, [attachMockCard, attachVerifiedCard, finishAdd, loadRazorpayScript, phone]);

  const handleRemove = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await api.delete(`/billing/payment-method/${id}`);
        showToast('success', 'Payment method removed.');
        await onChanged();
      } catch (e: any) {
        showToast('error', e?.response?.data?.message || 'Could not remove this card.');
      } finally {
        setBusyId(null);
      }
    },
    [onChanged, showToast],
  );

  const handleSetDefault = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await api.post('/billing/payment-method/default', { id });
        showToast('success', 'Default payment method updated.');
        await onChanged();
      } catch (e: any) {
        showToast('error', e?.response?.data?.message || 'Could not update the default card.');
      } finally {
        setBusyId(null);
      }
    },
    [onChanged, showToast],
  );

  if (flow === 'connecting') {
    return <StatusPanel text="Connecting securely to Razorpay…" />;
  }
  if (flow === 'processing') {
    return <StatusPanel text="Saving your payment method…" />;
  }
  if (flow === 'success') {
    return <StatusPanel text="Payment method added!" success />;
  }

  if (paymentMethods.length === 0) {
    return (
      <div className="rounded-xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'rgba(127,64,232,0.1)', border: '1px solid rgba(127,64,232,0.25)' }}
          >
            <CreditCard size={18} style={{ color: '#6425C4' }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#170B2E]">Payment Method</p>
            <p className="text-xs text-[#3D3650] mt-0.5">
              Save a card to enable automatic monthly billing. You&apos;ll only be charged
              for usage beyond your free allowance.
            </p>
          </div>
        </div>

        <div className="h-px my-4" style={{ background: '#E7DFF5' }} />

        <p className="text-xs text-[#3D3650] text-center mb-4">No payment method added yet</p>

        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mb-5">
          {['No charge today', 'Auto billing every month', 'Cancel anytime'].map((item) => (
            <span key={item} className="inline-flex items-center gap-1.5 text-xs text-[#3D3650]">
              <CheckCircle2 size={13} style={{ color: '#34D399' }} /> {item}
            </span>
          ))}
        </div>

        <div className="flex flex-col items-center gap-2 mb-5">
          <p className="text-[10px] uppercase tracking-wide text-[#3D3650]">Accepted cards</p>
          <div className="flex items-center gap-2">
            {['Visa', 'Mastercard', 'Amex'].map((brand) => (
              <span
                key={brand}
                className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-[#E7DFF5] text-[#3D3650]"
                style={{ background: '#F8F4FD' }}
              >
                {brand}
              </span>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-center mb-3" style={{ color: '#F87171' }}>{error}</p>}

        <div className="flex justify-center">
          <Button onClick={handleAddCard}>
            <CreditCard size={14} className="mr-1.5" /> Add Card
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <div className="flex items-center gap-2 mb-4">
        <CreditCard size={16} style={{ color: '#6425C4' }} />
        <p className="text-sm font-semibold text-[#170B2E]">Payment Method</p>
        <span
          className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(127,64,232,0.1)', border: '1px solid rgba(127,64,232,0.25)', color: '#6425C4' }}
        >
          <Lock size={10} /> Secured by Razorpay
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {paymentMethods.map((pm) => (
          <div
            key={pm.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E7DFF5] px-4 py-3"
            style={{ background: '#F8F4FD' }}
          >
            <CreditCard size={16} style={{ color: '#6425C4' }} />
            <div className="min-w-0">
              <p className="text-sm text-[#3D3650]">
                {(pm.brand || 'Card').toUpperCase()} •••• {pm.last4 ?? '••••'}
              </p>
              {pm.expMonth && pm.expYear && (
                <p className="text-[11px] text-[#3D3650]">
                  Expires {String(pm.expMonth).padStart(2, '0')}/{String(pm.expYear).slice(-2)}
                </p>
              )}
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              {pm.default && <Badge variant="purple">Default</Badge>}
              {pm.default && (
                <Badge variant="success"><CheckCircle2 size={11} /> Auto billing enabled</Badge>
              )}
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
              {pm.default ? (
                <Button variant="secondary" size="sm" onClick={handleAddCard} disabled={busyId === pm.id}>
                  <RefreshCw size={12} className="mr-1" /> Update card
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSetDefault(pm.id)}
                  loading={busyId === pm.id}
                >
                  <Star size={12} className="mr-1" /> Make default
                </Button>
              )}
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleRemove(pm.id)}
                loading={busyId === pm.id}
              >
                <Trash2 size={12} className="mr-1" /> Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs mt-3" style={{ color: '#F87171' }}>{error}</p>}

      <button
        onClick={handleAddCard}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#6425C4] hover:text-[#6425C4] transition-colors"
      >
        <CreditCard size={13} /> Add another card
      </button>
    </div>
  );
}

function StatusPanel({ text, success }: { text: string; success?: boolean }) {
  return (
    <div
      className="rounded-xl border border-[#E7DFF5] p-8 flex flex-col items-center justify-center gap-3"
      style={{ background: '#FFFFFF', minHeight: 160 }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={text}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2 }}
        >
          {success ? (
            <CheckCircle2 size={28} style={{ color: '#34D399' }} />
          ) : (
            <Loader2 size={28} className="animate-spin" style={{ color: '#6425C4' }} />
          )}
        </motion.div>
      </AnimatePresence>
      <p className="text-sm text-[#3D3650]">{text}</p>
    </div>
  );
}
