'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Loader2, Minus, Sparkles } from 'lucide-react';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import {
  billingErrorMessage,
  formatCredits,
  formatDate,
  formatMoney,
  getAvailablePlans,
  getPublicPricing,
  intervalLabel,
  requestCustomPlan,
  scheduleDowngrade,
  type AvailablePlans,
  type Feature,
} from '../../../lib/billing';
import { BillingHeader, ConfirmDialog, ErrorBanner, PageLoader, useAuthErrorHandler } from '../BillingShell';
import { ToastHost, type ToastState } from '../Toast';

type PlanRow = AvailablePlans['plans'][number];

const humanize = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

function priceLabel(p: PlanRow) {
  if (p.customPricing) return 'Custom pricing';
  const v = p.version;
  if (!v || v.pricePaise === 0) return 'Free';
  return `${formatMoney(v.pricePaise, v.currency)} / ${intervalLabel(v)}`;
}

function limitLabel(n: number | null | undefined) {
  return n == null ? 'No set limit' : n.toLocaleString('en-IN');
}

function PlansContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();

  const [data, setData] = useState<AvailablePlans | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [downgradeTarget, setDowngradeTarget] = useState<PlanRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [contacting, setContacting] = useState<'idle' | 'opening' | 'existing' | 'failed'>('idle');
  const autoRan = useRef(false);

  const wantsCustom = searchParams.get('custom') === '1';
  const highlightSlug = searchParams.get('plan');

  const load = useCallback(async () => {
    try {
      const [available, pricing] = await Promise.all([getAvailablePlans(), getPublicPricing().catch(() => null)]);
      setData(available);
      setFeatures(pricing?.features ?? []);
      setError(null);
    } catch (e) {
      if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Failed to load plans. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  const talkToTeam = useCallback(
    async (replace = false) => {
      setContacting('opening');
      try {
        const state = await requestCustomPlan();
        if (!state.request) throw new Error('No conversation was opened.');
        if (state.created === false) setContacting('existing');
        const href = `/dashboard/support/${state.request.ticketId}`;
        if (replace) router.replace(href);
        else router.push(href);
      } catch (e) {
        setContacting(replace ? 'failed' : 'idle');
        if (!handleAuthError(e)) {
          setToast({ id: Date.now(), type: 'error', message: billingErrorMessage(e, 'Could not reach our team. Please try again.') });
        }
      }
    },
    [router, handleAuthError],
  );

  // Arriving from the pricing page's "Talk to our team" (?custom=1): open
  // the conversation once, even under strict-mode double effects.
  useEffect(() => {
    if (!isReady || !isAuthed || !wantsCustom || autoRan.current) return;
    autoRan.current = true;
    talkToTeam(true);
  }, [isReady, isAuthed, wantsCustom, talkToTeam]);

  useEffect(() => {
    if (isReady && isAuthed && !wantsCustom) load();
  }, [isReady, isAuthed, wantsCustom, load]);

  // ?plan=<slug>: an upgrade-able plan goes straight to its checkout review
  // (nothing is charged until the customer clicks Pay); otherwise the plan is
  // highlighted and scrolled into view.
  const highlightRedirected = useRef(false);
  useEffect(() => {
    if (!data || !highlightSlug || highlightRedirected.current) return;
    const target = data.plans.find((p) => p.slug === highlightSlug || p.id === highlightSlug);
    if (!target) return;
    highlightRedirected.current = true;
    if (target.relation === 'upgrade' && !target.customPricing) {
      router.replace(`/dashboard/billing/checkout?plan=${encodeURIComponent(target.id)}`);
      return;
    }
    document.getElementById(`plan-${target.id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [data, highlightSlug, router]);

  const featureName = useMemo(() => {
    const map = new Map(features.map((f) => [f.key, f.name]));
    return (key: string) => map.get(key) ?? humanize(key);
  }, [features]);

  const confirmDowngrade = async () => {
    if (!downgradeTarget) return;
    setBusy(true);
    try {
      await scheduleDowngrade(downgradeTarget.id);
      setToast({ id: Date.now(), type: 'success', message: `Switch to ${downgradeTarget.name} scheduled for the end of this period.` });
      setDowngradeTarget(null);
      await load();
    } catch (e) {
      if (!handleAuthError(e)) setToast({ id: Date.now(), type: 'error', message: billingErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (wantsCustom || contacting !== 'idle') {
    return (
      <div className="flex flex-col gap-6">
        <ToastHost toast={toast} onDismiss={() => setToast(null)} />
        <BillingHeader title="Plans" subtitle="Simple prepaid plans with included usage credits." />
        {contacting === 'failed' ? (
          <div className="flex flex-col items-center gap-3 py-16" role="alert">
            <p className="text-sm text-[#3D3650]">We couldn’t open a conversation with our team.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => talkToTeam(true)}>
                Try again
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { setContacting('idle'); router.replace('/dashboard/billing/plans'); }}>
                View plans
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16" role="status">
            <Loader2 className="animate-spin h-6 w-6 text-[#7F40E8]" />
            <p className="text-sm text-[#3D3650]">
              {contacting === 'existing' ? 'Opening your existing conversation…' : 'Opening a conversation with our team…'}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <BillingHeader title="Plans" subtitle="Simple prepaid plans with included usage credits." />
        <PageLoader label="Loading plans…" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-6">
        <BillingHeader title="Plans" subtitle="Simple prepaid plans with included usage credits." />
        <ErrorBanner message={error ?? 'Plans are unavailable.'} onRetry={() => { setLoading(true); load(); }} />
      </div>
    );
  }

  const assigned = data.plans.filter((p) => p.type === 'CUSTOM' && !p.customPricing);
  const catalog = data.plans.filter((p) => !(p.type === 'CUSTOM' && !p.customPricing));
  const periodEnd = formatDate(data.current.currentPeriodEnd);
  const allPlans = [...assigned, ...catalog];
  const featureKeys = Array.from(
    new Set([...features.map((f) => f.key), ...allPlans.flatMap((p) => p.version?.features ?? [])]),
  ).filter((k) => allPlans.some((p) => p.version?.features.includes(k)));

  const renderCard = (p: PlanRow) => {
    const v = p.version;
    const highlighted = !!highlightSlug && (p.slug === highlightSlug || p.id === highlightSlug);
    return (
      <div
        key={p.id}
        id={`plan-${p.id}`}
        data-testid={`plan-card-${p.slug}`}
        className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
          p.isCurrent ? 'border-[#7F40E8] ring-2 ring-[#7F40E8]/20' : highlighted ? 'border-[#7F40E8] ring-2 ring-[#7F40E8]/40' : 'border-[#E7DFF5]'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-bold text-[#170B2E]">{p.name}</h3>
          {p.type === 'CUSTOM' && !p.customPricing && <Badge variant="purple">Custom plan</Badge>}
          {p.badge && <Badge variant="purple">{p.badge}</Badge>}
          {p.isPopular && !p.badge && <Badge variant="purple">Popular</Badge>}
          {p.isCurrent && <Badge variant="success">Current</Badge>}
        </div>
        {p.description && <p className="text-xs text-[#3D3650] mt-1">{p.description}</p>}
        <p className="text-2xl font-bold text-[#170B2E] mt-4">{priceLabel(p)}</p>
        {v && !p.customPricing && (
          <p className="text-sm text-[#3D3650] mt-1">{formatCredits(v.includedCredits)} credits included</p>
        )}
        <ul className="mt-4 space-y-1.5 text-xs text-[#3D3650] flex-1">
          {(v?.features ?? []).map((f) => (
            <li key={f} className="flex items-start gap-1.5">
              <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" /> {featureName(f)}
            </li>
          ))}
        </ul>
        <div className="mt-5">
          {p.relation === 'current' ? (
            <Button size="sm" variant="secondary" disabled className="w-full">
              Current plan
            </Button>
          ) : p.relation === 'upgrade' ? (
            <Button size="sm" className="w-full" onClick={() => router.push(`/dashboard/billing/checkout?plan=${encodeURIComponent(p.id)}`)}>
              {data.current.planType === 'FREE' ? 'Choose' : 'Upgrade'}
            </Button>
          ) : p.relation === 'downgrade' ? (
            <Button size="sm" variant="secondary" className="w-full" onClick={() => setDowngradeTarget(p)}>
              Switch at period end
            </Button>
          ) : (
            <Button size="sm" className="w-full" onClick={() => talkToTeam(false)}>
              {p.ctaLabel || 'Talk to our team'}
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <BillingHeader
        title="Plans"
        subtitle="Simple prepaid plans with included usage credits. Pay upfront each period — auto-renew optional."
      />

      {assigned.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-[#170B2E] inline-flex items-center gap-1.5">
            <Sparkles size={14} className="text-[#6425C4]" /> Your custom plans
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{assigned.map(renderCard)}</div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{catalog.map(renderCard)}</div>

      <p className="text-xs text-[#3D3650]">
        Upgrades start right away: you pay the new plan’s full price and its credits are added — credits from your current plan stay
        usable until they expire. Downgrades take effect at the end of your current period.
      </p>

      {allPlans.length > 1 && (
        <section className="rounded-2xl border border-[#E7DFF5] bg-white p-6">
          <h2 className="text-sm font-semibold text-[#170B2E] mb-4">Compare plans</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="plan-comparison">
              <thead>
                <tr className="border-b border-[#E7DFF5] text-left">
                  <th className="py-2 pr-4 text-xs font-medium text-[#3D3650]" />
                  {allPlans.map((p) => (
                    <th key={p.id} className="py-2 px-3 text-xs font-semibold text-[#170B2E] whitespace-nowrap">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <CompareRow label="Price" values={allPlans.map(priceLabel)} />
                <CompareRow
                  label="Included credits"
                  values={allPlans.map((p) => (p.customPricing || !p.version ? 'Custom' : formatCredits(p.version.includedCredits)))}
                />
                {featureKeys.map((k) => (
                  <tr key={k} className="border-b border-[#E7DFF5]/60 last:border-0">
                    <td className="py-2 pr-4 text-xs text-[#3D3650]">{featureName(k)}</td>
                    {allPlans.map((p) => (
                      <td key={p.id} className="py-2 px-3">
                        {p.version?.features.includes(k) ? (
                          <Check size={14} className="text-emerald-600" aria-label="Included" />
                        ) : (
                          <Minus size={14} className="text-[#C4AEE8]" aria-label="Not included" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={!!downgradeTarget}
        title={`Switch to ${downgradeTarget?.name ?? ''} at period end?`}
        confirmLabel="Schedule switch"
        busy={busy}
        onCancel={() => setDowngradeTarget(null)}
        onConfirm={confirmDowngrade}
      >
        {downgradeTarget?.type === 'FREE' ? (
          <p>
            Your {data.current.planName ?? 'current'} plan stays active until {periodEnd}, with all its credits and features. After that
            you’ll move to the Free plan. Plan payments are not refunded.
          </p>
        ) : (
          <p>
            You stay on {data.current.planName ?? 'your current plan'} until {periodEnd}. At the end of the period you can renew on{' '}
            {downgradeTarget?.name} ({downgradeTarget ? priceLabel(downgradeTarget) : ''}). If auto-renew is on, it will charge the new plan's price from then.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function CompareRow({ label, values }: { label: string; values: string[] }) {
  return (
    <tr className="border-b border-[#E7DFF5]/60">
      <td className="py-2 pr-4 text-xs text-[#3D3650]">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="py-2 px-3 text-xs text-[#170B2E] whitespace-nowrap">
          {v}
        </td>
      ))}
    </tr>
  );
}

export default function PlansPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading plans…" />}>
      <PlansContent />
    </Suspense>
  );
}
