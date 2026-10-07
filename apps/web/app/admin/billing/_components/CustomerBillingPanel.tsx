'use client';

import { FormEvent, useState } from 'react';
import {
  adjustCustomerCredits,
  getCustomerBilling,
  type AdminPaymentRow,
} from '../../../lib/admin-billing';
import {
  CREDIT_TX_LABEL,
  formatCredits,
  formatDate,
  formatMoney,
  formatMoneyExact,
  PURPOSE_LABEL,
} from '../../../lib/billing';
import { Button } from '../../../components/ui/Button';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { RefundDialog } from './PaymentsTab';
import { Checkbox, ErrorText, Field, inputCls, Panel, rowCls, Spinner, StatusBadge, Table, tdCls, useAdminErrorHandler, useResource } from './ui';

const BUCKET_LABEL: Record<string, string> = {
  SUBSCRIPTION: 'Plan credits',
  TOPUP: 'Top-up',
  PROMOTION: 'Promotion',
  ADMIN: 'Admin grant',
  MIGRATION: 'Transition credits',
};

/** Admin → Customer: plan, credit balance & buckets, history, payments, manual credit adjustment. */
export function CustomerBillingPanel({ customerId, onChanged }: { customerId: string; onChanged?: () => void }) {
  const { data, loading, error, reload } = useResource(() => getCustomerBilling(customerId), [customerId]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [refunding, setRefunding] = useState<AdminPaymentRow | null>(null);

  if (loading) return <Spinner tall={false} />;
  if (error || !data) return <ErrorText>{error || 'Failed to load billing'}</ErrorText>;

  const s = data.subscription;
  const w = data.wallet;
  const refresh = () => {
    reload();
    onChanged?.();
  };

  return (
    <div className="flex flex-col gap-6">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel title="Current plan">
          <p className="text-lg font-bold text-[#170B2E]">
            {s.planName ?? '—'} <span className="text-xs font-normal text-[#3D3650]">{s.planType}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#3D3650]">
            <StatusBadge status={s.status} />
            {s.currentPeriodStart && s.currentPeriodEnd && (
              <span>
                {formatDate(s.currentPeriodStart)} – {formatDate(s.currentPeriodEnd)}
              </span>
            )}
          </div>
          {s.planType !== 'FREE' && s.pricePaise > 0 && (
            <p className="text-sm text-[#3D3650] mt-2">
              Paid {formatMoney(s.pricePaise, s.currency)} for {formatCredits(s.includedCredits)} credits
            </p>
          )}
          {s.cancelAtPeriodEnd && <p className="text-xs text-amber-700 mt-2">Cancelled — plan remains active until {formatDate(s.currentPeriodEnd)}.</p>}
          {data.scheduledPlan && (
            <p className="text-xs text-[#6425C4] mt-2">Downgrade to {data.scheduledPlan.name} scheduled for {formatDate(s.currentPeriodEnd)}.</p>
          )}
          {data.pendingCheckout && (
            <p className="text-xs text-[#3D3650] mt-2">
              Checkout in progress{data.pendingCheckout.planName ? ` for ${data.pendingCheckout.planName}` : ''} (started {formatDate(data.pendingCheckout.createdAt)}).
            </p>
          )}
          {data.lastEndedPaidSubscription && (
            <p className="text-xs text-[#3D3650] mt-2">
              Previous paid plan: {data.lastEndedPaidSubscription.planName} (ended {formatDate(data.lastEndedPaidSubscription.expiredAt ?? data.lastEndedPaidSubscription.currentPeriodEnd)}).
            </p>
          )}
        </Panel>
        <Panel title="Credit balance">
          <p className="text-lg font-bold text-[#170B2E]">{formatCredits(w.available)} available</p>
          <p className="text-sm text-[#3D3650] mt-1">
            {formatCredits(w.balance)} balance{w.reserved ? ` · ${formatCredits(w.reserved)} reserved by active calls` : ''}
          </p>
          <p className="text-sm text-[#3D3650]">
            {formatCredits(w.used)} used of {formatCredits(w.granted)} this period ({Math.round(w.usedPercent)}%)
          </p>
          {w.buckets.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {w.buckets.map((b) => (
                <li key={b.id} className="flex justify-between gap-2">
                  <span className="text-[#3D3650]">{BUCKET_LABEL[b.source] ?? b.source}</span>
                  <span className="text-[#170B2E]">
                    {formatCredits(b.remaining)} / {formatCredits(b.initialAmount)}
                    <span className="text-[#6B6478]"> · {b.expiresAt ? `expires ${formatDate(b.expiresAt)}` : 'no expiry'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <AdjustCreditsForm
        customerId={customerId}
        onDone={(msg) => {
          setToast({ id: Date.now(), type: 'success', message: msg });
          refresh();
        }}
      />

      <Panel title="Recent credit history">
        <Table headers={['Date', 'Type', 'Amount', 'Balance after', 'Details']} empty={data.creditHistory.data.length === 0 ? 'No credit activity yet.' : undefined}>
          {data.creditHistory.data.map((t) => (
            <tr key={t.id} className={rowCls}>
              <td className={`${tdCls} whitespace-nowrap`}>{formatDate(t.createdAt)}</td>
              <td className={tdCls}>{CREDIT_TX_LABEL[t.type] ?? t.type}</td>
              <td className={`${tdCls} font-medium ${t.amount < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {t.amount > 0 ? '+' : ''}
                {formatCredits(t.amount)}
              </td>
              <td className={tdCls}>{formatCredits(t.balanceAfter)}</td>
              <td className={`${tdCls} text-[11px]`}>
                {typeof t.metadata?.reason === 'string' ? t.metadata.reason : t.referenceType ?? '—'}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Payments">
        <Table headers={['Date', 'Purpose', 'Amount', 'Status', 'Notes', '']} empty={data.payments.length === 0 ? 'No payments yet.' : undefined}>
          {data.payments.map((p) => (
            <tr key={p.id} className={rowCls}>
              <td className={`${tdCls} whitespace-nowrap`}>{formatDate(p.paidAt ?? p.createdAt)}</td>
              <td className={tdCls}>
                {PURPOSE_LABEL[p.purpose] ?? p.purpose}
                {p.description && <div className="text-[11px]">{p.description}</div>}
              </td>
              <td className={`${tdCls} text-[#170B2E]`}>{formatMoneyExact(p.amount, p.currency)}</td>
              <td className={tdCls}><StatusBadge status={p.paymentStatus} /></td>
              <td className={`${tdCls} text-[11px]`}>
                {p.failureReason && <div className="text-red-600">{p.failureReason}</div>}
                {p.refundedPaise > 0 && <div className="text-amber-700">Refunded {formatMoney(p.refundedPaise, p.currency)}</div>}
              </td>
              <td className={tdCls}>
                {p.paymentStatus === 'PAID' && (
                  <button className="text-xs font-medium text-red-600 hover:text-red-800" onClick={() => setRefunding({ ...p, user: data.customer })}>
                    Refund
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      {(data.legacy.hasSavedCard || data.legacy.spendingLimitPaise != null || data.legacy.usageInvoices > 0) && (
        <div className="rounded-xl border border-dashed border-[#E7DFF5] px-4 py-3 text-xs text-[#6B6478]">
          <span className="font-mono uppercase tracking-widest mr-2">Legacy</span>
          {[
            data.legacy.hasSavedCard && 'Saved card from previous billing (not charged)',
            data.legacy.spendingLimitPaise != null && `Old monthly limit ${formatMoney(data.legacy.spendingLimitPaise)} (no longer used)`,
            data.legacy.usageInvoices > 0 && `${data.legacy.usageInvoices} legacy usage invoice(s)`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}

      {refunding && (
        <RefundDialog
          payment={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            setToast({ id: Date.now(), type: 'success', message: 'Refund issued' });
            refresh();
          }}
        />
      )}
    </div>
  );
}

export function AdjustCreditsForm({ customerId, onDone }: { customerId: string; onDone: (message: string) => void }) {
  const handle = useAdminErrorHandler();
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [promotion, setPromotion] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d+$/.test(amount.trim()) || Number(amount) <= 0) return setError('Enter a whole number of credits above zero.');
    if (!reason.trim()) return setError('A reason is required.');
    let expiresAt: string | null = null;
    if (direction === 'add' && expiresOn) {
      const d = new Date(`${expiresOn}T23:59:59`);
      if (Number.isNaN(d.getTime()) || d <= new Date()) return setError('Expiry must be a future date.');
      expiresAt = d.toISOString();
    }
    const n = Number(amount) * (direction === 'add' ? 1 : -1);
    if (!window.confirm(`${direction === 'add' ? 'Add' : 'Remove'} ${formatCredits(Math.abs(n))} credits ${direction === 'add' ? 'to' : 'from'} this customer?`)) return;
    setSaving(true);
    try {
      await adjustCustomerCredits(customerId, {
        amount: n,
        reason: reason.trim(),
        expiresAt,
        promotion: direction === 'add' && promotion,
      });
      setAmount('');
      setReason('');
      setExpiresOn('');
      setPromotion(false);
      onDone(`${direction === 'add' ? 'Added' : 'Removed'} ${formatCredits(Math.abs(n))} credits`);
    } catch (err) {
      setError(handle(err, 'Adjustment failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Adjust credits" subtitle="Every adjustment is recorded in the customer's credit history and the audit log.">
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end" noValidate>
        <Field label="Action">
          <select aria-label="Action" className={inputCls} value={direction} onChange={(e) => setDirection(e.target.value as 'add' | 'remove')}>
            <option value="add">Add credits</option>
            <option value="remove">Remove credits</option>
          </select>
        </Field>
        <Field label="Credits">
          <input type="number" min={1} className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason (required)" className="sm:col-span-2">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {direction === 'add' && (
          <>
            <Field label="Expires on (optional)">
              <input type="date" className={inputCls} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </Field>
            <div className="sm:col-span-2 pb-2">
              <Checkbox label="Record as a promotion" checked={promotion} onChange={setPromotion} />
            </div>
          </>
        )}
        <div className="sm:col-span-4 flex items-center gap-3">
          <Button type="submit" size="sm" loading={saving}>
            {direction === 'add' ? 'Add credits' : 'Remove credits'}
          </Button>
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </Panel>
  );
}
