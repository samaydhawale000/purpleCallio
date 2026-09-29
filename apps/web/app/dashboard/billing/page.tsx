'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Wallet,
  PhoneCall,
  Video,
  Monitor,
  Receipt,
  CreditCard,
  Loader2,
  Clock,
  AlertTriangle,
  CalendarClock,
  ShieldCheck,
  Download,
} from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { api } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Pagination } from '../../components/ui/Pagination';
import PaymentMethodCard, { PaymentMethod } from './PaymentMethodCard';
import BillingTimeline from './BillingTimeline';
import { ToastHost, ToastState } from './Toast';

interface CurrentUsage {
  cycle: { start: string; end: string };
  usage: {
    audioMinutes: number;
    videoMinutes: number;
    screenShareMinutes: number;
    participants: number;
    callsCreated: number;
    callsCompleted: number;
  };
  freeAllowance: { audioMinutes: number; videoMinutes: number };
  rates: { audioPaise: number; videoPaise: number; screenSharePaise: number };
  cost: {
    audioPaise: number;
    videoPaise: number;
    screenSharePaise: number;
    totalPaise: number;
  };
  estimatedMonthEndPaise: number;
  nextBillingDate: string;
  isFreeTier?: boolean;
  hasPaymentMethod?: boolean;
  freeUsagePercent?: number;
}

interface UsageInvoice {
  id: string;
  invoiceNumber: string;
  cycleStart: string;
  cycleEnd: string;
  audioMinutes: number;
  videoMinutes: number;
  screenShareMinutes: number;
  audioPaise: number;
  videoPaise: number;
  screenSharePaise: number;
  subtotalPaise: number;
  discountPercent: number | null;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  status: string;
  paidAt: string | null;
  lineItems?: any[];
}

interface UsageHistoryRow {
  id: string;
  billingCycleStart: string;
  billingCycleEnd: string;
  audioMinutes: number;
  videoMinutes: number;
  screenShareMinutes: number;
  usageCostPaise: number;
}

const paiseToINR = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  open: 'info',
  paid: 'success',
  dunning: 'warning',
  failed: 'error',
};

export default function BillingPage() {
  const { token, logout } = useAuthStore();
  const router = useRouter();
  const { isReady } = useRequireAuth();

  const [usage, setUsage] = useState<CurrentUsage | null>(null);
  const [invoices, setInvoices] = useState<UsageInvoice[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [spendingLimitPaise, setSpendingLimitPaise] = useState<number | null>(null);
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoicePageSize, setInvoicePageSize] = useState(10);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [invoicePageCount, setInvoicePageCount] = useState(1);

  const [usageHistory, setUsageHistory] = useState<UsageHistoryRow[]>([]);
  const [usageHistoryPage, setUsageHistoryPage] = useState(1);
  const [usageHistoryPageSize, setUsageHistoryPageSize] = useState(10);
  const [usageHistoryTotal, setUsageHistoryTotal] = useState(0);
  const [usageHistoryPageCount, setUsageHistoryPageCount] = useState(1);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ id: Date.now(), type, message });
  }, []);

  const downloadInvoicePdf = useCallback(async (invoice: UsageInvoice) => {
    setDownloadingId(invoice.id);
    try {
      const res = await api.get(`/billing/usage-invoices/${invoice.id}/pdf`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber ?? invoice.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast('error', 'Could not download the invoice PDF. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  }, [showToast]);

  const fetchAll = useCallback(async () => {
    try {
      const [usageRes, invoiceRes, pmRes, limitRes, historyRes] = await Promise.all([
        api.get('/billing/current-usage'),
        api.get(`/billing/usage-invoices?page=${invoicePage}`),
        api.get('/billing/payment-methods'),
        api.get('/billing/spending-limit'),
        api.get(`/billing/usage-history?page=${usageHistoryPage}`),
      ]);
      setUsage(usageRes.data);
      setInvoices(invoiceRes.data.data ?? []);
      setInvoiceTotal(invoiceRes.data.total ?? 0);
      setInvoicePageCount(invoiceRes.data.pageCount ?? 1);
      setInvoicePageSize(invoiceRes.data.pageSize ?? 10);
      const paymentMethodData = Array.isArray(pmRes.data)
        ? pmRes.data
        : pmRes.data?.data ?? pmRes.data?.items ?? [];
      setPaymentMethods(paymentMethodData.map((pm: any) => ({
        id: pm.id ?? pm.token ?? pm.tokenId,
        brand: pm.brand ?? pm.network ?? pm.cardBrand ?? null,
        last4: pm.last4 ?? pm.last_4 ?? pm.cardLast4 ?? null,
        expMonth: pm.expMonth ?? pm.expirymonth ?? pm.expiry_month ?? pm.cardExpMonth ?? null,
        expYear: pm.expYear ?? pm.expiryyear ?? pm.expiry_year ?? pm.cardExpYear ?? null,
        default: Boolean(pm.default ?? pm.isDefault),
      })));
      setSpendingLimitPaise(limitRes.data?.spendingLimitPaise ?? null);
      setUsageHistory(historyRes.data.data ?? []);
      setUsageHistoryTotal(historyRes.data.total ?? 0);
      setUsageHistoryPageCount(historyRes.data.pageCount ?? 1);
      setUsageHistoryPageSize(historyRes.data.pageSize ?? 10);
      setError(null);
    } catch (e: any) {
      if (e?.response?.status === 401) {
        logout();
        router.push('/login');
      } else {
        setError('Failed to load billing details. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [invoicePage, usageHistoryPage, logout, router]);

  useEffect(() => {
    if (!isReady) return;
    if (!token) { router.push('/login'); return; }
    fetchAll();
  }, [isReady, token, fetchAll, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin h-6 w-6 text-[#7F40E8]" />
          <span className="text-sm text-[#3D3650]">Loading billing…</span>
        </div>
      </div>
    );
  }

const u = usage?.usage;
  const cost = usage?.cost;
  const free = usage?.freeAllowance;
  const rates = usage?.rates;
  const paiseToINRShort = (p: number) => `₹${(p / 100).toFixed(2)}`;

  const hasDefaultCard = paymentMethods.some((pm) => pm.default);
  const hasBillableUsage = (cost?.totalPaise ?? 0) > 0 || (usage?.estimatedMonthEndPaise ?? 0) > 0;
  const latestInvoiceStatus = invoices[0]?.status;
  const billingAtRisk = latestInvoiceStatus === 'failed' || latestInvoiceStatus === 'dunning';

  const billingStatus: { label: string; variant: 'success' | 'warning' | 'error'; icon: typeof ShieldCheck } =
    billingAtRisk
      ? { label: 'Action needed', variant: 'error', icon: AlertTriangle }
      : !hasDefaultCard && hasBillableUsage
        ? { label: 'Add a card', variant: 'warning', icon: AlertTriangle }
        : { label: 'Healthy', variant: 'success', icon: ShieldCheck };

  const defaultCard = paymentMethods.find((pm) => pm.default);

  return (
    <div className="flex flex-col gap-6">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />

      <div>
        <h1 className="text-2xl font-bold text-[#170B2E]">Billing &amp; Usage</h1>
        <p className="text-sm text-[#3D3650] mt-1">
          Pay only for what you use. Add a card and we&apos;ll auto-charge you at the end of each billing cycle.
        </p>
      </div>

      {error && (
        <div
          className="rounded-lg border border-red-500/30 px-4 py-3 text-sm text-red-600"
          style={{ background: 'rgba(239,68,68,0.06)' }}
        >
          {error}
        </div>
      )}

      <UsageAlertBanner
        freeUsagePercent={usage?.freeUsagePercent}
        hasPaymentMethod={hasDefaultCard}
        audioRemaining={Math.max(0, (free?.audioMinutes ?? 0) - (u?.audioMinutes ?? 0))}
        videoRemaining={Math.max(0, (free?.videoMinutes ?? 0) - (u?.videoMinutes ?? 0))}
      />

      {/* ── Current balance / usage ── */}
      <div
        className="rounded-2xl border border-[#D6C4EE] p-6"
        style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.08), rgba(65,6,134,0.04))' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-white"
              style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
            >
              <Wallet size={22} />
            </div>
            <div>
              <p className="text-lg font-bold text-[#170B2E]">{usage?.isFreeTier ? 'Free Tier' : 'Pay as you go'}</p>
<p className="text-sm text-[#3D3650] mt-0.5">
                {free?.audioMinutes ?? 500} audio + {free?.videoMinutes ?? 200} video participant-min / month free · screen share always paid
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-[#3D3650] mb-1">Current balance (this cycle)</p>
            <p className="text-2xl font-bold text-[#170B2E]">{paiseToINR(cost?.totalPaise ?? 0)}</p>
            <p
              className="text-[11px] text-[#3D3650] mt-0.5"
              title="Projected total for the full cycle, based on your usage so far."
            >
              est. month-end {paiseToINR(usage?.estimatedMonthEndPaise ?? 0)}
            </p>
          </div>
        </div>

        {/* Per-type breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
<TypeRow
            icon={<PhoneCall size={16} style={{ color: '#7F40E8' }} />}
            label="Audio"
            minutes={u?.audioMinutes ?? 0}
            costPaise={cost?.audioPaise ?? 0}
            freeOf={free?.audioMinutes ?? 0}
            rate={rates ? `${paiseToINRShort(rates.audioPaise)} / participant-min` : 'Loading rate…'}
            color="#7F40E8"
          />
          <TypeRow
            icon={<Video size={16} style={{ color: '#A05DF9' }} />}
            label="Video"
            minutes={u?.videoMinutes ?? 0}
            costPaise={cost?.videoPaise ?? 0}
            freeOf={free?.videoMinutes ?? 0}
            rate={rates ? `${paiseToINRShort(rates.videoPaise)} / participant-min` : 'Loading rate…'}
            color="#A05DF9"
          />
          <TypeRow
            icon={<Monitor size={16} style={{ color: '#34D399' }} />}
            label="Screen Share"
            minutes={u?.screenShareMinutes ?? 0}
            costPaise={cost?.screenSharePaise ?? 0}
            freeOf={0}
                rate={rates ? `${paiseToINRShort(rates.screenSharePaise)} / participant-min` : 'Loading rate…'}
            color="#34D399"
          />
        </div>

        {/* Billing summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-white/5">
          <SummaryTile
            label="Est. end-of-month"
            value={paiseToINR(usage?.estimatedMonthEndPaise ?? 0)}
            hint="Projected total for the full cycle, based on your usage so far — not an additional charge."
          />
          <SummaryTile
            label="Next billing date"
            value={
              usage?.nextBillingDate
                ? new Date(usage.nextBillingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—'
            }
            icon={<CalendarClock size={13} style={{ color: '#7F40E8' }} />}
          />
          <SummaryTile
            label="Payment method"
            value={defaultCard ? `${(defaultCard.brand || 'Card').toUpperCase()} •••• ${defaultCard.last4 ?? '····'}` : 'Not added'}
            icon={<CreditCard size={13} style={{ color: '#6425C4' }} />}
          />
          <SummaryTile
            label="Billing status"
            value={billingStatus.label}
            valueColor={
              billingStatus.variant === 'success' ? '#34D399' : billingStatus.variant === 'warning' ? '#FBBF24' : '#F87171'
            }
            icon={<billingStatus.icon size={13} style={{ color: '#7F40E8' }} />}
          />
        </div>
      </div>

      {/* ── How billing works ── */}
<BillingTimeline
        hasUsage={(u?.callsCompleted ?? 0) > 0 || (u?.audioMinutes ?? 0) > 0 || (u?.videoMinutes ?? 0) > 0}
        hasBillableUsage={hasBillableUsage}
        hasPaymentMethod={hasDefaultCard}
        nextBillingDate={usage?.nextBillingDate ?? null}
        hasInvoices={invoices.length > 0}
        freeAllowance={usage?.freeAllowance}
      />

      {/* ── Payment method ── */}
      <PaymentMethodCard
        paymentMethods={paymentMethods}
        onChanged={fetchAll}
        showToast={showToast}
      />

      {/* ── Spending protection ── */}
      <SpendingLimitCard
        spendingLimitPaise={spendingLimitPaise}
        onSaved={(paise) => {
          setSpendingLimitPaise(paise);
          showToast('success', paise == null ? 'Spending limit removed.' : 'Spending limit updated.');
        }}
        showToast={showToast}
      />

      {/* ── Usage invoices ── */}
      <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-[#170B2E]">Invoices</p>
          <span className="text-xs text-[#3D3650]">{invoices.length} total</span>
        </div>

        {invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Receipt size={24} className="text-[#3D3650]" />
            <p className="text-sm text-[#3D3650]">
              No invoices yet. You&apos;ll be billed at the end of each billing cycle for usage beyond the free tier.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                  <th className="py-2 pr-4 font-medium">Invoice</th>
                  <th className="py-2 pr-4 font-medium">Cycle</th>
                  <th className="py-2 pr-4 font-medium">Usage</th>
                  <th className="py-2 pr-4 font-medium">Tax</th>
                  <th className="py-2 pr-4 font-medium">Total</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-[#E7DFF5]/60 last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs text-[#3D3650]">{inv.invoiceNumber}</td>
                    <td className="py-3 pr-4 text-[#3D3650]">
                      {new Date(inv.cycleStart).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                      {' – '}
                      {new Date(inv.cycleEnd).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-3 pr-4 font-medium text-[#170B2E]">
                      {paiseToINR(inv.subtotalPaise)}
                      {inv.discountPaise > 0 && (
                        <span className="block text-xs font-normal text-emerald-600">
                          {inv.discountPercent != null ? `${inv.discountPercent}% discount` : 'Discount'} applied
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-[#3D3650]">{paiseToINR(inv.taxPaise)}</td>
                    <td className="py-3 pr-4 font-medium text-[#170B2E]">{paiseToINR(inv.totalPaise)}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={statusVariant[inv.status] ?? 'default'}>
                        {inv.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/dashboard/billing/invoices/${inv.id}`}
                          className="text-xs font-medium text-[#7F40E8] hover:text-[#170B2E] transition-colors"
                        >
                          View
                        </Link>
                        <button
                          onClick={() => downloadInvoicePdf(inv)}
                          disabled={downloadingId === inv.id}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#3D3650] hover:text-[#170B2E] transition-colors disabled:opacity-50"
                        >
                          <Download size={12} />
                          {downloadingId === inv.id ? 'Downloading…' : 'PDF'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={invoicePage}
              pageCount={invoicePageCount}
              totalItems={invoiceTotal}
              pageSize={invoicePageSize}
              onPageChange={setInvoicePage}
            />
          </div>
        )}
      </div>

      {/* ── Usage history ── */}
      <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-[#170B2E]">Usage history</p>
          <span className="text-xs text-[#3D3650]">{usageHistoryTotal} cycles</span>
        </div>

        {usageHistory.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Clock size={24} className="text-[#3D3650]" />
            <p className="text-sm text-[#3D3650]">No usage recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                  <th className="py-2 pr-4 font-medium">Cycle</th>
                  <th className="py-2 pr-4 font-medium">Audio</th>
                  <th className="py-2 pr-4 font-medium">Video</th>
                  <th className="py-2 pr-4 font-medium">Screen share</th>
                  <th className="py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {usageHistory.map((row) => {
                  const isCurrent = new Date(row.billingCycleEnd) > new Date();
                  return (
                    <tr key={row.id} className="border-b border-[#E7DFF5]/60 last:border-0">
                      <td className="py-3 pr-4 text-[#3D3650]">
                        {new Date(row.billingCycleStart).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                        {' – '}
                        {new Date(row.billingCycleEnd).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                        {isCurrent && (
                          <span className="ml-2 text-[10px] font-medium text-[#7F40E8]">CURRENT</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-[#3D3650]">{row.audioMinutes.toFixed(2)} participant-min</td>
                      <td className="py-3 pr-4 text-[#3D3650]">{row.videoMinutes.toFixed(2)} participant-min</td>
                      <td className="py-3 pr-4 text-[#3D3650]">{row.screenShareMinutes.toFixed(2)} participant-min</td>
                      <td className="py-3 font-medium text-[#170B2E]">{paiseToINR(row.usageCostPaise)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              page={usageHistoryPage}
              pageCount={usageHistoryPageCount}
              totalItems={usageHistoryTotal}
              pageSize={usageHistoryPageSize}
              onPageChange={setUsageHistoryPage}
            />
          </div>
        )}
      </div>

      {/* ── How it works ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
<InfoCard
          icon={<Wallet size={16} style={{ color: '#34D399' }} />}
          title="Free tier"
          body={`${free?.audioMinutes ?? 500} audio + ${free?.videoMinutes ?? 200} video participant-minutes free every month. Screen sharing is always billable.`}
        />
        <InfoCard
          icon={<Clock size={16} style={{ color: '#7F40E8' }} />}
          title="Monthly invoice"
          body="On your billing date each month (anchored to when you started your plan), we aggregate your usage and generate an invoice for anything beyond the free allowance."
        />
        <InfoCard
          icon={<CreditCard size={16} style={{ color: '#FBBF24' }} />}
          title="Auto-charge"
          body="Your saved card is charged automatically. Failed payments get a 7-day grace period."
        />
      </div>
    </div>
  );
}

function TypeRow({
  icon,
  label,
  minutes,
  costPaise,
  freeOf,
  rate,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  minutes: number;
  costPaise: number;
  freeOf: number;
  rate: string;
  color: string;
}) {
  const pct =
    freeOf > 0 ? Math.min(100, Math.round((minutes / freeOf) * 100)) : Math.min(100, minutes > 0 ? 100 : 0);
  const remaining = freeOf > 0 ? Math.max(0, freeOf - minutes) : 0;
  return (
    <div className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#F8F4FD' }}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-xs text-[#3D3650]">{label}</p>
      </div>
      <p className="text-lg font-bold text-[#170B2E]">
        {minutes.toFixed(2)}
        <span className="text-xs font-normal text-[#3D3650]"> participant-min</span>
      </p>
      <p className="text-xs font-semibold mt-1" style={{ color }}>
        {paiseToINR(costPaise)}
      </p>
      <p className="text-[11px] text-[#3D3650] mt-0.5">{rate}</p>
      {freeOf > 0 && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[10px] text-[#3D3650] mb-1">
            <span>{remaining.toFixed(2)} / {freeOf} participant-min remaining</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#E7DFF5' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: pct >= 90 ? 'linear-gradient(135deg,#f43f5e,#fb7185)' : 'linear-gradient(135deg,#7F40E8,#410686)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  icon,
  valueColor,
  hint,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  valueColor?: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <p className="text-[11px] text-[#3D3650] mb-1">{label}</p>
      <p
        className="text-sm font-semibold flex items-center gap-1.5 truncate"
        style={{ color: valueColor ?? '#F1F5F9' }}
      >
        {icon}
        {value}
      </p>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(127,64,232,0.1)', border: '1px solid rgba(127,64,232,0.2)' }}
        >
          {icon}
        </div>
        <p className="text-sm font-semibold text-[#170B2E]">{title}</p>
      </div>
      <p className="text-xs text-[#3D3650] leading-relaxed">{body}</p>
    </div>
  );
}

/**
 * Warns the customer before they're surprised by a bill: nudges at 50/75%,
 * escalates at 90%, and calls out clearly once the free allowance is fully
 * used (with a CTA to add a card if they haven't already).
 */
function UsageAlertBanner({
  freeUsagePercent,
  hasPaymentMethod,
  audioRemaining,
  videoRemaining,
}: {
  freeUsagePercent?: number;
  hasPaymentMethod: boolean;
  audioRemaining: number;
  videoRemaining: number;
}) {
  const pct = freeUsagePercent ?? 0;
  if (pct < 50) return null;

  const tier =
    pct >= 100
      ? { color: '#F87171', border: 'rgba(248,113,113,0.35)', bg: 'rgba(239,68,68,0.06)' }
      : pct >= 90
        ? { color: '#FBBF24', border: 'rgba(251,191,36,0.35)', bg: 'rgba(251,191,36,0.06)' }
        : { color: '#7F40E8', border: 'rgba(127,64,232,0.3)', bg: 'rgba(127,64,232,0.05)' };

  const message =
    pct >= 100
      ? hasPaymentMethod
        ? "You've used your full free allowance — you're now on paid usage."
        : "You've used your full free allowance. Add a payment method to keep making calls."
      : `You've used ${pct}% of your free allowance. ${audioRemaining.toFixed(2)} audio + ${videoRemaining.toFixed(2)} video participant-minutes remaining.`;

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{ borderColor: tier.border, background: tier.bg }}
    >
      <AlertTriangle size={16} style={{ color: tier.color }} className="shrink-0" />
      <p className="text-sm flex-1" style={{ color: tier.color }}>{message}</p>
    </div>
  );
}

/**
 * Lets the customer cap their own monthly paid usage so a leaked API key or
 * runaway integration can't run up a surprise bill. Enforced server-side in
 * UsageBillingService.canStartCall — this is just the control surface.
 */
function SpendingLimitCard({
  spendingLimitPaise,
  onSaved,
  showToast,
}: {
  spendingLimitPaise: number | null;
  onSaved: (paise: number | null) => void;
  showToast: (type: 'success' | 'error', message: string) => void;
}) {
  const [input, setInput] = useState(spendingLimitPaise != null ? String(spendingLimitPaise / 100) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setInput(spendingLimitPaise != null ? String(spendingLimitPaise / 100) : '');
  }, [spendingLimitPaise]);

  const save = async (paise: number | null) => {
    setSaving(true);
    try {
      await api.post('/billing/spending-limit', { spendingLimitPaise: paise });
      onSaved(paise);
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || 'Could not update your spending limit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={16} style={{ color: '#34D399' }} />
        <p className="text-sm font-semibold text-[#170B2E]">Monthly spending limit</p>
      </div>
      <p className="text-xs text-[#3D3650] mb-3">
        Cap how much paid usage (beyond your free allowance) can be billed each month. New calls are blocked once you hit it — active calls are never interrupted.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-[#E7DFF5] px-3 py-2" style={{ background: '#F8F4FD' }}>
          <span className="text-[#3D3650] text-sm">₹</span>
          <input
            type="number"
            min={0}
            step="1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="No limit"
            className="w-28 bg-transparent text-sm text-[#170B2E] outline-none"
          />
        </div>
        <button
          onClick={() => {
            const value = parseFloat(input);
            if (!input.trim() || Number.isNaN(value) || value < 0) return;
            save(Math.round(value * 100));
          }}
          disabled={saving}
          className="text-sm font-medium px-3 py-2 rounded-lg text-white transition-colors disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
        >
          Save
        </button>
        {spendingLimitPaise != null && (
          <button
            onClick={() => { setInput(''); save(null); }}
            disabled={saving}
            className="text-sm text-[#3D3650] hover:text-[#170B2E] transition-colors disabled:opacity-50"
          >
            Remove limit
          </button>
        )}
      </div>
    </div>
  );
}
