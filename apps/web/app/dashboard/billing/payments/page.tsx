'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import {
  downloadReceipt,
  formatDate,
  formatMoneyExact,
  getLegacyUsageInvoices,
  getPaymentMethods,
  getPayments,
  PAYMENT_STATUS_LABEL,
  PURPOSE_LABEL,
  type LegacyUsageInvoice,
  type PaymentRow,
  type PaymentStatus,
} from '../../../lib/billing';
import { Block, Empty, Pager, Pill, Section, Table, buttonCls, useResource, type Tone } from '../../_ui';
import { BillingHeader } from '../BillingShell';
import PaymentMethodCard from '../PaymentMethodCard';
import { ToastHost, type ToastState } from '../Toast';

const STATUS_TONE: Record<PaymentStatus, Tone> = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'neutral',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

/** Where "Try again" should go for a failed payment. */
function retryHref(p: PaymentRow) {
  if (p.purpose === 'TOPUP') return '/dashboard/billing?add=1';
  if (p.purpose === 'SUBSCRIPTION_RENEWAL') return '/dashboard/billing/checkout?renew=1';
  return '/dashboard/billing';
}

export default function PaymentsPage() {
  const [page, setPage] = useState(1);
  const [legacyPage, setLegacyPage] = useState(1);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const payments = useResource(() => getPayments(page), [page]);
  const methods = useResource(() => getPaymentMethods().catch(() => []));
  const legacy = useResource(() => getLegacyUsageInvoices(legacyPage).catch(() => null), [legacyPage]);

  const showToast = useCallback((type: 'success' | 'error', message: string) => setToast({ id: Date.now(), type, message }), []);

  const download = async (p: PaymentRow) => {
    setDownloading(p.id);
    try {
      await downloadReceipt(p.id, p.receipt ?? `receipt-${p.id}`);
    } catch {
      showToast('error', 'Could not download the receipt. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <BillingHeader title="Billing" subtitle="Your payments and receipts." />

      <Section>
        <Block res={payments} loadingLabel="Loading payments…">
          {(res) => (
            <div data-testid="payments-table">
              <Table
                rows={res.data}
                rowKey={(p) => p.id}
                empty={<Empty title="No payments yet" body="Credit purchases will show up here with their receipts." />}
                columns={[
                  { key: 'date', label: 'Date', render: (p) => formatDate(p.paidAt ?? p.createdAt) },
                  {
                    key: 'desc',
                    label: 'Description',
                    render: (p) => (
                      <>
                        {p.description ?? PURPOSE_LABEL[p.purpose]}
                        {p.credits > 0 && <span className="ml-2 text-[#6B6478]">{p.credits.toLocaleString('en-IN')} credits</span>}
                      </>
                    ),
                  },
                  {
                    key: 'amount',
                    label: 'Amount',
                    align: 'right',
                    render: (p) => (
                      <>
                        {formatMoneyExact(p.amount, p.currency)}
                        {p.refundedPaise > 0 && (
                          <span className="block text-xs text-[#6B6478]">{formatMoneyExact(p.refundedPaise, p.currency)} refunded</span>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (p) => (
                      <span className="inline-flex items-center gap-2">
                        <Pill tone={STATUS_TONE[p.paymentStatus] ?? 'neutral'}>{PAYMENT_STATUS_LABEL[p.paymentStatus] ?? p.paymentStatus}</Pill>
                        {p.paymentStatus === 'FAILED' && (
                          <Link href={retryHref(p)} title={p.failureReason ?? 'The payment did not go through.'} className="text-xs font-medium text-[#5B21B6] hover:underline">
                            Try again
                          </Link>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: 'receipt',
                    label: '',
                    align: 'right',
                    render: (p) =>
                      p.receipt && (p.paymentStatus === 'PAID' || p.paymentStatus === 'REFUNDED') ? (
                        <button type="button" onClick={() => download(p)} disabled={downloading === p.id} className={buttonCls('ghost', 'px-2 py-1 text-xs')}>
                          <Download size={13} /> {downloading === p.id ? 'Preparing…' : 'Receipt'}
                        </button>
                      ) : null,
                  },
                ]}
              />
              <Pager page={res.page} pageCount={res.pageCount} total={res.total} onChange={setPage} />
            </div>
          )}
        </Block>
      </Section>

      {/* Only legacy saved cards live here (payment is chosen at checkout); hidden when there are none. */}
      {methods.data && methods.data.length > 0 && (
        <Section>
          <PaymentMethodCard paymentMethods={methods.data} onChanged={methods.reload} showToast={showToast} />
        </Section>
      )}

      {legacy.data && legacy.data.total > 0 && (
        <Section title="Legacy usage invoices" description="From the previous billing model, kept for your records.">
          <div data-testid="legacy-invoices">
            <Table<LegacyUsageInvoice>
              rows={legacy.data.data}
              rowKey={(inv) => inv.id}
              columns={[
                {
                  key: 'invoice',
                  label: 'Invoice',
                  mono: true,
                  render: (inv) => (
                    <Link href={`/dashboard/billing/invoices/${inv.id}`} className="text-[#5B21B6] hover:underline">
                      {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                    </Link>
                  ),
                },
                { key: 'period', label: 'Period', render: (inv) => `${formatDate(inv.cycleStart)} – ${formatDate(inv.cycleEnd)}` },
                { key: 'total', label: 'Total', align: 'right', render: (inv) => formatMoneyExact(inv.totalPaise, inv.currency) },
                { key: 'status', label: 'Status', className: 'capitalize', render: (inv) => (inv.status === 'dunning' ? 'unpaid' : inv.status) },
              ]}
            />
            <Pager page={legacy.data.page} pageCount={legacy.data.pageCount} total={legacy.data.total} onChange={setLegacyPage} />
          </div>
        </Section>
      )}
    </>
  );
}
