'use client';

import Link from 'next/link';
import { Check, Minus, Mic, Monitor, RefreshCw, Video } from 'lucide-react';
import { formatCredits, formatMoney, intervalLabel, type Plan, type PublicPricing } from '../lib/billing';
import {
  featureNames,
  formatRate,
  gstNote,
  isContactPlan,
  planCtaHref,
  planCtaLabel,
  planPrice,
  sortPlans,
  topUpExpiryText,
  usePublicPricing,
} from '../lib/public-pricing';
import { useAuthStore } from '../store/auth.store';

const TAGLINES = [
  'Simple prepaid plans',
  'Predictable monthly pricing',
  'Included usage credits',
  'No surprise usage bills',
  'Top up when you need more',
  'Upgrade as you grow',
];

// ── Shared states ────────────────────────────────────────────────────────
export function PricingLoading({ label = 'Loading current plans…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
      <span className="sr-only">{label}</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-72 animate-pulse rounded-xl border border-[#E7DFF5] bg-[#F8F4FD]" aria-hidden="true" />
      ))}
    </div>
  );
}

export function PricingError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-[#E7DFF5] bg-[#F8F4FD] p-6 text-sm text-[#3D3650]">
      <p className="font-semibold text-[#170B2E]">Current plans are temporarily unavailable.</p>
      <p className="mt-1">We could not load pricing right now. Please try again in a moment.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#D6C4EE] px-4 py-2 font-medium text-[#6425C4] hover:border-[#7F40E8]"
      >
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  );
}

// ── Plan cards ───────────────────────────────────────────────────────────
function PlanCard({ plan, names, loggedIn }: { plan: Plan; names: Map<string, string>; loggedIn: boolean }) {
  const v = plan.version;
  const price = planPrice(plan);
  const highlight = plan.isPopular;
  const badge = plan.badge ?? (plan.isPopular ? 'Most popular' : null);
  return (
    <article
      data-testid={`plan-card-${plan.slug}`}
      className={`relative flex flex-col rounded-xl border p-6 ${highlight ? 'border-[#7F40E8] shadow-[0_8px_30px_rgba(127,64,232,0.15)]' : 'border-[#E7DFF5]'}`}
      style={{ background: highlight ? 'linear-gradient(135deg, rgba(127,64,232,0.08), rgba(65,6,134,0.04))' : '#FFFFFF' }}
    >
      {badge && (
        <span className="badge-gradient absolute -top-3 left-6 whitespace-nowrap rounded-full px-3 py-0.5 font-mono text-xs text-white">
          {badge}
        </span>
      )}
      <h3 className="text-lg font-bold text-[#170B2E]">{plan.name}</h3>
      {plan.description && <p className="mt-1 text-sm leading-relaxed text-[#3D3650]">{plan.description}</p>}

      <div className="mt-5">
        <span className="price-text text-3xl font-bold text-[#170B2E]">{price.amount}</span>
        {price.suffix && <span className="ml-1 text-sm text-[#3D3650]">{price.suffix}</span>}
        {plan.customPricing && <p className="mt-1 text-xs text-[#3D3650]">Tailored pricing and credits.</p>}
      </div>

      {v && !plan.customPricing && (
        <p className="mt-3 rounded-lg border border-[#E7DFF5] bg-[#F8F4FD] px-3 py-2 text-sm text-[#170B2E]">
          <strong>{formatCredits(v.includedCredits)}</strong> credits included per {intervalLabel(v)}
        </p>
      )}

      {v && v.features.length > 0 && (
        <ul className="mt-4 flex-1 space-y-2">
          {v.features.map((key) => (
            <li key={key} className="flex items-start gap-2 text-sm text-[#3D3650]">
              <Check size={15} className="mt-0.5 shrink-0 text-[#7F40E8]" aria-hidden="true" />
              {names.get(key) ?? key}
            </li>
          ))}
        </ul>
      )}
      <div className="flex-1" />

      <Link
        href={planCtaHref(plan, loggedIn)}
        className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-all ${highlight ? 'btn-primary text-white hover:opacity-90' : 'border border-[#D6C4EE] text-[#170B2E] hover:border-[#7F40E8]'}`}
      >
        {planCtaLabel(plan)}
      </Link>
    </article>
  );
}

export function PlanCards({ pricing }: { pricing: PublicPricing }) {
  const token = useAuthStore((s) => s.token);
  const names = featureNames(pricing.features);
  const plans = sortPlans(pricing.plans);
  if (plans.length === 0) {
    return <p className="text-sm text-[#3D3650]">No plans are published right now. Please check back soon.</p>;
  }
  const cols = plans.length >= 5 ? 'lg:grid-cols-3 xl:grid-cols-5' : plans.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3';
  return (
    <div className={`grid grid-cols-1 gap-5 md:grid-cols-2 ${cols}`}>
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} names={names} loggedIn={Boolean(token)} />
      ))}
    </div>
  );
}

// ── Comparison table ─────────────────────────────────────────────────────
function Yes() {
  return <Check size={16} className="mx-auto text-[#7F40E8]" aria-label="Included" />;
}
function No() {
  return <Minus size={16} className="mx-auto text-[#B9AECB]" aria-label="Not included" />;
}

export function PlanComparison({ pricing }: { pricing: PublicPricing }) {
  const plans = sortPlans(pricing.plans);
  if (plans.length === 0) return null;
  const custom = (p: Plan) => p.customPricing;

  const rows: { label: string; render: (p: Plan) => React.ReactNode }[] = [
    {
      label: 'Price',
      render: (p) => {
        const price = planPrice(p);
        return price.suffix ? `${price.amount} / ${intervalLabel(p.version)}` : price.amount;
      },
    },
    {
      label: 'Included credits',
      render: (p) =>
        p.version && (p.version.includedCredits > 0 || !custom(p))
          ? `${formatCredits(p.version.includedCredits)} / ${intervalLabel(p.version)}`
          : 'Custom',
    },
    ...pricing.features.map((f) => ({
      label: f.name,
      render: (p: Plan) => (p.version?.features.includes(f.key) ? <Yes /> : <No />),
    })),
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-[#E7DFF5]">
      <table className="w-full min-w-[640px] text-left text-sm" aria-label="Plan comparison">
        <thead className="bg-[#F8F4FD] text-xs uppercase tracking-wider text-[#3D3650]">
          <tr>
            <th scope="col" className="px-4 py-3">
              Compare plans
            </th>
            {plans.map((p) => (
              <th key={p.id} scope="col" className="px-4 py-3 text-center text-[#170B2E]">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-[#3D3650]">
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[#E7DFF5]">
              <th scope="row" className="px-4 py-3 font-medium text-[#170B2E]">
                {row.label}
              </th>
              {plans.map((p) => (
                <td key={p.id} className="px-4 py-3 text-center">
                  {row.render(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── How credits work ─────────────────────────────────────────────────────
export function HowCreditsWork({ pricing }: { pricing: PublicPricing }) {
  const r = pricing.creditRates;
  const exampleMinutes = 2 * 10;
  const exampleCredits = exampleMinutes * r.videoCreditsPerMinute;
  const rates = [
    { icon: Mic, label: 'Audio', rate: r.audioCreditsPerMinute },
    { icon: Video, label: 'Video', rate: r.videoCreditsPerMinute },
    { icon: Monitor, label: 'Screen share', rate: r.screenShareCreditsPerMinute },
  ];
  return (
    <div className="rounded-xl border border-[#E7DFF5] bg-white p-6">
      <p className="text-sm leading-6 text-[#3D3650]">
        Every plan includes usage credits. Calls are measured in <strong>participant-minutes</strong> — one connected
        participant for one minute — and each media type consumes credits at its own rate. When your included credits
        run low you can top up or upgrade; you are never billed after the fact.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rates.map((x) => (
          <div key={x.label} className="rounded-lg border border-[#E7DFF5] bg-[#F8F4FD] p-4 text-center">
            <x.icon size={20} className="mx-auto text-[#7F40E8]" aria-hidden="true" />
            <p className="mt-2 text-sm text-[#170B2E]">
              1 {x.label.toLowerCase()} participant-minute = <strong>{formatRate(x.rate)}</strong>{' '}
              {x.rate === 1 ? 'credit' : 'credits'}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-sm text-[#3D3650]">
        <strong className="text-[#170B2E]">Example:</strong> 2 participants × 10 min video call = {exampleMinutes} video
        participant-minutes = <strong>{formatRate(exampleCredits)} credits</strong>.
      </p>
      <p className="mt-2 text-sm text-[#3D3650]">
        Screen sharing is its own category: 1 participant sharing for 10 minutes uses 10 screen-share participant-minutes
        ({formatRate(10 * r.screenShareCreditsPerMinute)} credits), separately from audio or video.
      </p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[#3D3650]">
        <li>Plan credits are added when your payment is confirmed and expire at the end of the plan period.</li>
        <li>When credits run out, new calls cannot start until you top up, renew or upgrade. Calls already in progress are never cut off.</li>
        <li>Paid plans do not renew automatically — you choose when to renew and pay.</li>
      </ul>
    </div>
  );
}

// ── Top-ups ──────────────────────────────────────────────────────────────
export function TopUps({ pricing }: { pricing: PublicPricing }) {
  const items = [...pricing.topUps].sort((a, b) => a.displayOrder - b.displayOrder);
  return (
    <div>
      {items.length === 0 ? (
        <p className="text-sm text-[#3D3650]">Top-up packages will be listed here when available.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((t) => (
            <div
              key={t.id}
              data-testid={`topup-${t.id}`}
              className={`rounded-xl border p-5 ${t.isPopular ? 'border-[#7F40E8]' : 'border-[#E7DFF5]'} bg-white`}
            >
              <p className="font-semibold text-[#170B2E]">{t.name}</p>
              {t.description && <p className="mt-1 text-xs text-[#3D3650]">{t.description}</p>}
              <p className="mt-3 text-2xl font-bold text-[#170B2E]">{formatMoney(t.pricePaise, t.currency)}</p>
              <p className="text-sm text-[#3D3650]">{formatCredits(t.credits)} credits</p>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-[#3D3650]">
        Top-ups are one-time credit packages you buy from your dashboard — no subscription change needed. {topUpExpiryText(pricing.creditRates)}{' '}
        {gstNote(pricing.creditRates)}
      </p>
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────
function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-5 mt-16 text-xl font-bold text-[#170B2E]">{children}</h3>;
}

/**
 * Public pricing, fed entirely by GET /billing/plans.
 * `summary` (homepage) renders the plan cards only; `full` (pricing page)
 * adds the comparison table, credit explainer and top-ups.
 */
export default function PricingSection({ variant = 'summary', bare = false }: { variant?: 'summary' | 'full'; /** Inside a page that already has its own heading and gutters. */ bare?: boolean }) {
  const state = usePublicPricing();
  const full = variant === 'full';
  const contact = state.data ? sortPlans(state.data.plans).find(isContactPlan) : undefined;

  return (
    <section id="pricing" className={bare ? 'scroll-mt-24' : 'section-base px-6 py-24'}>
      <div className={bare ? '' : 'mx-auto max-w-6xl'}>
        {!bare && (
          <>
            <p className="section-label mb-4 font-mono text-xs uppercase tracking-widest">Pricing</p>
            <h2 className="lp-h2 mb-4 font-bold text-[#170B2E]">Simple prepaid plans. No surprise usage bills.</h2>
            <p className="mb-6 max-w-2xl text-[#3D3650]">
              Choose a plan, pay upfront and get usage credits for audio, video and screen sharing. Top up when you
              need more, and upgrade as you grow.
            </p>
          </>
        )}
        <ul className="mb-12 flex flex-wrap gap-2">
          {TAGLINES.map((t) => (
            <li key={t} className="rounded-full border border-[#E7DFF5] bg-[#F8F4FD] px-3 py-1 text-xs text-[#6425C4]">
              {t}
            </li>
          ))}
        </ul>

        {state.status === 'loading' && <PricingLoading />}
        {state.status === 'error' && <PricingError onRetry={state.retry} />}
        {state.status === 'ready' && (
          <>
            <PlanCards pricing={state.data} />
            <p className="mt-4 text-xs text-[#3D3650]">{gstNote(state.data.creditRates)}</p>

            {full ? (
              <>
                <SubHeading>Compare plans</SubHeading>
                <PlanComparison pricing={state.data} />

                <SubHeading>How credits work</SubHeading>
                <HowCreditsWork pricing={state.data} />

                <SubHeading>Top up when you need more</SubHeading>
                <TopUps pricing={state.data} />

                {contact && (
                  <div className="mt-16 rounded-xl border border-[#D6C4EE] p-8" style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.06), rgba(65,6,134,0.03))' }}>
                    <p className="text-lg font-bold text-[#170B2E]">Need more than a standard plan?</p>
                    <p className="mt-2 max-w-2xl text-sm text-[#3D3650]">
                      Custom plans are agreed with our team — tailored pricing and credits for high
                      volumes. Start a conversation and we will send you a private offer you can accept and pay from
                      your dashboard.
                    </p>
                    <ContactCta plan={contact} />
                  </div>
                )}
              </>
            ) : (
              <div className="mt-10 text-center">
                <Link href="/pricing" className="text-sm font-medium text-[#6425C4] hover:text-[#170B2E]">
                  Compare plans, credit rates and top-ups →
                </Link>
              </div>
            )}
          </>
        )}

        {full && (
          <div className="mt-12 rounded-xl border border-[#E7DFF5] p-8 text-center">
            <p className="mb-2 text-lg font-bold text-[#170B2E]">Questions about plans or credits?</p>
            <p className="mx-auto mb-6 max-w-xl text-sm text-[#3D3650]">
              Read how plans, credits, renewals, top-ups and upgrades work, or review the billing terms.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/faq#pricing"
                className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium text-white hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
              >
                View pricing FAQ →
              </Link>
              <Link
                href="/billing-terms"
                className="inline-flex items-center gap-2 rounded-lg border border-[#E7DFF5] px-6 py-2.5 text-sm font-medium text-[#3D3650] hover:border-[#D6C4EE]"
              >
                Billing &amp; usage terms
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ContactCta({ plan }: { plan: Plan }) {
  const token = useAuthStore((s) => s.token);
  return (
    <Link
      href={planCtaHref({ ...plan, ctaAction: 'CONTACT_SALES' }, Boolean(token))}
      className="mt-5 inline-block rounded-lg border border-[#D6C4EE] px-5 py-2.5 text-sm font-medium text-[#170B2E] hover:border-[#7F40E8]"
    >
      {planCtaLabel({ ...plan, ctaAction: 'CONTACT_SALES', ctaLabel: plan.ctaLabel })}
    </Link>
  );
}
