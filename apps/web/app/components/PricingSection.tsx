'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Building2,
  CalendarClock,
  Check,
  Coins,
  CreditCard,
  Minus,
  Mic,
  Monitor,
  PhoneCall,
  Receipt,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Video,
} from 'lucide-react';
import { formatCredits, formatMoney, intervalLabel, type CreditRates, type Plan, type PublicPricing } from '../lib/billing';
import {
  featureNames,
  formatRate,
  gstNote,
  planCtaHref,
  planCtaLabel,
  planComparePrice,
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
  const parts = [
    ['video', rates.videoCreditsPerMinute],
    ['audio', rates.audioCreditsPerMinute],
  ]
    .filter(([, rate]) => (rate as number) > 0)
    .map(([label, rate]) => `${formatCredits(Math.floor(credits / (rate as number)))} ${label}`);
  if (parts.length === 0) return null;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}` : parts[0];
  return `≈ ${list} participant-minutes`;
}

type MediaKey = 'audio' | 'video' | 'screen' | 'ai';
interface MediaRate {
  key: MediaKey;
  icon: typeof Mic;
  label: string;
  rate: number;
  /** AI calls are billed per call minute, not per participant. */
  perParticipant: boolean;
}

function mediaRates(rates: CreditRates): MediaRate[] {
  return [
    { key: 'audio', icon: Mic, label: 'Audio', rate: rates.audioCreditsPerMinute, perParticipant: true },
    { key: 'video', icon: Video, label: 'Video', rate: rates.videoCreditsPerMinute, perParticipant: true },
    { key: 'screen', icon: Monitor, label: 'Screen share', rate: rates.screenShareCreditsPerMinute, perParticipant: true },
    ...(rates.aiCreditsPerMinute != null
      ? [{ key: 'ai' as const, icon: Bot, label: 'AI voice', rate: rates.aiCreditsPerMinute, perParticipant: false }]
      : []),
  ];
}

const creditWord = (n: number) => (n === 1 ? 'credit' : 'credits');

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-sm">
        <span className="text-[#3D3650]">{label}</span>
        <span className="font-semibold text-[#170B2E]">
          {value} {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full cursor-pointer accent-[#7F40E8]"
      />
    </label>
  );
}

/**
 * What a one-to-one call consumes, under the plan cards: pick the call type,
 * optionally add screen sharing (it only happens inside an audio/video call)
 * and set the length. Live admin rates.
 */
export function CreditRateStrip({ rates, plans = [] }: { rates: CreditRates; plans?: Plan[] }) {
  const media = mediaRates(rates);
  const callTypes = media.filter((m) => m.key !== 'screen');
  const screen = media.find((m) => m.key === 'screen')!;
  const [selected, setSelected] = useState<MediaKey>('video');
  const [minutes, setMinutes] = useState(30);
  const [shareOn, setShareOn] = useState(false);
  const [shareMinutes, setShareMinutes] = useState(10);
  const current = callTypes.find((m) => m.key === selected) ?? callTypes[0];
  const canShare = current.key !== 'ai';
  const sharing = canShare && shareOn;
  const shareMins = Math.min(shareMinutes, minutes);

  // One-to-one: both people use audio/video; the sharer adds screen-share minutes.
  const lines: { label: string; credits: number }[] =
    current.key === 'ai'
      ? [{ label: `${minutes} AI call min × ${formatRate(current.rate)}`, credits: minutes * current.rate }]
      : [
          {
            label: `2 people × ${minutes} min ${current.label.toLowerCase()} × ${formatRate(current.rate)}`,
            credits: 2 * minutes * current.rate,
          },
          ...(sharing
            ? [{ label: `1 sharer × ${shareMins} min screen share × ${formatRate(screen.rate)}`, credits: shareMins * screen.rate }]
            : []),
        ];
  const credits = Math.ceil(lines.reduce((sum, l) => sum + l.credits, 0));
  // The smallest paid plan, to show what its credits cover.
  const plan = sortPlans(plans)
    .filter((p) => p.type !== 'FREE' && !p.customPricing && (p.version?.includedCredits ?? 0) > 0)
    .sort((a, b) => a.version!.includedCredits - b.version!.includedCredits)[0];
  const calls = plan && credits > 0 ? Math.floor(plan.version!.includedCredits / credits) : null;

  const tileCls = (on: boolean) =>
    `relative rounded-2xl p-4 text-left transition-all ${
      on
        ? 'bg-[#7F40E8] text-white shadow-[0_12px_30px_-12px_rgba(127,64,232,0.8)]'
        : 'bg-[#F8F4FD] text-[#170B2E] ring-1 ring-[#E7DFF5] hover:ring-[#D6C4EE]'
    }`;

  return (
    <div
      data-testid="credit-rate-strip"
      className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-3xl border border-[#E7DFF5] bg-white shadow-[0_24px_60px_-32px_rgba(65,6,134,0.35)]"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        <div className="p-6 sm:p-8">
          <p className="text-lg font-bold text-[#170B2E]">What do credits buy?</p>
          <p className="mt-1 text-sm text-[#3D3650]">
            Pick a one-to-one call type, add screen sharing if you need it, and set the length.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {callTypes.map((m) => {
              const on = m.key === current.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={on}
                  data-testid={m.key === 'ai' ? 'ai-rate' : undefined}
                  onClick={() => setSelected(m.key)}
                  className={tileCls(on)}
                >
                  <m.icon size={20} className={on ? 'text-white' : 'text-[#7F40E8]'} aria-hidden="true" />
                  <span className="mt-3 block text-sm">
                    <span className={on ? 'text-white/85' : 'text-[#3D3650]'}>{m.label}</span>
                    <span className="mt-0.5 block text-lg font-bold">
                      {formatRate(m.rate)} {creditWord(m.rate)}/min
                    </span>
                  </span>
                  <span className={`mt-1 block text-xs ${on ? 'text-white/75' : 'text-[#3D3650]'}`}>
                    {m.perParticipant ? 'per participant' : 'per call minute · paid plans'}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={sharing}
              disabled={!canShare}
              onClick={() => setShareOn((v) => !v)}
              className={`${tileCls(sharing)} disabled:cursor-not-allowed disabled:opacity-50`}
              title={canShare ? undefined : 'Screen sharing is part of an audio or video call'}
            >
              <span
                className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  sharing ? 'bg-white text-[#5B1BB5]' : 'bg-white text-[#6425C4] ring-1 ring-[#E7DFF5]'
                }`}
              >
                {sharing ? 'Added' : '+ Add to call'}
              </span>
              <screen.icon size={20} className={sharing ? 'text-white' : 'text-[#7F40E8]'} aria-hidden="true" />
              <span className="mt-3 block text-sm">
                <span className={sharing ? 'text-white/85' : 'text-[#3D3650]'}>{screen.label}</span>
                <span className="mt-0.5 block text-lg font-bold">
                  {formatRate(screen.rate)} {creditWord(screen.rate)}/min
                </span>
              </span>
              <span className={`mt-1 block text-xs ${sharing ? 'text-white/75' : 'text-[#3D3650]'}`}>
                add-on · only during a call
              </span>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-6 bg-gradient-to-br from-[#F8F4FD] to-[#EFE5FC] p-6 sm:p-8">
          <div className="space-y-5">
            <RangeField label="Call length" value={minutes} min={5} max={120} step={5} suffix="min" onChange={setMinutes} />
            {sharing && (
              <RangeField
                label="Screen sharing time"
                value={shareMins}
                min={5}
                max={minutes}
                step={5}
                suffix="min"
                onChange={setShareMinutes}
              />
            )}
          </div>
          <div className="mt-auto" aria-live="polite">
            <ul className="space-y-1.5 border-b border-[#D6C4EE]/60 pb-3 text-sm text-[#3D3650]">
              {lines.map((l) => (
                <li key={l.label} className="flex justify-between gap-4">
                  <span>{l.label}</span>
                  <span className="font-semibold text-[#170B2E]">{formatRate(l.credits)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-4xl font-bold tracking-tight text-[#170B2E]">
              {formatCredits(credits)} <span className="text-lg font-semibold text-[#3D3650]">credits per call</span>
            </p>
            {plan && calls != null && (
              <p className="mt-2 text-sm text-[#3D3650]">
                {plan.name}&apos;s {formatCredits(plan.version!.includedCredits)} credits cover{' '}
                <strong className="text-[#6425C4]">≈ {formatCredits(calls)}</strong> calls like this.
              </p>
            )}
          </div>
        </div>
      </div>
      <p className="border-t border-[#E7DFF5] px-6 py-3 text-center text-xs text-[#3D3650]">
        A participant-minute is one connected participant for one minute: 2 people on a 10-minute video call use{' '}
        {formatRate(20 * rates.videoCreditsPerMinute)} credits.
      </p>
    </div>
  );
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
  const comparePrice = planComparePrice(plan);
  const featured = plan.isPopular;
  const badge = plan.badge ?? (featured ? 'Most popular' : null);
  const hint = v ? minutesHint(v.includedCredits, rates) : null;

  return (
    <article
      data-testid={`plan-card-${plan.slug}`}
      className={`plan-card-border group relative flex flex-col rounded-3xl p-8 transition-all duration-300 ${
        featured
          ? 'plan-card-border--featured text-white shadow-[0_24px_60px_-12px_rgba(65,6,134,0.55)] lg:-my-4 lg:py-12'
          : 'bg-white hover:-translate-y-1 hover:shadow-[0_20px_45px_-20px_rgba(65,6,134,0.25)]'
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
      {comparePrice && (
        <p className={`relative mt-1 text-lg font-medium line-through ${featured ? 'text-white/50' : 'text-[#3D3650]/60'}`}>
          <span className="sr-only">Regular price </span>
          {comparePrice}
        </p>
      )}

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
  return (
    <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#7F40E8]/10" aria-label="Included">
      <Check size={14} strokeWidth={3} className="text-[#7F40E8]" aria-hidden="true" />
    </span>
  );
}
function No() {
  return <Minus size={16} className="mx-auto text-[#D6C4EE]" aria-label="Not included" />;
}

export function PlanComparison({ pricing }: { pricing: PublicPricing }) {
  const token = useAuthStore((s) => s.token);
  const plans = sortPlans(pricing.plans);
  if (plans.length === 0) return null;
  const r = pricing.creditRates;
  const custom = (p: Plan) => p.customPricing;
  const minutes = (p: Plan, rate: number) =>
    !p.version || custom(p) || rate <= 0 ? 'Custom' : `≈ ${formatCredits(Math.floor(p.version.includedCredits / rate))} min`;

  const rows: { label: string; hint?: string; render: (p: Plan) => React.ReactNode }[] = [
    {
      label: 'Included credits',
      render: (p) =>
        p.version && (p.version.includedCredits > 0 || !custom(p))
          ? `${formatCredits(p.version.includedCredits)} / ${intervalLabel(p.version)}`
          : 'Custom',
    },
    { label: 'Video calling', hint: 'participant-minutes', render: (p) => minutes(p, r.videoCreditsPerMinute) },
    { label: 'Audio calling', hint: 'participant-minutes', render: (p) => minutes(p, r.audioCreditsPerMinute) },
    // AI voice agents need a paid plan: any plan type except FREE, Custom included.
    ...(r.aiCreditsPerMinute != null
      ? [{ label: 'AI voice agents', render: (p: Plan) => (p.type === 'FREE' ? <No /> : <Yes />) }]
      : []),
    // Only features that differ between plans — shared ones are listed once above.
    ...pricing.features
      .filter((f) => !commonFeatureKeys(plans).includes(f.key))
      .map((f) => ({
        label: f.name,
        render: (p: Plan) => (p.version?.features.includes(f.key) ? <Yes /> : <No />),
      })),
  ];
  const col = (p: Plan) => (p.isPopular ? 'bg-[#7F40E8]/[0.05]' : '');

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#E7DFF5] bg-white">
      <table className="w-full min-w-[680px] text-left text-sm" aria-label="Plan comparison">
        <thead>
          <tr>
            <th scope="col" className="w-1/4 px-5 pb-5 pt-6 align-bottom text-xs font-semibold uppercase tracking-wider text-[#3D3650]">
              Compare plans
            </th>
            {plans.map((p) => {
              const price = planPrice(p);
              return (
                <th key={p.id} scope="col" className={`px-4 pb-5 pt-6 text-center align-bottom ${col(p)}`}>
                  {p.isPopular && (
                    <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[#7F40E8] px-2.5 py-0.5 text-[11px] font-semibold text-white">
                      <Sparkles size={11} aria-hidden="true" /> {p.badge ?? 'Most popular'}
                    </span>
                  )}
                  <span className="block text-base font-bold text-[#170B2E]">{p.name}</span>
                  <span className="mt-1 block text-sm font-normal text-[#3D3650]">
                    {price.suffix ? (
                      <>
                        <strong className="text-lg text-[#170B2E]">{price.amount}</strong> / {intervalLabel(p.version)}
                      </>
                    ) : (
                      price.amount
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="text-[#3D3650]">
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[#F0EAF9] transition-colors hover:bg-[#FBF9FE]">
              <th scope="row" className="px-5 py-3.5 font-medium text-[#170B2E]">
                {row.label}
                {row.hint && <span className="block text-xs font-normal text-[#3D3650]">{row.hint}</span>}
              </th>
              {plans.map((p) => (
                <td key={p.id} className={`px-4 py-3.5 text-center ${col(p)}`}>
                  {row.render(p)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-[#F0EAF9]">
            <td className="px-5 py-5" />
            {plans.map((p) => (
              <td key={p.id} className={`px-4 py-5 text-center ${col(p)}`}>
                <Link
                  href={planCtaHref(p, !!token)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                    p.isPopular ? 'btn-primary text-white' : 'border border-[#E7DFF5] text-[#6425C4] hover:border-[#D6C4EE]'
                  }`}
                >
                  {planCtaLabel(p)} <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── How credits work ─────────────────────────────────────────────────────
interface Scenario {
  label: string;
  media: MediaKey;
  people: number;
  minutes: number;
  /** Minutes one participant shares a screen during the call. */
  share?: number;
}

export function HowCreditsWork({ pricing }: { pricing: PublicPricing }) {
  const r = pricing.creditRates;
  const media = mediaRates(r);
  const scenarios: Scenario[] = [
    { label: '1:1 video call', media: 'video', people: 2, minutes: 10 },
    { label: 'Video consultation', media: 'video', people: 2, minutes: 30 },
    { label: 'Sales call', media: 'audio', people: 2, minutes: 15 },
    { label: 'Video call + screen share', media: 'video', people: 2, minutes: 10, share: 10 },
    ...(r.aiCreditsPerMinute != null ? [{ label: 'AI support call', media: 'ai' as const, people: 1, minutes: 8 }] : []),
  ];
  const [active, setActive] = useState(0);
  const s = scenarios[active];
  const m = media.find((x) => x.key === s.media)!;
  const screenRate = r.screenShareCreditsPerMinute;
  const units = m.perParticipant ? s.people * s.minutes : s.minutes;
  const callCredits = units * m.rate;
  const shareCredits = (s.share ?? 0) * screenRate;
  const total = Math.ceil(callCredits + shareCredits);

  const steps = [
    { icon: CreditCard, title: 'Choose a plan', body: 'Pay upfront for a monthly plan. Credits are added the moment payment is confirmed.' },
    { icon: Coins, title: 'Credits land in your wallet', body: 'One balance for video, audio, screen sharing and AI calls. Top up whenever you need more.' },
    { icon: PhoneCall, title: 'Calls use credits by the minute', body: 'Each connected participant uses credits at the rate for their call type.' },
  ];
  const rules = [
    { icon: CalendarClock, title: 'Plan credits expire with the period', body: 'Credits from your plan are valid until the end of that plan period.' },
    { icon: ShieldCheck, title: 'Calls are never cut off', body: 'When credits run out, new calls wait for a top-up or renewal. Calls in progress continue.' },
    { icon: RefreshCw, title: 'Auto-renew, with notice', body: 'Paid plans renew on your card or UPI Autopay. You are notified first and can turn it off anytime.' },
    { icon: Receipt, title: 'Never billed after the fact', body: 'You only spend credits you already have. No surprise usage invoices.' },
  ];

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="relative rounded-2xl border border-[#E7DFF5] bg-white p-6">
            <span className="flex items-center gap-3">
              <span className="btn-primary flex h-10 w-10 items-center justify-center rounded-xl text-white">
                <step.icon size={20} aria-hidden="true" />
              </span>
              <span className="font-mono text-xs text-[#6425C4]">STEP {i + 1}</span>
            </span>
            <p className="mt-4 font-semibold text-[#170B2E]">{step.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-[#3D3650]">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-[#E7DFF5] bg-white p-6 sm:p-8">
        <div className="flex flex-wrap gap-2">
          {media.map((x) => (
            <span key={x.key} className="inline-flex items-center gap-2 rounded-full bg-[#F8F4FD] px-3 py-1.5 text-sm text-[#170B2E] ring-1 ring-[#E7DFF5]">
              <x.icon size={15} className="text-[#7F40E8]" aria-hidden="true" />
              {x.perParticipant ? `1 ${x.label.toLowerCase()} participant-minute =` : '1 AI call minute ='}{' '}
              <strong>{formatRate(x.rate)}</strong> {creditWord(x.rate)}
            </span>
          ))}
        </div>

        <p className="mt-8 text-sm font-semibold text-[#170B2E]">Worked examples</p>
        <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Worked examples">
          {scenarios.map((sc, i) => (
            <button
              key={sc.label}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                i === active ? 'bg-[#170B2E] text-white' : 'bg-[#F8F4FD] text-[#3D3650] hover:text-[#170B2E]'
              }`}
            >
              {sc.label}
            </button>
          ))}
        </div>
        <div className="mt-5 space-y-3 rounded-xl bg-gradient-to-r from-[#F8F4FD] to-[#EFE5FC] p-5 text-sm text-[#3D3650]" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            {m.perParticipant ? (
              <>
                <Pill>{s.people} {s.people === 1 ? 'participant' : 'participants'}</Pill>×<Pill>{s.minutes} min</Pill>=
                <Pill>
                  {units} {m.label.toLowerCase()} participant-minutes
                </Pill>
              </>
            ) : (
              <Pill>{s.minutes} AI call minutes</Pill>
            )}
            ×<Pill>{formatRate(m.rate)} {creditWord(m.rate)}</Pill>=
            <span className="font-semibold text-[#170B2E]">{formatRate(callCredits)} credits</span>
          </div>
          {s.share != null && (
            <div className="flex flex-wrap items-center gap-3">
              +<Pill>1 sharer</Pill>×<Pill>{s.share} min screen share</Pill>×<Pill>{formatRate(screenRate)} {creditWord(screenRate)}</Pill>=
              <span className="font-semibold text-[#170B2E]">{formatRate(shareCredits)} credits</span>
            </div>
          )}
          <p className="border-t border-[#D6C4EE]/60 pt-3 text-2xl font-bold text-[#170B2E]">{formatRate(total)} credits</p>
        </div>
        {s.share != null && (
          <p className="mt-3 text-xs text-[#3D3650]">
            Screen sharing happens inside an audio or video call and is counted on top of the call&apos;s own minutes.
          </p>
        )}
        {s.media === 'ai' && (
          <p className="mt-3 text-xs text-[#3D3650]">AI calls are billed per call minute, not per participant, and need a paid plan.</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {rules.map((rule) => (
          <div key={rule.title} className="flex gap-4 rounded-2xl border border-[#E7DFF5] bg-white p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#7F40E8]/10 text-[#7F40E8]">
              <rule.icon size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold text-[#170B2E]">{rule.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-[#3D3650]">{rule.body}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-lg bg-white px-3 py-1.5 font-medium text-[#170B2E] ring-1 ring-[#E7DFF5]">{children}</span>;
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
            <CreditRateStrip rates={state.data.creditRates} plans={state.data.plans} />
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
