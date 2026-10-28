'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import {
  formatCredits,
  formatMoney,
  type AutoTopUpState,
  type PublishedCreditPricing,
} from '../../../lib/billing';
import { buttonCls, inputCls, type Tone } from '../../_ui';

export const amountToMinor = (raw: string): number | null => {
  const value = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
};

export function getPurchaseAmountError(amount: string, paise: number | null, pricing: PublishedCreditPricing) {
  if (!amount) return 'Enter an amount.';
  if (paise == null || paise <= 0) return 'Enter a valid positive amount with up to 2 decimal places.';
  if (paise < pricing.minimumPurchasePaise) return `The minimum purchase is ${formatMoney(pricing.minimumPurchasePaise, pricing.currency)}.`;
  if (pricing.maximumPurchasePaise != null && paise > pricing.maximumPurchasePaise)
    return `The maximum purchase is ${formatMoney(pricing.maximumPurchasePaise, pricing.currency)}.`;
  return null;
}

function getQuickAmounts(pricing: PublishedCreditPricing) {
  const options = [pricing.minimumPurchasePaise, 200_000, 500_000, 1_000_000].filter(
    (value) => value >= pricing.minimumPurchasePaise && (pricing.maximumPurchasePaise == null || value <= pricing.maximumPurchasePaise),
  );
  return [...new Set(options)].slice(0, 4);
}

function Modal({ title, onClose, children, labelledBy }: { title: string; onClose: () => void; children: React.ReactNode; labelledBy: string }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id={labelledBy} className="text-base font-semibold text-[#170B2E]">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-[#6B6478] hover:bg-[#F7F6FA]" aria-label={`Close ${title}`}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const labelCls = 'block text-[13px] font-medium text-[#4B4458]';

export function AddCreditsDialog({
  pricing,
  currencies,
  onCurrencyChange,
  onClose,
  onContinue,
}: {
  pricing: PublishedCreditPricing;
  currencies: PublishedCreditPricing[];
  onCurrencyChange: (currency: string) => void;
  onClose: () => void;
  onContinue: (amountPaise: number) => void;
}) {
  const [amount, setAmount] = useState('');
  const amountPaise = amountToMinor(amount);
  const amountError = getPurchaseAmountError(amount, amountPaise, pricing);
  const estimatedCredits = amountPaise == null ? null : Math.floor(amountPaise / pricing.creditPricePaise);
  const remainderPaise = amountPaise != null && estimatedCredits != null ? amountPaise - estimatedCredits * pricing.creditPricePaise : 0;

  return (
    <Modal title="Add credits" onClose={onClose} labelledBy="add-credits-title">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!amountError && amountPaise != null) onContinue(amountPaise);
        }}
      >
        <p className="text-sm text-[#6B6478]">
          {formatMoney(pricing.creditPricePaise, pricing.currency)} per credit · minimum{' '}
          {formatMoney(pricing.minimumPurchasePaise, pricing.currency)} · credits last {pricing.purchasedValidityDays} days
        </p>

        {currencies.length > 1 && (
          <label className={`${labelCls} mt-5`}>
            Currency
            <select value={pricing.currency} onChange={(e) => onCurrencyChange(e.target.value)} className={`${inputCls} mt-1`}>
              {currencies.map((c) => (
                <option key={c.currency} value={c.currency}>
                  {c.currency}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={`${labelCls} mt-5`}>
          Amount ({pricing.currency})
          <input
            autoFocus
            inputMode="decimal"
            placeholder={`Min ${formatMoney(pricing.minimumPurchasePaise, pricing.currency)}`}
            value={amount}
            onChange={(e) => {
              if (/^\d*(\.\d{0,2})?$/.test(e.target.value)) setAmount(e.target.value);
            }}
            aria-invalid={Boolean(amount && amountError)}
            aria-describedby="purchase-amount-error"
            className={`${inputCls} mt-1`}
          />
        </label>
        {amount && amountError && (
          <p id="purchase-amount-error" className="mt-1 text-xs text-red-700">
            {amountError}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick amounts">
          {getQuickAmounts(pricing).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmount((q / 100).toFixed(2))}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                amountPaise === q ? 'border-[#7F40E8] bg-[#F1EBFC] text-[#5B21B6]' : 'border-[#E4DEEE] text-[#4B4458] hover:bg-[#F7F6FA]'
              }`}
            >
              {formatMoney(q, pricing.currency)}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-lg bg-[#F7F6FA] px-4 py-3" aria-live="polite">
          {amountError || estimatedCredits == null ? (
            <p className="text-sm text-[#6B6478]">Enter an amount to see how many credits you get.</p>
          ) : (
            <>
              <p className="text-sm text-[#6B6478]">You get about</p>
              <p className="text-xl font-semibold text-[#170B2E]">{formatCredits(estimatedCredits)} credits</p>
              <p className="mt-1 text-xs text-[#6B6478]">
                Tax and the final amount are shown at checkout.
                {remainderPaise > 0 ? ` ${formatMoney(remainderPaise, pricing.currency)} does not make a whole credit and is not carried forward.` : ''}
              </p>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={buttonCls('secondary')} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={buttonCls('primary')} disabled={Boolean(amountError) || amountPaise == null}>
            Continue to checkout
          </button>
        </div>
      </form>
    </Modal>
  );
}

export type TopUpStage = { key: 'off' | 'pending' | 'ready' | 'on' | 'attention'; label: string; tone: Tone; text: string };

/** Where the customer is in setup: authorize → Razorpay confirms → turn on. */
export function autoTopUpStage(s: AutoTopUpState['setting'] | null): TopUpStage {
  const status = s?.mandateStatus ?? 'NONE';
  if (s?.enabled) return { key: 'on', label: 'On', tone: 'success', text: 'Credits are added automatically when your balance runs low.' };
  if (status === 'ACTIVE')
    return { key: 'ready', label: 'Ready', tone: 'accent', text: 'Razorpay confirmed your eMandate. Turn it on to start. Nothing is charged until you do.' };
  if (status === 'PENDING')
    return { key: 'pending', label: 'Awaiting confirmation', tone: 'warning', text: 'Waiting for Razorpay to confirm your eMandate. Some banks take up to a few days.' };
  if (status === 'FAILED' || status === 'REVOKED' || status === 'EXPIRED')
    return { key: 'attention', label: 'Needs attention', tone: 'danger', text: 'Your eMandate is no longer active. Authorize it again to keep using auto top-up.' };
  return { key: 'off', label: 'Off', tone: 'neutral', text: 'Add credits automatically when your balance falls below a threshold you choose.' };
}

export function AutoTopUpDialog({
  pricing,
  existing,
  busy,
  onClose,
  onSave,
}: {
  pricing: PublishedCreditPricing;
  existing: AutoTopUpState['setting'] | null;
  busy: boolean;
  onClose: () => void;
  onSave: (threshold: number, amount: number, cap: number) => Promise<void>;
}) {
  // A first setup starts empty (the customer chooses every value); a change starts from the saved values.
  const rupees = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, '');
  const [threshold, setThreshold] = useState(existing ? String(existing.thresholdCredits) : '');
  const [amount, setAmount] = useState(existing ? rupees(existing.amountPaise) : '');
  const [cap, setCap] = useState(existing ? rupees(existing.monthlyLimitPaise) : '');
  const [error, setError] = useState<string | null>(null);
  const minimum = formatMoney(pricing.minimumPurchasePaise, pricing.currency);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = Number(threshold);
    const a = amountToMinor(amount);
    const c = amountToMinor(cap);
    if (!threshold.trim() || !Number.isSafeInteger(t) || t < 0) return setError('Enter the credit balance that should trigger a top-up (a whole number).');
    if (!a) return setError('Enter a top-up amount with up to 2 decimal places.');
    const amountError = getPurchaseAmountError(amount, a, pricing);
    if (amountError) return setError(amountError.replace('purchase', 'top-up'));
    if (!c) return setError('Enter a monthly maximum with up to 2 decimal places.');
    if (c < a) return setError('The monthly maximum must be at least the top-up amount.');
    setError(null);
    void onSave(t, a, c);
  };

  return (
    <Modal title={existing ? 'Update auto top-up' : 'Set up auto top-up'} onClose={onClose} labelledBy="auto-topup-title">
      <form noValidate onSubmit={submit}>
        <p className="text-sm text-[#6B6478]">
          You will authorize an eMandate in Razorpay. Nothing is charged automatically until Razorpay confirms it and you turn auto top-up on.
        </p>
        <label className={`${labelCls} mt-5`}>
          When balance falls below (credits)
          <input required min="0" type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
        <label className={`${labelCls} mt-4`}>
          Add ({pricing.currency})
          <input required inputMode="decimal" placeholder={`Minimum ${minimum}`} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
        <label className={`${labelCls} mt-4`}>
          Monthly maximum ({pricing.currency})
          <input required inputMode="decimal" placeholder="At least the top-up amount" value={cap} onChange={(e) => setCap(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={buttonCls('secondary')} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={buttonCls('primary')} disabled={busy}>
            {busy ? 'Starting…' : 'Authorize eMandate'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
