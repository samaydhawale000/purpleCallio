'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Coins } from 'lucide-react';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Pagination } from '../../../components/ui/Pagination';
import {
  billingErrorMessage,
  CREDIT_SOURCE_LABEL,
  CREDIT_TX_LABEL,
  describeCreditTransaction,
  formatCredits,
  formatDate,
  formatMoney,
  getCreditHistory,
  getCreditSummary,
  getTopUps,
  type CreditTransactionRow,
  type CreditTransactionType,
  type Paginated,
  type TopUpPackage,
  type WalletSummary,
} from '../../../lib/billing';
import { BillingHeader, ErrorBanner, PageLoader, SectionCard, useAuthErrorHandler } from '../BillingShell';

const TYPES = Object.keys(CREDIT_TX_LABEL) as CreditTransactionType[];

export default function CreditsPage() {
  const router = useRouter();
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [topUps, setTopUps] = useState<TopUpPackage[]>([]);
  const [ledger, setLedger] = useState<Paginated<CreditTransactionRow> | null>(null);
  const [type, setType] = useState<CreditTransactionType | ''>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const [w, t] = await Promise.all([
        getCreditSummary(),
        getTopUps().catch(() => [] as TopUpPackage[]),
      ]);
      setWallet(w);
      setTopUps(Array.isArray(t) ? t : []);
      setError(null);
    } catch (e) {
      if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Failed to load your credits. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      setLedger(await getCreditHistory(page, type || undefined));
    } catch (e) {
      if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Failed to load credit history.'));
    } finally {
      setLedgerLoading(false);
    }
  }, [page, type, handleAuthError]);

  useEffect(() => {
    if (isReady && isAuthed) loadSummary();
  }, [isReady, isAuthed, loadSummary]);

  useEffect(() => {
    if (isReady && isAuthed) loadLedger();
  }, [isReady, isAuthed, loadLedger]);

  // Scroll to #topups once the section exists.
  useEffect(() => {
    if (!loading && typeof window !== 'undefined' && window.location.hash === '#topups') {
      document.getElementById('topups')?.scrollIntoView?.({ behavior: 'smooth' });
    }
  }, [loading]);

  const header = <BillingHeader title="Credits" subtitle="Your credit balance, top-ups and full credit history." />;

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <PageLoader label="Loading credits…" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {error && <ErrorBanner message={error} onRetry={() => { loadSummary(); loadLedger(); }} />}

      {wallet && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="wallet-summary">
          <Stat label="Available" value={formatCredits(wallet.available)} hint={wallet.reserved > 0 ? `${formatCredits(wallet.reserved)} held for active calls` : undefined} />
          <Stat label="Used this period" value={formatCredits(wallet.used)} hint={`${wallet.usedPercent}% of ${formatCredits(wallet.granted)}`} />
          <Stat
            label="Next expiry"
            value={(() => {
              const next = wallet.buckets.find((b) => b.expiresAt);
              return next ? formatDate(next.expiresAt) : 'None';
            })()}
            hint={(() => {
              const next = wallet.buckets.find((b) => b.expiresAt);
              return next ? `${formatCredits(next.remaining)} ${CREDIT_SOURCE_LABEL[next.source].toLowerCase()} credits` : undefined;
            })()}
          />
        </div>
      )}
      {wallet && wallet.available <= 0 && (
        <div role="alert" className="rounded-xl border px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.3)', color: '#B91C1C' }}>
          New calls are paused until you add credits.
        </div>
      )}

      <SectionCard id="topups" title="Top-ups" subtitle="One-time credit packages. Top up when you need more.">
        {topUps.length === 0 ? (
          <p className="text-sm text-[#3D3650]">No top-up packages are available right now.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {topUps.map((t) => (
              <div key={t.id} className="rounded-xl border border-[#E7DFF5] p-4 flex flex-col" style={{ background: '#F8F4FD' }} data-testid={`topup-${t.id}`}>
                <div className="flex items-center gap-2">
                  <Coins size={14} className="text-[#6425C4]" />
                  <p className="text-sm font-semibold text-[#170B2E]">{t.name}</p>
                  {t.isPopular && <Badge variant="purple">Popular</Badge>}
                </div>
                <p className="text-xl font-bold text-[#170B2E] mt-2">{formatCredits(t.credits)} credits</p>
                <p className="text-sm text-[#3D3650]">{formatMoney(t.pricePaise, t.currency)} + GST</p>
                {t.description && <p className="text-xs text-[#3D3650] mt-1 flex-1">{t.description}</p>}
                <Button size="sm" className="mt-3" onClick={() => router.push(`/dashboard/billing/checkout?topup=${encodeURIComponent(t.id)}`)}>
                  Buy
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Credit history"
        actions={
          <select
            aria-label="Filter by type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as CreditTransactionType | '');
              setPage(1);
            }}
            className="text-xs rounded-lg border border-[#E7DFF5] px-2 py-1.5 text-[#3D3650] bg-white"
          >
            <option value="">All activity</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {CREDIT_TX_LABEL[t]}
              </option>
            ))}
          </select>
        }
      >
        {ledgerLoading && !ledger ? (
          <PageLoader label="Loading history…" />
        ) : !ledger || ledger.data.length === 0 ? (
          <p className="text-sm text-[#3D3650] py-4 text-center">No credit activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="credit-ledger">
              <thead>
                <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 pr-4 font-medium text-right">Credits</th>
                  <th className="py-2 font-medium text-right">Balance after</th>
                </tr>
              </thead>
              <tbody className={ledgerLoading ? 'opacity-60' : ''}>
                {ledger.data.map((row) => (
                  <tr key={row.id} className="border-b border-[#E7DFF5]/60 last:border-0">
                    <td className="py-2.5 pr-4 text-[#3D3650] whitespace-nowrap">{formatDate(row.createdAt)}</td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <Badge variant={row.amount >= 0 ? 'success' : 'default'}>{CREDIT_TX_LABEL[row.type] ?? row.type}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-[#3D3650]">{describeCreditTransaction(row)}</td>
                    <td className={`py-2.5 pr-4 text-right font-medium whitespace-nowrap ${row.amount >= 0 ? 'text-emerald-700' : 'text-[#170B2E]'}`}>
                      {row.amount >= 0 ? '+' : '−'}
                      {formatCredits(Math.abs(row.amount))}
                    </td>
                    <td className="py-2.5 text-right text-[#3D3650]">{formatCredits(row.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={ledger.page} pageCount={ledger.pageCount} totalItems={ledger.total} pageSize={ledger.pageSize} onPageChange={setPage} />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#E7DFF5] bg-white p-5">
      <p className="text-xs text-[#3D3650]">{label}</p>
      <p className="text-2xl font-bold text-[#170B2E] mt-1">{value}</p>
      {hint && <p className="text-[11px] text-[#3D3650] mt-0.5">{hint}</p>}
    </div>
  );
}
