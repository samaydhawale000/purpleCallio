'use client';

import { useState } from 'react';
import { Pill } from '../_ui';
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
    <section id="payment-methods" className="scroll-mt-20 rounded-xl bg-[#F7F6FA] p-5" data-testid="payment-methods">
      <h2 className="text-[15px] font-semibold text-[#170B2E]">Payment methods</h2>
      <p className="mt-0.5 text-[13px] text-[#6B6478]">
        Choose a payment method (card, UPI, netbanking) at credit checkout. Saved payment methods are not charged automatically.
      </p>

      {paymentMethods.length === 0 ? (
        <p className="mt-4 text-sm text-[#6B6478]">No saved cards.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#F2EFF6] rounded-xl border border-[#ECE8F2] bg-white">
          {paymentMethods.map((pm) => (
            <li key={pm.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-sm font-medium text-[#170B2E]">
                    {(pm.brand ?? 'Card').toString().toUpperCase()} {pm.last4 ? `•••• ${pm.last4}` : ''}
                  </p>
                  <p className="text-xs text-[#6B6478]">
                    {pm.expMonth && pm.expYear ? `Expires ${String(pm.expMonth).padStart(2, '0')}/${pm.expYear}` : 'Saved card'}
                  </p>
                  {pm.legacy && (
                    <div className="mt-1">
                      <Pill>Saved under previous billing — not charged automatically</Pill>
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemoving(pm)}
                className="text-[13px] font-medium text-red-600 hover:text-red-700"
              >
                Remove
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
