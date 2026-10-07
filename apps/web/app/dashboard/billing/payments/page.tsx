'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { Badge } from '../../../components/ui/Badge';
import { Pagination } from '../../../components/ui/Pagination';
import {
  billingErrorMessage,
  downloadReceipt,
  formatDate,
  formatMoneyExact,
  getLegacyUsageInvoices,
  getPaymentMethods,
  getPayments,
  PAYMENT_STATUS_LABEL,
  PURPOSE_LABEL,
  type LegacyUsageInvoice,
  type Paginated,
  type PaymentRow,
  type PaymentStatus,
  type SavedPaymentMethod,
} from '../../../lib/billing';
import { BillingHeader, ErrorBanner, PageLoader, SectionCard, useAuthErrorHandler } from '../BillingShell';
import PaymentMethodCard from '../PaymentMethodCard';
import { ToastHost, type ToastState } from '../Toast';

const STATUS_VARIANT: Record<PaymentStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'error',
  REFUNDED: 'info',
  CANCELLED: 'default',
  EXPIRED: 'default',
};

/** Where "Try again" should go for a failed payment. */
function retryHref(p: PaymentRow) {
  if (p.purpose === 'TOPUP') return '/dashboard/billing/credits#topups';
  if (p.purpose === 'SUBSCRIPTION_RENEWAL') return '/dashboard/billing/checkout?renew=1';
  if (p.purpose === 'CUSTOM_PLAN') return '/dashboard/billing';
  return '/dashboard/billing/plans';
}

export default function PaymentsPage() {
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();

  const [payments, setPayments] = useState<Paginated<PaymentRow> | null>(null);
  const [page, setPage] = useState(1);
  const [legacy, setLegacy] = useState<Paginated<LegacyUsageInvoice> | null>(null);
  const [legacyPage, setLegacyPage] = useState(1);
  const [methods, setMethods] = useState<SavedPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => setToast({ id: Date.now(), type, message }), []);

  const loadPayments = useCallback(async () => {
    try {
      setPayments(await getPayments(page));
      setError(null);
    } catch (e) {
      if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Failed to load payments. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [page, handleAuthError]);

  const loadMethods = useCallback(async () => {
    try {
      setMethods(await getPaymentMethods());
    } catch (e) {
      handleAuthError(e);
    }
  }, [handleAuthError]);

  const loadLegacy = useCallback(async () => {
    try {
      setLegacy(await getLegacyUsageInvoices(legacyPage));
    } catch {
      setLegacy(null);
    }
  }, [legacyPage]);

  useEffect(() => {
    if (isReady && isAuthed) loadPayments();
  }, [isReady, isAuthed, loadPayments]);
  useEffect(() => {
    if (isReady && isAuthed) loadMethods();
  }, [isReady, isAuthed, loadMethods]);
  useEffect(() => {
    if (isReady && isAuthed) loadLegacy();
  }, [isReady, isAuthed, loadLegacy]);

  useEffect(() => {
    if (!loading && typeof window !== 'undefined' && window.location.hash === '#payment-methods') {
      document.getElementById('payment-methods')?.scrollIntoView?.({ behavior: 'smooth' });
    }
  }, [loading]);

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

  const header = <BillingHeader title="Payments & receipts" subtitle="Every plan, renewal and top-up payment, with receipts." />;

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <PageLoader label="Loading payments…" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      {header}
      {error && <ErrorBanner message={error} onRetry={loadPayments} />}

      <SectionCard title="Payments">
        {!payments || payments.data.length === 0 ? (
          <p className="text-sm text-[#3D3650] py-4 text-center">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="payments-table">
              <thead>
                <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium text-right">Amount</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {payments.data.map((p) => (
                  <tr key={p.id} className="border-b border-[#E7DFF5]/60 last:border-0 align-top">
                    <td className="py-2.5 pr-4 text-[#3D3650] whitespace-nowrap">{formatDate(p.paidAt ?? p.createdAt)}</td>
                    <td className="py-2.5 pr-4 text-[#170B2E]">
                      {p.description ?? PURPOSE_LABEL[p.purpose]}
                      {p.credits > 0 && <span className="block text-[11px] text-[#3D3650]">{p.credits.toLocaleString('en-IN')} credits</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-[#3D3650] whitespace-nowrap">{PURPOSE_LABEL[p.purpose] ?? p.purpose}</td>
                    <td className="py-2.5 pr-4 text-right font-medium text-[#170B2E] whitespace-nowrap">
                      {formatMoneyExact(p.amount, p.currency)}
                      {p.refundedPaise > 0 && (
                        <span className="block text-[11px] text-[#3D3650]">{formatMoneyExact(p.refundedPaise, p.currency)} refunded</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge variant={STATUS_VARIANT[p.paymentStatus] ?? 'default'}>{PAYMENT_STATUS_LABEL[p.paymentStatus] ?? p.paymentStatus}</Badge>
                      {p.paymentStatus === 'FAILED' && (
                        <span className="block text-[11px] text-[#3D3650] mt-1">
                          {p.failureReason ?? 'The payment did not go through.'}{' '}
                          <Link href={retryHref(p)} className="font-medium text-[#6425C4] hover:underline">
                            Try again
                          </Link>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {p.receipt && (p.paymentStatus === 'PAID' || p.paymentStatus === 'REFUNDED') ? (
                        <button
                          type="button"
                          onClick={() => download(p)}
                          disabled={downloading === p.id}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6425C4] hover:text-[#170B2E] disabled:opacity-50"
                        >
                          <Download size={13} /> {downloading === p.id ? 'Preparing…' : p.receipt}
                        </button>
                      ) : (
                        <span className="text-xs text-[#3D3650]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={payments.page} pageCount={payments.pageCount} totalItems={payments.total} pageSize={payments.pageSize} onPageChange={setPage} />
          </div>
        )}
      </SectionCard>

      <PaymentMethodCard paymentMethods={methods} onChanged={loadMethods} showToast={showToast} />

      {legacy && legacy.total > 0 && (
        <SectionCard title="Legacy usage invoices" subtitle="Invoices from the previous billing model. Kept for your records.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="legacy-invoices">
              <thead>
                <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                  <th className="py-2 pr-4 font-medium">Invoice</th>
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium text-right">Total</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {legacy.data.map((inv) => (
                  <tr key={inv.id} className="border-b border-[#E7DFF5]/60 last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs">
                      <Link href={`/dashboard/billing/invoices/${inv.id}`} className="text-[#6425C4] hover:underline">
                        {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 text-[#3D3650] whitespace-nowrap">
                      {formatDate(inv.cycleStart)} – {formatDate(inv.cycleEnd)}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-[#170B2E] whitespace-nowrap">{formatMoneyExact(inv.totalPaise, inv.currency)}</td>
                    <td className="py-2.5 text-[#3D3650] capitalize">{inv.status === 'dunning' ? 'unpaid' : inv.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={legacy.page} pageCount={legacy.pageCount} totalItems={legacy.total} pageSize={legacy.pageSize} onPageChange={setLegacyPage} />
          </div>
        </SectionCard>
      )}
    </div>
  );
}
