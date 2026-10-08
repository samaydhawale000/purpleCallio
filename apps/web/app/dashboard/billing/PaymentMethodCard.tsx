'use client';

import { useState } from 'react';
import { CreditCard, Trash2 } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { billingErrorMessage, removePaymentMethod, type SavedPaymentMethod } from '../../lib/billing';
import { ConfirmDialog } from './BillingShell';

/** Kept for existing imports. */
export type PaymentMethod = SavedPaymentMethod;

interface Props {
  paymentMethods: SavedPaymentMethod[];
  onChanged: () => void | Promise<void>;
  showToast: (type: 'success' | 'error', message: string) => void;
}

/**
 * Saved payment methods. Payment is chosen at checkout (card, UPI,
 * netbanking); saved cards are only listed here and can be removed —
 * nothing charges them automatically.
 */
export default function PaymentMethodCard({ paymentMethods, onChanged, showToast }: Props) {
  const [removing, setRemoving] = useState<SavedPaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await removePaymentMethod(removing.id);
      showToast('success', 'Card removed.');
      setRemoving(null);
      await onChanged();
    } catch (e) {
      showToast('error', billingErrorMessage(e, 'Could not remove this card. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="payment-methods" className="rounded-2xl border border-[#E7DFF5] bg-white p-6 scroll-mt-20" data-testid="payment-methods">
      <h2 className="text-sm font-semibold text-[#170B2E]">Payment methods</h2>
      <p className="text-xs text-[#3D3650] mt-0.5">
        Choose a payment method (card, UPI, netbanking) when purchasing a plan or adding credits. Auto-renew charges only the mandate you authorize for your plan; saved cards are never charged otherwise.
      </p>

      {paymentMethods.length === 0 ? (
        <p className="mt-4 text-sm text-[#3D3650]">No saved cards.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#E7DFF5] border border-[#E7DFF5] rounded-xl">
          {paymentMethods.map((pm) => (
            <li key={pm.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(127,64,232,0.1)' }}>
                  <CreditCard size={16} className="text-[#6425C4]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#170B2E]">
                    {(pm.brand ?? 'Card').toString().toUpperCase()} {pm.last4 ? `•••• ${pm.last4}` : ''}
                  </p>
                  <p className="text-xs text-[#3D3650]">
                    {pm.expMonth && pm.expYear ? `Expires ${String(pm.expMonth).padStart(2, '0')}/${pm.expYear}` : 'Saved card'}
                  </p>
                  {pm.legacy && (
                    <Badge variant="default" className="mt-1">
                      Saved under previous billing — not charged automatically
                    </Badge>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemoving(pm)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"
              >
                <Trash2 size={13} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!removing}
        title="Remove this card?"
        confirmLabel="Remove card"
        tone="danger"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      >
        <p>
          {removing?.brand ?? 'Card'} {removing?.last4 ? `•••• ${removing.last4}` : ''} will be removed. You can still pay with any card, UPI or
          netbanking at checkout.
        </p>
      </ConfirmDialog>
    </section>
  );
}
