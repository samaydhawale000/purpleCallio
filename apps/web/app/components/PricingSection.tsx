'use client';

import Link from 'next/link';
import { ArrowRight, Building2, Check, Coins, Minus, Mic, Monitor, RefreshCw, Rocket, Sparkles, Video } from 'lucide-react';
import { formatCredits, formatMoney, intervalLabel, type CreditRates, type Plan, type PublicPricing } from '../lib/billing';
import {
  featureNames,
  formatRate,
  gstNote,
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
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-96 animate-pulse rounded-3xl border border-[#E7DFF5] bg-[#F8F4FD]" aria-hidden="true" />
        ))}
      </div>
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-3xl border border-[#E7DFF5] bg-[#F8F4FD]" aria-hidden="true" />
        ))}
      </div>
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
/** Features every published plan includes — listed once, not on every card. */
function commonFeatureKeys(plans: Plan[]): string[] {
  const withVersion = plans.filter((p) => p.version);
  if (withVersion.length === 0) return [];
  return withVersion[0].version!.features.filter((k) => withVersion.every((p) => p.version!.features.includes(k)));
}

/** "≈ 25,000 video or 1,00,000 audio participant-minutes" from the live rates. */
function minutesHint(credits: number, rates: CreditRates) {
  const audio = rates.audioCreditsPerMinute > 0 ? Math.floor(credits / rates.audioCreditsPerMinute) : null;
  const video = rates.videoCreditsPerMinute > 0 ? Math.floor(credits / rates.videoCreditsPerMinute) : null;
  if (audio == null && video == null) return null;
  if (audio != null && video != null) {
    return `≈ ${formatCredits(video)} video or ${formatCredits(audio)} audio participant-minutes`;
  }
  return `≈ ${formatCredits((video ?? audio)!)} ${video != null ? 'video' : 'audio'} participant-minutes`;
}

function FeatureList({ keys, names, dark }: { keys: string[]; names: Map<string, string>; dark?: boolean }) {
  if (keys.length === 0) return null;
  return (
    <ul className="space-y-2.5">
      {keys.map((key) => (
        <li key={key} className={`flex items-start gap-2.5 text-sm ${dark ? 'text-white/85' : 'text-[#3D3650]'}`}>
          <span
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${dark ? 'bg-white/15' : 'bg-[#7F40E8]/10'}`}
          >
            <Check size={11} strokeWidth={3} className={dark ? 'text-white' : 'text-[#7F40E8]'} aria-hidden="true" />
          </span>
          {names.get(key) ?? key}
        </li>
      ))}
    </ul>
  );
}

/** Starter / Growth / Business — the main row. The popular plan is the dark feature card. */
function PaidPlanCard({
  plan,
  names,
  extraFeatures,
  rates,
  loggedIn,
}: {
  plan: Plan;
  names: Map<string, string>;
  extraFeatures: string[];
  rates: CreditRates;
  loggedIn: boolean;
}) {
  const v = plan.version;
  const price = planPrice(plan);
  const featured = plan.isPopular;
  const badge = plan.badge ?? (featured ? 'Most popular' : null);
  const hint = v ? minutesHint(v.includedCredits, rates) : null;

  return (
    <article
      data-testid={`plan-card-${plan.slug}`}
      className={`group relative flex flex-col rounded-3xl p-8 transition-all duration-300 ${
        featured
          ? 'text-white shadow-[0_24px_60px_-12px_rgba(65,6,134,0.55)] lg:-my-4 lg:py-12'
          : 'border border-[#E7DFF5] bg-white hover:-translate-y-1 hover:border-[#D6C4EE] hover:shadow-[0_20px_45px_-20px_rgba(65,6,134,0.25)]'
      }`}
      style={featured ? { background: 'radial-gradient(120% 80% at 0% 0%, #8B4DF0 0%, #5B1BB5 45%, #2B0F52 100%)' } : undefined}
    >
      {featured && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-3xl opacity-[0.07]"
          style={{
            backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
      )}

      <div className="relative flex items-center justify-between gap-3">
        <h3 className={`text-xl font-bold ${featured ? 'text-white' : 'text-[#170B2E]'}`}>{plan.name}</h3>
        {badge && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
              featured ? 'bg-white text-[#5B1BB5]' : 'bg-[#7F40E8]/10 text-[#6425C4]'
            }`}
          >
            <Sparkles size={12} aria-hidden="true" /> {badge}
          </span>
        )}
      </div>
      {plan.description && (
        <p className={`relative mt-2 min-h-[2.75rem] text-sm leading-relaxed ${featured ? 'text-white/75' : 'text-[#3D3650]'}`}>
          {plan.description}
        </p>
      )}

      <div className="relative mt-6 flex items-baseline gap-1.5">
        <span className={`text-5xl font-bold tracking-tight ${featured ? 'text-white' : 'text-[#170B2E]'}`}>{price.amount}</span>
        {price.suffix && <span className={`text-sm ${featured ? 'text-white/70' : 'text-[#3D3650]'}`}>{price.suffix}</span>}
      </div>

      {v && (
        <div
          className={`relative mt-6 rounded-2xl p-4 ${featured ? 'bg-white/10 ring-1 ring-white/20' : 'bg-[#F8F4FD] ring-1 ring-[#E7DFF5]'}`}
        >
          <div className="flex items-center gap-2">
            <Coins size={16} className={featured ? 'text-white' : 'text-[#7F40E8]'} aria-hidden="true" />
            <p className={`text-sm ${featured ? 'text-white' : 'text-[#170B2E]'}`}>
              <strong className="text-base">{formatCredits(v.includedCredits)}</strong> credits / {intervalLabel(v)}
            </p>
          </div>
          {hint && <p className={`mt-1.5 text-xs ${featured ? 'text-white/65' : 'text-[#3D3650]'}`}>{hint}</p>}
        </div>
      )}

      <Link
        href={planCtaHref(plan, loggedIn)}
        className={`relative mt-6 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
          featured
            ? 'bg-white text-[#410686] hover:bg-[#F3ECFE]'
            : 'border border-[#D6C4EE] text-[#170B2E] hover:border-[#7F40E8] hover:bg-[#F8F4FD]'
        }`}
      >
        {planCtaLabel(plan)} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>

      {extraFeatures.length > 0 && (
        <div className="relative mt-7">
          <p className={`mb-3 text-xs font-semibold uppercase tracking-wider ${featured ? 'text-white/60' : 'text-[#6425C4]'}`}>
            Also included
          </p>
          <FeatureList keys={extraFeatures} names={names} dark={featured} />
        </div>
      )}
    </article>
  );
}

/** Free and Custom — wide horizontal cards below the main row. */
function WidePlanCard({
  plan,
  names,
  extraFeatures,
  rates,
  loggedIn,
}: {
  plan: Plan;
  names: Map<string, string>;
  extraFeatures: string[];
  rates: CreditRates;
  loggedIn: boolean;
}) {
  const v = plan.version;
  const price = planPrice(plan);
  const custom = plan.customPricing;
  const Icon = custom ? Building2 : Rocket;
  const hint = v && !custom ? minutesHint(v.includedCredits, rates) : null;

  return (
    <article
      data-testid={`plan-card-${plan.slug}`}
      className={`group relative flex flex-col gap-6 overflow-hidden rounded-3xl border p-8 sm:flex-row sm:items-center ${
        custom ? 'border-[#D6C4EE]' : 'border-[#E7DFF5] bg-white'
      }`}
      style={custom ? { background: 'linear-gradient(135deg, #F8F4FD 0%, #EFE5FC 100%)' } : undefined}
    >
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${custom ? 'text-white' : 'bg-[#7F40E8]/10 text-[#7F40E8]'}`}
        style={custom ? { background: 'linear-gradient(135deg, #7F40E8, #410686)' } : undefined}
      >
        <Icon size={26} aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-xl font-bold text-[#170B2E]">{plan.name}</h3>
          {custom ? (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#6425C4] ring-1 ring-[#D6C4EE]">
              {price.amount}
            </span>
          ) : (
            <span className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-[#170B2E]">{price.amount}</span>
              {price.suffix && <span className="text-sm text-[#3D3650]">{price.suffix}</span>}
            </span>
          )}
        </div>
        {plan.description && <p className="mt-1.5 text-sm leading-relaxed text-[#3D3650]">{plan.description}</p>}
        {v && !custom && (
          <div className="mt-3">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-[#F8F4FD] px-3 py-1 text-xs text-[#170B2E] ring-1 ring-[#E7DFF5]">
              <Coins size={13} className="text-[#7F40E8]" aria-hidden="true" />
              <strong>{formatCredits(v.includedCredits)}</strong> credits / {intervalLabel(v)}
            </p>
            {hint && <p className="mt-1.5 text-xs text-[#3D3650]">{hint}</p>}
          </div>
        )}
        {extraFeatures.length > 0 && (
          <div className="mt-4">
            <FeatureList keys={extraFeatures} names={names} />
          </div>
        )}
      </div>

      <Link
        href={planCtaHref(plan, loggedIn)}
        className={`flex shrink-0 items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all ${
          custom ? 'text-white hover:opacity-90' : 'border border-[#D6C4EE] text-[#170B2E] hover:border-[#7F40E8] hover:bg-[#F8F4FD]'
        }`}
        style={custom ? { background: 'linear-gradient(135deg, #7F40E8, #410686)' } : undefined}
      >
        {planCtaLabel(plan)} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </article>
  );
}

function IncludedEverywhere({ keys, names }: { keys: string[]; names: Map<string, string> }) {
  if (keys.length === 0) return null;
  return (
    <div className="mt-6 rounded-3xl border border-[#E7DFF5] bg-white p-8" data-testid="included-in-every-plan">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6425C4]">Every plan includes</p>
          <p className="mt-1 text-lg font-bold text-[#170B2E]">The full platform, on every plan</p>
        </div>
        <p className="text-sm text-[#3D3650]">Plans differ only in price and included credits.</p>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {keys.map((key) => (
          <div key={key} className="flex items-center gap-2.5 rounded-xl bg-[#F8F4FD] px-4 py-3 text-sm text-[#170B2E]">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#7F40E8]">
              <Check size={12} strokeWidth={3} className="text-white" aria-hidden="true" />
            </span>
            {names.get(key) ?? key}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlanCards({ pricing }: { pricing: PublicPricing }) {
  const token = useAuthStore((s) => s.token);
  const names = featureNames(pricing.features);
  const plans = sortPlans(pricing.plans);
  if (plans.length === 0) {
    return <p className="text-sm text-[#3D3650]">No plans are published right now. Please check back soon.</p>;
  }
  const common = commonFeatureKeys(plans);
  const extra = (p: Plan) => (p.version?.features ?? []).filter((k) => !common.includes(k));
  const loggedIn = Boolean(token);

  // Main row: priced plans. Free and "talk to us" plans sit below as wide cards.
  const main = plans.filter((p) => p.type !== 'FREE' && !p.customPricing);
  const secondary = plans.filter((p) => p.type === 'FREE' || p.customPricing);
  const mainCols =
    main.length >= 4 ? 'md:grid-cols-2 xl:grid-cols-4' : main.length === 3 ? 'md:grid-cols-3' : main.length === 2 ? 'md:grid-cols-2 max-w-4xl mx-auto' : 'max-w-md mx-auto';

  return (
    <div>
      {main.length > 0 && (
        <div className={`grid grid-cols-1 items-center gap-6 lg:gap-5 ${mainCols}`}>
          {main.map((plan) => (
            <PaidPlanCard key={plan.id} plan={plan} names={names} extraFeatures={extra(plan)} rates={pricing.creditRates} loggedIn={loggedIn} />
          ))}
        </div>
      )}
      {secondary.length > 0 && (
        <div className={`mt-10 grid grid-cols-1 gap-6 ${secondary.length > 1 ? 'lg:grid-cols-2' : ''}`}>
          {secondary.map((plan) => (
            <WidePlanCard key={plan.id} plan={plan} names={names} extraFeatures={extra(plan)} rates={pricing.creditRates} loggedIn={loggedIn} />
          ))}
        </div>
      )}
      <IncludedEverywhere keys={common} names={names} />
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
    // Only features that differ between plans — shared ones are listed once above.
    ...pricing.features.filter((f) => !commonFeatureKeys(plans).includes(f.key)).map((f) => ({
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
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${items.length >= 4 ? 'lg:grid-cols-4' : items.length === 3 ? 'lg:grid-cols-3' : ''}`}>
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
            <p className="mt-5 text-center text-xs text-[#3D3650]">{gstNote(state.data.creditRates)}</p>

            {full ? (
              <>
                <SubHeading>Compare plans</SubHeading>
                <PlanComparison pricing={state.data} />

                <SubHeading>How credits work</SubHeading>
                <HowCreditsWork pricing={state.data} />

                <SubHeading>Top up when you need more</SubHeading>
                <TopUps pricing={state.data} />

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
