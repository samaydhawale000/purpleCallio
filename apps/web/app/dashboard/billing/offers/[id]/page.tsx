'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useRequireAuth } from '../../../../hooks/useRequireAuth';
import { Pill, buttonCls, type Tone } from '../../../_ui';
import {
  billingErrorMessage,
  formatCredits,
  formatDate,
  formatMoney,
  getCustomPlanState,
  getOffer,
  getPublicPricing,
  intervalLabel,
  type CustomPlanOffer,
  type Feature,
} from '../../../../lib/billing';
import { BillingHeader, ErrorBanner, PageLoader, SectionCard, useAuthErrorHandler } from '../../BillingShell';

const STATUS: Record<CustomPlanOffer['status'], { label: string; tone: Tone }> = {
  SENT: { label: 'Ready to accept', tone: 'accent' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
};

const humanize = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function OfferPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();

  const [offer, setOffer] = useState<CustomPlanOffer | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, pricing] = await Promise.all([getOffer(id), getPublicPricing().catch(() => null)]);
      setOffer(o);
      setFeatures(pricing?.features ?? []);
      setError(null);
      if (o.requestId) {
        const state = await getCustomPlanState().catch(() => null);
        if (state?.request && state.request.id === o.requestId) setTicketId(state.request.ticketId);
      }
    } catch (e) {
      if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Could not load this offer.'));
    } finally {
      setLoading(false);
    }
  }, [id, handleAuthError]);

  useEffect(() => {
    if (isReady && isAuthed) load();
  }, [isReady, isAuthed, load]);

  const featureName = useMemo(() => {
    const map = new Map(features.map((f) => [f.key, f.name]));
    return (k: string) => map.get(k) ?? humanize(k);
  }, [features]);

  const header = (
    <div className="flex flex-col gap-4">
      <BillingHeader title="Custom plan offer" subtitle="A plan prepared for you by our team." />
      <Link href="/dashboard/billing" className="inline-flex w-fit items-center gap-1 text-[13px] text-[#6B6478] hover:text-[#170B2E]">
        <ArrowLeft size={14} /> Back to billing
      </Link>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <PageLoader label="Loading offer…" />
      </div>
    );
  }
  if (error || !offer) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorBanner message={error ?? 'Offer not found.'} />
      </div>
    );
  }

  const v = offer.plan.version;
  const expired = offer.status === 'EXPIRED' || (!!offer.expiresAt && new Date(offer.expiresAt) < new Date());
  const canAccept = offer.status === 'SENT' && !expired;
  const status = expired && offer.status === 'SENT' ? STATUS.EXPIRED : STATUS[offer.status];

  return (
    <div className="flex flex-col gap-6">
      {header}
      <SectionCard className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2" data-testid="offer-detail">
          <h2 className="text-xl font-semibold text-[#170B2E]">{offer.plan.name}</h2>
          <Pill tone="accent">Custom plan</Pill>
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
        {offer.plan.description && <p className="text-sm text-[#6B6478] mt-1">{offer.plan.description}</p>}

        {v && (
          <>
            <p className="mt-4 text-2xl font-semibold text-[#170B2E]">
              {formatMoney(v.pricePaise, v.currency)} <span className="text-sm font-normal text-[#6B6478]">/ {intervalLabel(v)} + GST</span>
            </p>
            <p className="text-sm text-[#6B6478]">{formatCredits(v.includedCredits)} credits included</p>
            <ul className="mt-4 grid list-disc grid-cols-1 gap-1.5 pl-5 text-sm text-[#6B6478] marker:text-[#C4BCD2] sm:grid-cols-2">
              {v.features.map((f) => (
                <li key={f}>{featureName(f)}</li>
              ))}
            </ul>
          </>
        )}

        {offer.message && (
          <div className="mt-5 whitespace-pre-wrap rounded-lg border border-[#ECE8F2] bg-white p-4 text-sm text-[#6B6478]">
            <p className="text-xs font-semibold text-[#170B2E] mb-1">Message from our team</p>
            {offer.message}
          </div>
        )}

        <p className="mt-4 text-xs text-[#6B6478]">
          {offer.status === 'ACCEPTED'
            ? `Accepted on ${formatDate(offer.acceptedAt)}.`
            : offer.expiresAt
              ? `${expired ? 'Expired' : 'Valid until'} ${formatDate(offer.expiresAt)}.`
              : 'Sent ' + formatDate(offer.createdAt) + '.'}{' '}
          You can choose auto-renew at checkout, or pay for this period only.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonCls('primary')}
            disabled={!canAccept}
            onClick={() => router.push(`/dashboard/billing/checkout?offer=${encodeURIComponent(offer.id)}`)}
          >
            Accept &amp; pay
          </button>
          {ticketId && (
            <Link href={`/dashboard/support/${ticketId}`} className={buttonCls('secondary')}>
              Open conversation
            </Link>
          )}
        </div>
        {!canAccept && offer.status !== 'ACCEPTED' && (
          <p className="mt-2 text-xs text-[#6B6478]">This offer can no longer be accepted. Ask our team for a new one in your conversation.</p>
        )}
      </SectionCard>
    </div>
  );
}
