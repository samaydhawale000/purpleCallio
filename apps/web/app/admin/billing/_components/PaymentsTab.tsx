'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import {
  listAdminPayments,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  refundPayment,
  type AdminPaymentRow,
} from '../../../lib/admin-billing';
import { formatDate, formatMoney, formatMoneyExact, PURPOSE_LABEL } from '../../../lib/billing';
import { Button } from '../../../components/ui/Button';
import { Pagination } from '../../../components/ui/Pagination';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { SearchBox } from './SubscriptionsTab';
import { ErrorText, Field, inputCls, Modal, Panel, rowCls, Spinner, StatusBadge, Table, tdCls, useAdminErrorHandler, useResource } from './ui';

export function PaymentsTab({ userId }: { userId?: string }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [purpose, setPurpose] = useState('');
  const [search, setSearch] = useState('');
  const [refunding, setRefunding] = useState<AdminPaymentRow | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const { data, loading, error, reload } = useResource(
    () => listAdminPayments({ page, status, purpose, search, userId }),
    [page, status, purpose, search, userId],
  );

  return (
    <Panel title="Payments" subtitle="Every checkout attempt and auto-renew charge. Each period is paid at its start.">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <SearchBox
          placeholder="Search email, receipt # or provider id… (Enter)"
          onSearch={(q) => {
            setPage(1);
            setSearch(q);
          }}
        />
        <select aria-label="Status" className={`${inputCls} w-auto`} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">All statuses</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{s.toLowerCase()}</option>
          ))}
        </select>
        <select aria-label="Purpose" className={`${inputCls} w-auto`} value={purpose} onChange={(e) => { setPage(1); setPurpose(e.target.value); }}>
          <option value="">All purposes</option>
          {PAYMENT_PURPOSES.map((p) => (
            <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
          ))}
        </select>
      </div>
      {loading ? (
        <Spinner tall={false} />
      ) : error || !data ? (
        <ErrorText>{error || 'Failed to load'}</ErrorText>
      ) : (
        <>
          <Table
            headers={['Date', 'Customer', 'Purpose', 'Description', 'Amount', 'Status', 'Receipt', 'Method', 'Notes', '']}
            empty={data.data.length === 0 ? 'No payments match these filters.' : undefined}
          >
            {data.data.map((p) => (
              <tr key={p.id} className={rowCls}>
                <td className={`${tdCls} whitespace-nowrap`}>{formatDate(p.paidAt ?? p.createdAt)}</td>
                <td className={tdCls}>
                  {p.user ? (
                    <Link href={`/admin/customers/${p.user.id}`} className="text-[#170B2E] hover:text-[#6425C4]">
                      {p.user.email}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={tdCls}>{PURPOSE_LABEL[p.purpose] ?? p.purpose}</td>
                <td className={`${tdCls} max-w-[220px]`}>{p.description ?? '—'}</td>
                <td className={`${tdCls} whitespace-nowrap text-[#170B2E] font-medium`}>{formatMoneyExact(p.amount, p.currency)}</td>
                <td className={tdCls}><StatusBadge status={p.paymentStatus} /></td>
                <td className={`${tdCls} font-mono text-xs`}>{p.receipt ?? (p.receiptNumber ? `#${p.receiptNumber}` : '—')}</td>
                <td className={tdCls}>{p.paymentMethod ?? p.attempts?.[0]?.method ?? '—'}</td>
                <td className={`${tdCls} text-[11px] max-w-[200px]`}>
                  {p.failureReason && <div className="text-red-600">{p.failureReason}</div>}
                  {p.refundedPaise > 0 && <div className="text-amber-700">Refunded {formatMoney(p.refundedPaise, p.currency)}</div>}
                  {!p.failureReason && !p.refundedPaise && '—'}
                </td>
                <td className={tdCls}>
                  {p.paymentStatus === 'PAID' && (
                    <button className="text-xs font-medium text-red-600 hover:text-red-800" onClick={() => setRefunding(p)}>
                      Refund
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageCount={data.pageCount} totalItems={data.total} pageSize={data.pageSize} onPageChange={setPage} />
        </>
      )}
      {refunding && (
        <RefundDialog
          payment={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            setToast({ id: Date.now(), type: 'success', message: 'Refund issued' });
            reload();
          }}
        />
      )}
    </Panel>
  );
}

export function RefundDialog({ payment, onClose, onDone }: { payment: AdminPaymentRow; onClose: () => void; onDone: () => void }) {
  const handle = useAdminErrorHandler();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const remaining = payment.amount - (payment.refundedPaise ?? 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!reason.trim()) return setError('A refund reason is required.');
    if (!confirmed) return setError('Confirm that you understand the effect of this refund.');
    setSaving(true);
    try {
      await refundPayment(payment.id, reason.trim());
      onDone();
    } catch (err) {
      setError(handle(err, 'Refund failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Refund payment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="rounded-xl border border-[#E7DFF5] bg-[#F8F4FD] p-4 text-sm space-y-1">
          <p className="text-[#170B2E] font-medium">{payment.description ?? PURPOSE_LABEL[payment.purpose]}</p>
          <p className="text-[#3D3650]">{payment.user?.email}</p>
          <p className="text-[#170B2E]">Refund amount: <strong>{formatMoneyExact(remaining, payment.currency)}</strong></p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This issues a full refund through the payment provider. Credits from this payment that are still unused are removed.
          If the payment bought a plan, that plan ends immediately and the customer moves to the Free plan. This cannot be undone.
        </div>
        <Field label="Reason (required)">
          <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-[#170B2E]">
          <input type="checkbox" className="mt-0.5 accent-[#7F40E8]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I understand this reverses the remaining credits and ends a refunded plan.
        </label>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" variant="danger" loading={saving} disabled={!reason.trim() || !confirmed}>
            Issue refund
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
