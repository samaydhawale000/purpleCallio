'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Clock,
  Coins,
  MessageSquare,
  Monitor,
  PhoneCall,
  RefreshCw,
  Sparkles,
  Video,
} from 'lucide-react';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  cancelSubscription,
  CREDIT_SOURCE_LABEL,
  describeCreditTransaction,
  formatCredits,
  formatDate,
  formatMoney,
  getBillingOverview,
  getCreditHistory,
  intervalLabel,
  resumeSubscription,
  stopAutoRenew,
  billingErrorMessage,
  SUBSCRIPTION_STATUS_LABEL,
  usageBreakdown,
  type BillingOverview,
  type CreditTransactionRow,
  type SubscriptionStatus,
} from '../../lib/billing';
import { BillingHeader, ConfirmDialog, ErrorBanner, PageLoader, SectionCard, useAuthErrorHandler } from './BillingShell';
import PrepaidExplainer from './PrepaidExplainer';
import { runAutoRenewSetup } from '../../lib/checkout';
import { ToastHost, type ToastState } from './Toast';

const STATUS_VARIANT: Record<SubscriptionStatus, 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'> = {
  DRAFT: 'default',
  PENDING_PAYMENT: 'warning',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  EXPIRED: 'error',
  CANCELED: 'default',
  SUSPENDED: 'error',
};

export default function BillingOverviewPage() {
  const router = useRouter();
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();

  const [data, setData] = useState<BillingOverview | null>(null);
  const [history, setHistory] = useState<CreditTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmAutoRenewOff, setConfirmAutoRenewOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [overview, usage] = await Promise.all([
        getBillingOverview(),
        getCreditHistory(1, 'USAGE_DEBIT').catch(() => null),
      ]);
      setData(overview);
      setHistory(usage?.data ?? []);
      setError(null);
    } catch (e) {
      if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Failed to load billing details. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    if (isReady && isAuthed) load();
  }, [isReady, isAuthed, load]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      setToast({ id: Date.now(), type: 'success', message: success });
      await load();
    } catch (e) {
      if (!handleAuthError(e)) setToast({ id: Date.now(), type: 'error', message: billingErrorMessage(e) });
    } finally {
      setBusy(false);
      setConfirmCancel(false);
      setConfirmAutoRenewOff(false);
    }
  };

  /** Authorize a recurring mandate for the current plan (nothing charged until period end). */
  const enableAutoRenew = async () => {
    setBusy(true);
    try {
      const r = await runAutoRenewSetup();
      if (r.kind === 'enabled') {
        setToast({ id: Date.now(), type: 'success', message: 'Auto-renew is on.' });
        await load();
      } else if (r.kind === 'failed') {
        setToast({ id: Date.now(), type: 'error', message: r.message });
      }
    } catch (e) {
      if (!handleAuthError(e)) setToast({ id: Date.now(), type: 'error', message: billingErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <BillingHeader title="Billing" subtitle="Your plan, credit balance and usage." />
        <PageLoader />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-6">
        <BillingHeader title="Billing" subtitle="Your plan, credit balance and usage." />
        <ErrorBanner message={error ?? 'Billing details are unavailable.'} onRetry={() => { setLoading(true); load(); }} />
      </div>
    );
  }

  const sub = data.subscription;
  const isFree = sub.planType === 'FREE';
  const planName = data.plan?.name ?? sub.planName ?? 'Free';
  const periodEnd = formatDate(sub.currentPeriodEnd);
  const scheduledFree = data.scheduledPlan?.type === 'FREE';
  const scheduledPaid = data.scheduledPlan && !scheduledFree ? data.scheduledPlan : null;
  const cancelling = !isFree && (sub.cancelAtPeriodEnd || scheduledFree);
  const wallet = data.wallet;
  const exhausted = wallet.available <= 0;
  const low = !exhausted && wallet.usedPercent >= 80;
  const usage = data.usage;
  const sentOffer = data.customPlan?.offers?.find((o) => o.status === 'SENT');
  const openRequest = data.customPlan?.request?.open ? data.customPlan.request : null;
  const ended = data.lastEndedPaidSubscription;
  const ar = data.autoRenew;
  const autoRenewOn = !!ar?.autoRenew && !cancelling;
  const renewalRetrying = autoRenewOn && ar?.status === 'pending';
  const AUTO_RENEW_OFF_REASON: Record<string, string> = {
    renewal_failed: 'Auto-renew stopped because renewal payments kept failing.',
    renewal_terms_changed: 'Auto-renew was switched off because the plan’s price changed and your mandate couldn’t be updated.',
    plan_unavailable: 'This plan is no longer offered, so it can’t auto-renew.',
    mandate_cancelled: 'The auto-pay mandate was cancelled with your bank or payment app.',
  };
  const offReasonText = !isFree && ar && !ar.autoRenew && ar.offReason ? AUTO_RENEW_OFF_REASON[ar.offReason] : null;

  return (
    <div className="flex flex-col gap-6">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <BillingHeader title="Billing" subtitle="Your plan, credit balance and usage." />

      {/* ── Notices ── */}
      {isFree && ended && (
        <Notice tone="warning" icon={<CalendarClock size={16} />}>
          <span>
            Your {ended.planName ?? 'paid'} plan ended on {formatDate(ended.currentPeriodEnd ?? ended.expiredAt)}.
          </span>
          <Link href="/dashboard/billing/checkout?renew=1" className="font-semibold text-[#6425C4] hover:underline">
            Renew
          </Link>
        </Notice>
      )}
      {data.pendingCheckout && (
        <Notice tone="info" icon={<Clock size={16} />}>
          <span>
            A checkout{data.pendingCheckout.planName ? ` for ${data.pendingCheckout.planName}` : ''} started on{' '}
            {formatDate(data.pendingCheckout.createdAt)} hasn’t been completed. Your plan changes only after payment is confirmed.
          </span>
        </Notice>
      )}
      {(exhausted || low) && (
        <Notice tone={exhausted ? 'error' : 'warning'} icon={<AlertTriangle size={16} />} testId="credit-alert">
          <span>
            {exhausted
              ? 'You’re out of credits. New calls are paused until you add credits. Calls already in progress are not cut off.'
              : `You’ve used ${wallet.usedPercent}% of your credits this period.`}
          </span>
          <span className="flex gap-3">
            <Link href="/dashboard/billing/credits#topups" className="font-semibold text-[#6425C4] hover:underline">
              Buy more credits
            </Link>
            <Link href="/dashboard/billing/plans" className="font-semibold text-[#6425C4] hover:underline">
              Upgrade
            </Link>
          </span>
        </Notice>
      )}

      {/* ── Custom plan ── */}
      {sentOffer ? (
        <div
          className="rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center gap-4"
          style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.10), rgba(65,6,134,0.06))', borderColor: '#C4AEE8' }}
          data-testid="custom-offer-card"
        >
          <Sparkles size={22} className="text-[#6425C4] shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#170B2E]">Your custom plan is ready</p>
            <p className="text-xs text-[#3D3650] mt-0.5">
              {sentOffer.plan.name}
              {sentOffer.plan.version ? ` · ${formatMoney(sentOffer.plan.version.pricePaise, sentOffer.plan.version.currency)} / ${intervalLabel(sentOffer.plan.version)}` : ''}
              {sentOffer.expiresAt ? ` · offer valid until ${formatDate(sentOffer.expiresAt)}` : ''}
            </p>
          </div>
          <Link href={`/dashboard/billing/offers/${sentOffer.id}`}>
            <Button size="sm">Review offer</Button>
          </Link>
        </div>
      ) : openRequest ? (
        <Notice tone="info" icon={<MessageSquare size={16} />}>
          <span>Custom plan conversation in progress ({openRequest.ticketNumber}).</span>
          <Link href={`/dashboard/support/${openRequest.ticketId}`} className="font-semibold text-[#6425C4] hover:underline">
            Open conversation
          </Link>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Current plan ── */}
        <SectionCard
          title="Current plan"
          actions={<Badge variant={STATUS_VARIANT[sub.status] ?? 'default'}>{SUBSCRIPTION_STATUS_LABEL[sub.status] ?? sub.status}</Badge>}
        >
          <div data-testid="current-plan">
            <p className="text-2xl font-bold text-[#170B2E]">{planName}</p>
            <p className="text-sm text-[#3D3650] mt-1">
              {isFree || sub.pricePaise === 0
                ? 'Free'
                : `${formatMoney(sub.pricePaise, sub.currency)}${sub.billingInterval ? ` / ${intervalLabel({ billingInterval: sub.billingInterval, intervalCount: sub.intervalCount })}` : ''}`}
              {' · '}
              {formatCredits(sub.includedCredits)} credits included
            </p>

            <div className="mt-3 text-sm text-[#3D3650] space-y-1">
              {isFree ? (
                <p>Current period ends {periodEnd}. Your Free plan credits refresh each period.</p>
              ) : cancelling ? (
                <p className="text-amber-700">
                  Your plan remains active until {periodEnd}. After that you’ll move to the Free plan.
                </p>
              ) : scheduledPaid ? (
                <p className="text-amber-700">
                  Switches to {scheduledPaid.name} at the end of this period ({periodEnd}). You’ll pay for {scheduledPaid.name} when you renew.
                </p>
              ) : autoRenewOn ? (
                <p className="flex items-center gap-1.5">
                  <RefreshCw size={13} className="text-[#7F40E8]" />
                  Renews automatically on {periodEnd}
                  {ar?.renewalAmountPaise != null ? ` for ${formatMoney(ar.renewalAmountPaise, sub.currency)} (incl. GST)` : ''}.
                </p>
              ) : (
                <p>Active until {periodEnd}. Auto-renew is off — renew before then to keep your plan.</p>
              )}
              {scheduledPaid && autoRenewOn && (
                <p className="text-xs">Auto-renew will charge for {scheduledPaid.name} at the end of this period.</p>
              )}
              {renewalRetrying && (
                <p className="text-xs text-amber-700">
                  Your last renewal payment didn’t go through — your payment provider is retrying. Your plan stays active meanwhile.
                </p>
              )}
              {offReasonText && <p className="text-xs text-amber-700">{offReasonText}</p>}
              {!isFree && data.renewal && !cancelling && !scheduledPaid && !autoRenewOn && (
                <p className="text-xs">
                  Renewal: {formatMoney(data.renewal.pricePaise, sub.currency)} for {formatCredits(data.renewal.includedCredits)} credits
                  {data.renewal.termsChanged ? ' — this plan’s price or included credits have changed since you bought it.' : '.'}
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {cancelling || scheduledPaid ? (
                <Button size="sm" loading={busy} onClick={() => act(resumeSubscription, `You’ll stay on ${planName}.`)}>
                  {cancelling ? 'Resume plan' : 'Keep current plan'}
                </Button>
              ) : (
                <>
                  <Link href="/dashboard/billing/plans">
                    <Button size="sm">Upgrade</Button>
                  </Link>
                  {!isFree && data.renewal && !autoRenewOn && (
                    <Link href="/dashboard/billing/checkout?renew=1">
                      <Button size="sm" variant="secondary">Renew</Button>
                    </Link>
                  )}
                </>
              )}
              <Link href="/dashboard/billing/plans">
                <Button size="sm" variant="secondary">Manage plan</Button>
              </Link>
              {!isFree && !cancelling && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
                  Cancel plan
                </Button>
              )}
            </div>

            {!isFree && !cancelling && (
              <div
                className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7DFF5] bg-[#F8F4FD] px-4 py-3"
                data-testid="auto-renew-control"
              >
                <div className="text-sm">
                  <p className="font-semibold text-[#170B2E]">Auto-renew {autoRenewOn ? 'on' : 'off'}</p>
                  <p className="text-xs text-[#3D3650]">
                    {autoRenewOn
                      ? 'Your card / UPI mandate is charged at the start of each period. Price changes are announced before they apply.'
                      : data.renewal
                        ? 'Turn it on to renew automatically on your saved card or UPI Autopay. Nothing is charged until this period ends.'
                        : 'This plan is no longer offered, so it can’t renew.'}
                  </p>
                </div>
                {autoRenewOn ? (
                  <Button size="sm" variant="secondary" onClick={() => setConfirmAutoRenewOff(true)}>
                    Turn off
                  </Button>
                ) : data.renewal ? (
                  <Button size="sm" loading={busy} onClick={enableAutoRenew}>
                    Turn on auto-renew
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Credit balance ── */}
        <SectionCard
          title="Credit balance"
          actions={
            <Link href="/dashboard/billing/credits" className="inline-flex items-center gap-1 text-xs font-medium text-[#6425C4]">
              View credits <ArrowUpRight size={13} />
            </Link>
          }
        >
          <div data-testid="credit-balance">
            <p className="text-3xl font-bold text-[#170B2E]">
              {formatCredits(wallet.available)}
              <span className="text-sm font-normal text-[#3D3650]"> credits available</span>
            </p>
            <p className="text-xs text-[#3D3650] mt-1">
              {formatCredits(wallet.used)} used this period
              {wallet.reserved > 0 ? ` · ${formatCredits(wallet.reserved)} held for active calls` : ''}
            </p>
            <div className="mt-3">
              <div className="flex justify-between text-[11px] text-[#3D3650] mb-1">
                <span>Used</span>
                <span>{wallet.usedPercent}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E7DFF5' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(0, wallet.usedPercent))}%`,
                    background:
                      wallet.usedPercent >= 80 ? 'linear-gradient(135deg,#f43f5e,#fb7185)' : 'linear-gradient(135deg,#7F40E8,#410686)',
                  }}
                />
              </div>
            </div>
            {wallet.buckets.length > 0 && (
              <ul className="mt-4 divide-y divide-[#E7DFF5] border border-[#E7DFF5] rounded-lg">
                {wallet.buckets.map((b) => (
                  <li key={b.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="text-[#170B2E] font-medium">{CREDIT_SOURCE_LABEL[b.source] ?? b.source}</span>
                    <span className="text-[#3D3650]">
                      {formatCredits(b.remaining)} left · {b.expiresAt ? `expires ${formatDate(b.expiresAt)}` : 'no expiry'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Link href="/dashboard/billing/credits#topups">
                <Button size="sm" variant="secondary">
                  <Coins size={14} /> Buy more credits
                </Button>
              </Link>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Usage this period ── */}
      <SectionCard
        title="Usage this period"
        subtitle={`${formatDate(usage.cycle.start)} – ${formatDate(usage.cycle.end)} · credits consumed by media type`}
        actions={
          <Link href="/dashboard/usage" className="inline-flex items-center gap-1 text-xs font-medium text-[#6425C4]">
            Usage details <ArrowUpRight size={13} />
          </Link>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="usage-by-media">
          <MediaTile
            icon={<PhoneCall size={15} className="text-[#7F40E8]" />}
            label="Audio"
            credits={usage.credits.audio}
            minutes={usage.usage.audioMinutes}
            rate={usage.creditRates.audioCreditsPerMinute}
            unit="audio"
          />
          <MediaTile
            icon={<Video size={15} className="text-[#A05DF9]" />}
            label="Video"
            credits={usage.credits.video}
            minutes={usage.usage.videoMinutes}
            rate={usage.creditRates.videoCreditsPerMinute}
            unit="video"
          />
          <MediaTile
            icon={<Monitor size={15} className="text-emerald-500" />}
            label="Screen share"
            credits={usage.credits.screenShare}
            minutes={usage.usage.screenShareMinutes}
            rate={usage.creditRates.screenShareCreditsPerMinute}
            unit="screen share"
          />
        </div>
        <p className="text-xs text-[#3D3650] mt-3">
          Total: <span className="font-semibold text-[#170B2E]">{formatCredits(usage.credits.total)} credits</span> across{' '}
          {usage.usage.callsCompleted} completed calls. A participant-minute is one minute of one participant using that media.
        </p>
      </SectionCard>

      {/* ── Recent usage ── */}
      <SectionCard
        title="Recent usage"
        subtitle="Credits consumed per call"
        actions={
          <Link href="/dashboard/billing/credits" className="inline-flex items-center gap-1 text-xs font-medium text-[#6425C4]">
            Full credit history <ArrowUpRight size={13} />
          </Link>
        }
      >
        {history.length === 0 ? (
          <p className="text-sm text-[#3D3650] py-4 text-center">No calls have used credits yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="recent-usage">
              <thead>
                <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Call</th>
                  <th className="py-2 pr-4 font-medium">Media</th>
                  <th className="py-2 pr-4 font-medium">Usage</th>
                  <th className="py-2 font-medium text-right">Credits</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const parts = usageBreakdown(row.metadata).filter((p) => p.minutes > 0);
                  const callId = typeof row.metadata?.callId === 'string' ? row.metadata.callId : row.referenceId;
                  return (
                    <tr key={row.id} className="border-b border-[#E7DFF5]/60 last:border-0">
                      <td className="py-2.5 pr-4 text-[#3D3650] whitespace-nowrap">{formatDate(row.createdAt)}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-[#3D3650]">{callId ? `${callId.slice(0, 12)}…` : '—'}</td>
                      <td className="py-2.5 pr-4 text-[#3D3650]">{parts.map((p) => p.label).join(', ') || '—'}</td>
                      <td className="py-2.5 pr-4 text-[#3D3650] whitespace-nowrap">
                        {parts.reduce((s, p) => s + p.minutes, 0).toFixed(2)} participant-min
                      </td>
                      <td className="py-2.5 text-right font-medium text-[#170B2E]" title={describeCreditTransaction(row)}>
                        {formatCredits(Math.abs(row.amount))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <PrepaidExplainer />

      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel ${planName}?`}
        confirmLabel="Cancel plan"
        cancelLabel="Keep plan"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => act(cancelSubscription, `Your plan remains active until ${periodEnd}.`)}
      >
        <p>Your plan stays active until {periodEnd}. You keep its credits and features until then, and then move to the Free plan.</p>
        <p>Plan payments are not refunded. You can resume anytime before {periodEnd}.</p>
        {autoRenewOn && <p>Auto-renew will be turned off, so nothing more will be charged.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmAutoRenewOff}
        title="Turn off auto-renew?"
        confirmLabel="Turn off"
        cancelLabel="Keep auto-renew"
        busy={busy}
        onCancel={() => setConfirmAutoRenewOff(false)}
        onConfirm={() => act(stopAutoRenew, `Auto-renew is off. ${planName} stays active until ${periodEnd}.`)}
      >
        <p>{planName} stays active until {periodEnd} with all its credits. After that it won’t renew unless you renew it yourself or turn auto-renew back on.</p>
      </ConfirmDialog>
    </div>
  );

}

function MediaTile({
  icon,
  label,
  credits,
  minutes,
  rate,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  credits: number;
  minutes: number;
  rate: number;
  unit: string;
}) {
  return (
    <div className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#F8F4FD' }}>
      <div className="flex items-center gap-1.5 text-xs text-[#3D3650]">
        {icon} {label}
      </div>
      <p className="text-lg font-bold text-[#170B2E] mt-1">
        {formatCredits(credits)}
        <span className="text-xs font-normal text-[#3D3650]"> credits</span>
      </p>
      <p className="text-[11px] text-[#3D3650]">{minutes.toFixed(2)} participant-min</p>
      <p className="text-[11px] text-[#6425C4] mt-1">
        1 {unit} participant-minute = {formatCredits(rate)} credit{rate === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function Notice({
  tone,
  icon,
  children,
  testId,
}: {
  tone: 'info' | 'warning' | 'error';
  icon: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  const styles = {
    info: { background: 'rgba(127,64,232,0.06)', borderColor: 'rgba(127,64,232,0.25)', color: '#410686' },
    warning: { background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)', color: '#92400E' },
    error: { background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.3)', color: '#B91C1C' },
  }[tone];
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} data-testid={testId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm" style={styles}>
      <span className="inline-flex flex-wrap items-center gap-2">
        {icon}
        {children}
      </span>
    </div>
  );
}
