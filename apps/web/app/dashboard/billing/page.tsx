'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Coins, RefreshCw } from 'lucide-react';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { Button } from '../../components/ui/Button';
import { billingErrorMessage, formatCredits, formatDate, getCreditSummary, isFreeCreditSource, walletSplit, type WalletSummary } from '../../lib/billing';
import { BillingHeader, ErrorBanner, PageLoader, SectionCard, useAuthErrorHandler } from './BillingShell';

export default function BillingOverviewPage() {
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setWallet(await getCreditSummary());
      setError(null);
    } catch (e) {
      if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Failed to load your wallet.'));
    } finally { setLoading(false); }
  }, [handleAuthError]);
  useEffect(() => { if (isReady && isAuthed) void load(); }, [isReady, isAuthed, load]);

  return <div className="flex flex-col gap-6">
    <BillingHeader title="Billing" subtitle="Prepaid credits, purchases and usage." />
    {loading ? <PageLoader label="Loading your wallet…" /> : error ? <ErrorBanner message={error} onRetry={() => { setLoading(true); void load(); }} /> : wallet && <>
      <SectionCard title="Credit wallet" subtitle="Credits are purchased in advance and expire by lot according to the published policy." actions={<Link href="/dashboard/billing/credits#topups"><Button size="sm">Buy credits <ArrowRight size={14} /></Button></Link>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <WalletStat label="Available" value={wallet.available} />
          <WalletStat label="Reserved" value={wallet.reserved} />
          <WalletStat label="Used" value={wallet.used} />
        </div>
        {wallet.purchase?.eligible === false && <p className="mt-4 text-sm text-amber-800">{wallet.purchase.reason ?? 'Credit purchases are unavailable for this account.'}</p>}
      </SectionCard>
      <SectionCard title="Credit balances" subtitle="Free credits cover audio, video and screen share. Live Translate, AI voice agents and post-call reports use paid credits only.">
        <div className="grid gap-3 sm:grid-cols-2" data-testid="credit-split">
          <Balance label="Paid credits · every feature" value={walletSplit(wallet).paid} />
          <Balance label="Free credits · calls only" value={walletSplit(wallet).free} />
        </div>
      </SectionCard>
      <SectionCard title="Upcoming expiries" subtitle="Each credit lot keeps its own expiry date.">
        {wallet.buckets.filter((b) => b.remaining > 0 && b.expiresAt).length === 0 ? <p className="text-sm text-[#3D3650]">No expiring credit lots.</p> : <ul className="divide-y divide-[#E7DFF5]">{wallet.buckets.filter((b) => b.remaining > 0 && b.expiresAt).sort((a,b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '')).slice(0, 8).map((bucket) => <li key={bucket.id} className="flex justify-between gap-4 py-3 text-sm"><span>{formatCredits(bucket.remaining)} {isFreeCreditSource(bucket.source) ? 'free' : 'paid'} credits</span><span className="text-[#3D3650]">Expires {formatDate(bucket.expiresAt)}</span></li>)}</ul>}
      </SectionCard>
      <div className="flex justify-end"><Link className="inline-flex items-center gap-2 text-sm font-medium text-[#6425C4]" href="/dashboard/billing/credits">View transaction history <ArrowRight size={14} /></Link><button aria-label="Refresh wallet" onClick={() => { setLoading(true); void load(); }} className="ml-4 text-[#6425C4]"><RefreshCw size={16} /></button></div>
    </>}
  </div>;
}

function WalletStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-[#E7DFF5] p-4"><p className="text-xs text-[#3D3650]">{label}</p><p className="mt-1 flex items-center gap-2 text-2xl font-bold text-[#170B2E]"><Coins size={18} className="text-[#6425C4]" />{formatCredits(value)}</p></div>;
}
function Balance({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-[#F8F5FC] p-4"><p className="text-xs text-[#3D3650]">{label}</p><p className="mt-1 text-lg font-semibold text-[#170B2E]">{formatCredits(value)}</p></div>;
}
