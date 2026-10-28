'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { buttonCls } from '../../_ui';
import {
  billingErrorMessage,
  formatCredits,
  formatDate,
  formatMoneyExact,
  quoteCheckout,
  type CheckoutQuote,
  type CheckoutRequest,
  type PaymentOutcome,
} from '../../../lib/billing';
import { runCheckout } from '../../../lib/checkout';
import {
  BillingHeader,
  ErrorBanner,
  PageLoader,
  useAuthErrorHandler,
} from '../BillingShell';

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
  const amountPaise = params.get('amountPaise');
  const currency = params.get('currency') ?? undefined;
  return useMemo(() => {
    if (amountPaise)
      return {
        kind: 'creditAmount',
        amountPaise: Number(amountPaise),
        currency,
      };
    if (plan) return { kind: 'plan', planId: plan };
    if (renew) return { kind: 'renewal' };
    if (topup) return { kind: 'topup', topUpPackageId: topup };
    if (offer) return { kind: 'offer', offerId: offer };
    return null;
  }, [plan, renew, topup, offer, amountPaise, currency]);
}

function CheckoutContent() {
  const request = useCheckoutRequest();
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();

  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'review' });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!request) {
      setError('Choose a credit purchase from your wallet to continue.');
      setLoading(false);
      return;
    }
    try {
      const q = await quoteCheckout(request);
      setQuote(q);
      setError(null);
    } catch (e) {
      if (!handleAuthError(e))
        setError(
          billingErrorMessage(
            e,
            'Could not prepare this checkout. Please try again.',
          ),
        );
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
      if (result.kind === 'paid')
        setPhase({ kind: 'paid', outcome: result.outcome });
      else if (result.kind === 'pending')
        setPhase({ kind: 'pending', outcome: result.outcome });
      else if (result.kind === 'failed')
        setPhase({
          kind: 'failed',
          message: result.message,
          outcome: result.outcome,
        });
      else {
        setPhase({ kind: 'review' });
        setNotice('Payment window closed. You have not been charged.');
      }
    } catch (e) {
      if (handleAuthError(e)) return;
      setPhase({
        kind: 'failed',
        message: billingErrorMessage(e, 'Payment could not be started.'),
        outcome: null,
      });
    }
  };

  const isTopUp =
    quote?.summary.type === 'topup' ||
    request?.kind === 'topup' ||
    request?.kind === 'creditAmount';
  const title = 'Buy credits';
  const back = '/dashboard/billing?add=1';

  const header = (
    <div className="flex flex-col gap-4">
      <BillingHeader
        title={title}
        subtitle="Review your order before you pay."
      />
      {phase.kind === 'review' && (
        <Link
          href={back}
          className="inline-flex w-fit items-center gap-1 text-[13px] text-[#6B6478] hover:text-[#170B2E]"
        >
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
        <ErrorBanner
          message={error ?? 'Checkout is unavailable.'}
          onRetry={
            request
              ? () => {
                  setLoading(true);
                  load();
                }
              : undefined
          }
        />
      </div>
    );
  }

  if (phase.kind === 'paid') {
    const o = phase.outcome;
    const credits = o.credits || quote.credits;
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ResultCard
          tone="success"
          icon={<CheckCircle2 size={28} className="text-emerald-600" />}
          title="Payment successful"
        >
          <p>
            {formatCredits(credits)} credits added to your account
            {quote.summary.expiryAt
              ? ` and expire ${formatDate(quote.summary.expiryAt)}.`
              : '.'}
          </p>
          {o.receiptNumber != null && (
            <p className="text-xs">
              A receipt is available under Payments &amp; receipts.
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-3">
            <Link href="/dashboard/billing" className={buttonCls('primary')}>
              Go to billing
            </Link>
            <Link href="/dashboard/billing/payments" className={buttonCls('secondary')}>
              View receipt
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
        <ResultCard
          tone="error"
          icon={<XCircle size={28} className="text-red-600" />}
          title="Payment failed"
        >
          <p>Payment failed. No credits have been added.</p>
          {phase.message && (
            <p className="text-xs">
              {phase.outcome?.failureReason ?? phase.message}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2 pt-3">
            <button type="button" className={buttonCls('primary')} onClick={() => setPhase({ kind: 'review' })}>
              Try again
            </button>
            <Link href={back} className={buttonCls('secondary')}>
              Back
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
        <ResultCard
          tone="info"
          icon={<Clock size={28} className="text-[#6D28D9]" />}
          title="We’re confirming your payment…"
        >
          <p>
            Your bank hasn’t confirmed the payment yet. We’ll add your credits
            as soon as it does — you’ll get a notification. You don’t need to
            pay again.
          </p>
          <div className="flex justify-center pt-3">
            <Link href="/dashboard/billing/payments" className={buttonCls('secondary')}>
              View payments
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
        <div role="status" className="rounded-lg bg-[#F1EBFC] px-4 py-3 text-sm text-[#4C1D95]">
          {notice}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 max-w-5xl">
        <section
          className="rounded-xl bg-[#F7F6FA] p-5 lg:col-span-3"
          data-testid="checkout-summary"
        >
          <p className="text-xs uppercase tracking-wider text-[#6B6478]">
            Credit top-up
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[#170B2E]">
            {s.name ?? quote.description}
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[#6B6478]">Credits</dt>
              <dd className="text-[#170B2E]">
                {formatCredits(s.includedCredits ?? s.credits ?? quote.credits)}
              </dd>
            </div>
            {isTopUp && s.creditPricePaise != null && (
              <div>
                <dt className="text-xs text-[#6B6478]">
                  Published credit price
                </dt>
                <dd className="text-[#170B2E]">
                  {formatMoneyExact(s.creditPricePaise, quote.currency)} per
                  credit {s.pricingVersion ? `(v${s.pricingVersion})` : ''}
                </dd>
              </div>
            )}
            {isTopUp && s.creditAllocationPaise != null && (
              <div>
                <dt className="text-xs text-[#6B6478]">
                  Amount allocated to credits
                </dt>
                <dd className="text-[#170B2E]">
                  {formatMoneyExact(s.creditAllocationPaise, quote.currency)}
                </dd>
              </div>
            )}
            {isTopUp && s.expiryAt && (
              <div>
                <dt className="text-xs text-[#6B6478]">Credit lot expires</dt>
                <dd className="text-[#170B2E]">{formatDate(s.expiryAt)}</dd>
              </div>
            )}
          </dl>
          <p className="mt-5 text-xs text-[#6B6478]">
            {isTopUp && (s.unallocatedRemainderPaise ?? 0) > 0
              ? `${formatMoneyExact(s.unallocatedRemainderPaise!, quote.currency)} is not allocated to a whole credit and is not carried forward. `
              : ''}
            Credits are rounded down to whole units. The payable total below
            applies the existing discounts and tax calculation; the credit lot
            is added only after payment is confirmed.
          </p>
        </section>

        <section
          className="h-fit rounded-xl bg-[#F7F6FA] p-5 lg:col-span-2"
          data-testid="checkout-totals"
        >
          <h2 className="text-sm font-semibold text-[#170B2E] mb-3">
            Order summary
          </h2>
          <div className="flex flex-col gap-2 text-sm">
            <Row
              label="Subtotal"
              value={formatMoneyExact(quote.subtotalPaise, quote.currency)}
            />
            {quote.discountPaise > 0 && (
              <Row
                label={`Discount${quote.discountPercent != null ? ` (${quote.discountPercent}%)` : ''}${quote.discountReason ? ` — ${quote.discountReason}` : ''}`}
                value={`−${formatMoneyExact(quote.discountPaise, quote.currency)}`}
              />
            )}
            <Row
              label={`GST (${quote.taxPercent}%)`}
              value={formatMoneyExact(quote.taxPaise, quote.currency)}
            />
            <div className="flex items-center justify-between border-t border-[#E4DEEE] pt-2 text-base font-semibold text-[#170B2E]">
              <span>Total</span>
              <span data-testid="checkout-total">
                {formatMoneyExact(quote.totalPaise, quote.currency)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className={buttonCls('primary', 'mt-5 w-full py-2.5')}
            onClick={pay}
            disabled={processing}
          >
            {processing && <Loader2 size={15} className="animate-spin" />}
            {processing
              ? 'Processing payment…'
              : `Pay ${formatMoneyExact(quote.totalPaise, quote.currency)}`}
          </button>
          <p className="mt-3 text-xs text-[#6B6478]">
            One-time payment by card, UPI or netbanking. Nothing else is charged
            later.
          </p>
          {processing && (
            <p
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#6B6478]"
              role="status"
            >
              <Loader2 size={12} className="animate-spin" /> Complete the
              payment in the secure payment window.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[#6B6478]">
      <span>{label}</span>
      <span className="font-medium text-[#170B2E] whitespace-nowrap">
        {value}
      </span>
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
  return (
    <section
      role={tone === 'error' ? 'alert' : 'status'}
      className="mx-auto flex w-full max-w-lg flex-col items-center gap-2 rounded-xl bg-[#F7F6FA] p-8 text-center"
    >
      {icon}
      <h2 className="text-lg font-semibold text-[#170B2E]">{title}</h2>
      <div className="space-y-1 text-sm text-[#6B6478]">{children}</div>
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
