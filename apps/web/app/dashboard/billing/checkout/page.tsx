'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { Button } from '../../../components/ui/Button';
import {
  billingErrorMessage,
  formatCredits,
  formatDate,
  formatMoneyExact,
  getPublicPricing,
  quoteCheckout,
  type CheckoutQuote,
  type CheckoutRequest,
  type Feature,
  type PaymentOutcome,
} from '../../../lib/billing';
import { runCheckout } from '../../../lib/checkout';
import { BillingHeader, ErrorBanner, PageLoader, useAuthErrorHandler } from '../BillingShell';

type Phase =
  | { kind: 'review' }
  | { kind: 'processing' }
  | { kind: 'paid'; outcome: PaymentOutcome }
  | { kind: 'failed'; message: string; outcome: PaymentOutcome | null }
  | { kind: 'pending'; outcome: PaymentOutcome };

function useCheckoutRequest(): CheckoutRequest | null {
  const params = useSearchParams();
  const plan = params.get('plan');
  const renew = params.get('renew');
  const topup = params.get('topup');
  const offer = params.get('offer');
  return useMemo(() => {
    if (plan) return { kind: 'plan', planId: plan };
    if (renew) return { kind: 'renewal' };
    if (topup) return { kind: 'topup', topUpPackageId: topup };
    if (offer) return { kind: 'offer', offerId: offer };
    return null;
  }, [plan, renew, topup, offer]);
}

function CheckoutContent() {
  const request = useCheckoutRequest();
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();

  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'review' });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!request) {
      setError('Nothing to check out. Choose a plan or a credit top-up first.');
      setLoading(false);
      return;
    }
    try {
      const [q, pricing] = await Promise.all([quoteCheckout(request), getPublicPricing().catch(() => null)]);
      setQuote(q);
      setFeatures(pricing?.features ?? []);
      setError(null);
    } catch (e) {
      if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Could not prepare this checkout. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [request, handleAuthError]);

  useEffect(() => {
    if (isReady && isAuthed) load();
  }, [isReady, isAuthed, load]);

  const pay = async () => {
    if (!request) return;
    setNotice(null);
    setPhase({ kind: 'processing' });
    try {
      const result = await runCheckout(request);
      if (result.kind === 'paid') setPhase({ kind: 'paid', outcome: result.outcome });
      else if (result.kind === 'pending') setPhase({ kind: 'pending', outcome: result.outcome });
      else if (result.kind === 'failed') setPhase({ kind: 'failed', message: result.message, outcome: result.outcome });
      else {
        setPhase({ kind: 'review' });
        setNotice('Payment window closed. You have not been charged.');
      }
    } catch (e) {
      if (handleAuthError(e)) return;
      setPhase({ kind: 'failed', message: billingErrorMessage(e, 'Payment could not be started.'), outcome: null });
    }
  };

  const isTopUp = quote?.summary.type === 'topup' || request?.kind === 'topup';
  const title = isTopUp ? 'Buy credits' : request?.kind === 'renewal' ? 'Renew plan' : 'Checkout';
  const back = isTopUp ? '/dashboard/billing/credits#topups' : '/dashboard/billing/plans';
  const featureName = (k: string) => features.find((f) => f.key === k)?.name ?? k;

  const header = (
    <div className="flex flex-col gap-4">
      <BillingHeader title={title} subtitle="Review your order. This is a one-time payment — plans don’t renew automatically." />
      {phase.kind === 'review' && (
        <Link href={back} className="inline-flex items-center gap-1.5 text-sm text-[#3D3650] hover:text-[#170B2E] w-fit">
          <ArrowLeft size={14} /> Back
        </Link>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <PageLoader label="Preparing your order…" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorBanner message={error ?? 'Checkout is unavailable.'} onRetry={request ? () => { setLoading(true); load(); } : undefined} />
      </div>
    );
  }

  if (phase.kind === 'paid') {
    const o = phase.outcome;
    const credits = o.credits || quote.credits;
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ResultCard tone="success" icon={<CheckCircle2 size={28} className="text-emerald-600" />} title="Payment successful">
          {isTopUp ? (
            <p>{formatCredits(credits)} credits added to your account.</p>
          ) : (
            <>
              <p>You’re now on {o.subscription?.planName ?? quote.summary.planName}.</p>
              <p>{formatCredits(credits)} credits have been added to your account.</p>
              {o.subscription?.currentPeriodEnd && <p>Active until {formatDate(o.subscription.currentPeriodEnd)}.</p>}
            </>
          )}
          {o.receiptNumber != null && <p className="text-xs">A receipt is available under Payments &amp; receipts.</p>}
          <div className="flex flex-wrap justify-center gap-2 pt-3">
            <Link href="/dashboard/billing">
              <Button size="sm">Go to billing</Button>
            </Link>
            <Link href="/dashboard/billing/payments">
              <Button size="sm" variant="secondary">View receipt</Button>
            </Link>
          </div>
        </ResultCard>
      </div>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ResultCard tone="error" icon={<XCircle size={28} className="text-red-600" />} title="Payment failed">
          <p>
            {isTopUp
              ? 'Payment failed. No credits have been added.'
              : 'Payment failed. Your subscription has not been activated.'}
          </p>
          {phase.message && <p className="text-xs">{phase.outcome?.failureReason ?? phase.message}</p>}
          <div className="flex flex-wrap justify-center gap-2 pt-3">
            <Button size="sm" onClick={() => setPhase({ kind: 'review' })}>
              Try again
            </Button>
            <Link href={back}>
              <Button size="sm" variant="secondary">Back</Button>
            </Link>
          </div>
        </ResultCard>
      </div>
    );
  }

  if (phase.kind === 'pending') {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ResultCard tone="info" icon={<Clock size={28} className="text-[#7F40E8]" />} title="We’re confirming your payment…">
          <p>
            Your bank hasn’t confirmed the payment yet. We’ll activate your {isTopUp ? 'credits' : 'plan'} as soon as it does — you’ll get a
            notification. You don’t need to pay again.
          </p>
          <div className="flex justify-center pt-3">
            <Link href="/dashboard/billing/payments">
              <Button size="sm" variant="secondary">View payments</Button>
            </Link>
          </div>
        </ResultCard>
      </div>
    );
  }

  const s = quote.summary;
  const processing = phase.kind === 'processing';

  return (
    <div className="flex flex-col gap-6">
      {header}
      {notice && (
        <div role="status" className="rounded-lg border border-[#E7DFF5] px-4 py-3 text-sm text-[#3D3650]" style={{ background: '#F8F4FD' }}>
          {notice}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 max-w-5xl">
        <section className="lg:col-span-3 rounded-2xl border border-[#E7DFF5] bg-white p-6" data-testid="checkout-summary">
          <p className="text-xs uppercase tracking-wider text-[#3D3650]">{isTopUp ? 'Credit top-up' : 'Plan'}</p>
          <h2 className="text-xl font-bold text-[#170B2E] mt-1">{isTopUp ? s.name ?? quote.description : s.planName ?? quote.description}</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {!isTopUp && s.intervalLabel && (
              <div>
                <dt className="text-xs text-[#3D3650]">Billing period</dt>
                <dd className="text-[#170B2E]">1 {s.intervalLabel}{s.renewsFrom ? ` (starts ${formatDate(s.renewsFrom)})` : ''}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-[#3D3650]">{isTopUp ? 'Credits' : 'Included credits'}</dt>
              <dd className="text-[#170B2E]">{formatCredits(s.includedCredits ?? s.credits ?? quote.credits)}</dd>
            </div>
          </dl>
          {!isTopUp && (s.features?.length ?? 0) > 0 && (
            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-[#3D3650]">
              {s.features!.map((f) => (
                <li key={f} className="flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-emerald-600" /> {featureName(f)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-5 text-xs text-[#3D3650]">
            {isTopUp
              ? 'Top-up credits are added to your balance as soon as payment is confirmed.'
              : 'Your plan activates and its credits are added as soon as payment is confirmed. Paid plans don’t renew automatically — you choose when to renew.'}
          </p>
        </section>

        <section className="lg:col-span-2 rounded-2xl border border-[#E7DFF5] bg-white p-6 h-fit" data-testid="checkout-totals">
          <h2 className="text-sm font-semibold text-[#170B2E] mb-3">Order summary</h2>
          <div className="flex flex-col gap-2 text-sm">
            <Row label="Subtotal" value={formatMoneyExact(quote.subtotalPaise, quote.currency)} />
            {quote.discountPaise > 0 && (
              <Row
                label={`Discount${quote.discountPercent != null ? ` (${quote.discountPercent}%)` : ''}${quote.discountReason ? ` — ${quote.discountReason}` : ''}`}
                value={`−${formatMoneyExact(quote.discountPaise, quote.currency)}`}
              />
            )}
            <Row label={`GST (${quote.taxPercent}%)`} value={formatMoneyExact(quote.taxPaise, quote.currency)} />
            <div className="flex items-center justify-between border-t border-[#E7DFF5] pt-2 text-base font-bold text-[#170B2E]">
              <span>Total</span>
              <span data-testid="checkout-total">{formatMoneyExact(quote.totalPaise, quote.currency)}</span>
            </div>
          </div>
          <Button className="w-full mt-5" size="lg" onClick={pay} loading={processing} disabled={processing}>
            {processing ? 'Processing payment…' : `Pay ${formatMoneyExact(quote.totalPaise, quote.currency)}`}
          </Button>
          <p className="mt-3 text-[11px] text-[#3D3650] flex items-start gap-1.5">
            <ShieldCheck size={13} className="shrink-0 mt-0.5 text-emerald-600" />
            One-time payment by card, UPI or netbanking. Nothing is charged automatically later.
          </p>
          {processing && (
            <p className="mt-2 text-[11px] text-[#3D3650] inline-flex items-center gap-1.5" role="status">
              <Loader2 size={12} className="animate-spin" /> Complete the payment in the secure payment window.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[#3D3650]">
      <span>{label}</span>
      <span className="font-medium text-[#170B2E] whitespace-nowrap">{value}</span>
    </div>
  );
}

function ResultCard({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'success' | 'error' | 'info';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const border = tone === 'success' ? 'rgba(16,185,129,0.3)' : tone === 'error' ? 'rgba(239,68,68,0.3)' : '#E7DFF5';
  return (
    <section
      role={tone === 'error' ? 'alert' : 'status'}
      className="max-w-lg mx-auto w-full rounded-2xl border bg-white p-8 text-center flex flex-col items-center gap-2"
      style={{ borderColor: border }}
    >
      {icon}
      <h2 className="text-lg font-bold text-[#170B2E]">{title}</h2>
      <div className="text-sm text-[#3D3650] space-y-1">{children}</div>
    </section>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<PageLoader label="Preparing your order…" />}>
      <CheckoutContent />
    </Suspense>
  );
}
