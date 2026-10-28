'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CalendarClock,
  Coins,
  CreditCard,
  Mic,
  Monitor,
  PhoneCall,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Unlock,
  Video,
  Wallet,
} from 'lucide-react';
import { formatCredits, formatMoney, type CreditRates, type PublishedCreditPricing } from '../lib/billing';
import {
  creditsForAmount,
  formatRate,
  PRICE_NOT_PUBLISHED,
  purchaseExpiryText,
  usePublicPricing,
  usePublishedCreditPricing,
  validityPhrase,
} from '../lib/public-pricing';
import { useAuthStore } from '../store/auth.store';
import type { PublicPricing } from '../lib/public-pricing';
import { CostGuardEstimator, TranslationRateList } from './marketing/live-translate/TranslationPricing';

// ── Shared states ────────────────────────────────────────────────────────
export function PricingLoading({ label = 'Loading current credit pricing…' }: { label?: string }) {
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
      <p className="font-semibold text-[#170B2E]">Current credit pricing is temporarily unavailable.</p>
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

// ── Credit helpers ───────────────────────────────────────────────────────
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

/** The auth token after mount only: server HTML is the signed-out version, so hydration matches. */
function useClientToken() {
  const token = useAuthStore((s) => s.token);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? token : null;
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
 * What a one-to-one call consumes: pick the call type, optionally add screen
 * sharing (it only happens inside an audio/video call) and set the length.
 * Live admin consumption rates; when a credit price is published, the money
 * value of those credits is shown too (before GST).
 */
export function CreditRateStrip({ rates, pricing = null }: { rates: CreditRates; pricing?: PublishedCreditPricing | null }) {
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
  // Money value of this call's credits at the published price (before GST).
  const valuePaise = pricing && credits > 0 ? credits * pricing.creditPricePaise : null;

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
                    {m.perParticipant ? 'per participant' : 'per call minute · after first purchase'}
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
            {current.key === 'ai' && (
              <p className="mt-2 text-sm text-[#3D3650]">AI voice agents unlock after your first credit purchase.</p>
            )}
            {valuePaise != null && (
              <p className="mt-2 text-sm text-[#3D3650]" data-testid="call-value">
                ≈ <strong className="text-[#6425C4]">{formatMoney(valuePaise, pricing!.currency)}</strong> of credits at the
                published price of {formatMoney(pricing!.creditPricePaise, pricing!.currency)} per credit, before GST.
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

// ── How credits work ─────────────────────────────────────────────────────
interface Scenario {
  label: string;
  media: MediaKey;
  people: number;
  minutes: number;
  /** Minutes one participant shares a screen during the call. */
  share?: number;
}

export function HowCreditsWork({ pricing, credit = null }: { pricing: PublicPricing; credit?: PublishedCreditPricing | null }) {
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
    {
      icon: CreditCard,
      title: 'Buy credits',
      body: 'Enter the amount you want to spend. GST is added at checkout, and credits are added once the payment is verified.',
    },
    {
      icon: Coins,
      title: 'Credits land in your wallet',
      body: 'One balance for video, audio, screen sharing, AI voice and Live Translate. Buy more whenever you need them.',
    },
    { icon: PhoneCall, title: 'Calls use credits by the minute', body: 'Each connected participant uses credits at the rate for their call type.' },
  ];
  const rules = [
    {
      icon: CalendarClock,
      title: 'Each purchase has its own expiry',
      body: `Credits expire ${validityPhrase(credit?.purchasedValidityDays)}. The credits that expire soonest are used first. Promotional credits carry their own expiry date.`,
    },
    { icon: ShieldCheck, title: 'Calls are never cut off', body: 'When credits run out, new calls wait for a top-up. Calls in progress continue.' },
    {
      icon: Unlock,
      title: 'Paid features unlock with your first purchase',
      body: 'Webhooks, custom branding, AI voice agents, Live Translate and other paid features unlock after your first verified credit purchase.',
    },
    { icon: Receipt, title: 'Never billed after the fact', body: 'You only spend credits you already have. There is no subscription and no usage invoice.' },
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
          <p className="mt-3 text-xs text-[#3D3650]">AI calls are billed per call minute, not per participant, and unlock after your first credit purchase.</p>
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

// ── Buy credits ──────────────────────────────────────────────────────────
const toPaise = (rupees: number) => Math.round(rupees * 100);

/**
 * Prepaid explainer + "how many credits does ₹X buy?" calculator, fed by the
 * admin-published price (GET /billing/credit-pricing/current) and the live
 * GST rate. Shows a "published soon" note — never a made-up rate — when no
 * price is published. The checkout quote stays authoritative.
 */
export function BuyCreditsCalculator({ rates, credit }: { rates: CreditRates; credit: PublishedCreditPricing | null }) {
  const token = useClientToken();
  const minRupees = credit ? Math.ceil(credit.minimumPurchasePaise / 100) : 0;
  const [rupees, setRupees] = useState<number | null>(null);
  const amount = rupees ?? minRupees;
  const amountPaise = toPaise(amount);
  const belowMin = credit != null && amountPaise < credit.minimumPurchasePaise;
  const aboveMax = credit?.maximumPurchasePaise != null && amountPaise > credit.maximumPurchasePaise;
  const credits = credit && !belowMin && !aboveMax ? creditsForAmount(amountPaise, credit) : null;
  const gstPaise = Math.round((amountPaise * (rates.taxPercent ?? 0)) / 100);
  const cta = token ? '/dashboard/billing?add=1' : '/signup';

  return (
    <div
      data-testid="buy-credits"
      className="overflow-hidden rounded-3xl border border-[#E7DFF5] bg-white shadow-[0_24px_60px_-32px_rgba(65,6,134,0.35)]"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
        <div className="p-6 sm:p-8">
          <p className="text-lg font-bold text-[#170B2E]">Prepaid credits, no subscription</p>
          <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-[#3D3650]">
            <li>
              <strong className="text-[#170B2E]">Buy by amount.</strong>{' '}
              {credit
                ? `Choose how much to spend, from ${formatMoney(credit.minimumPurchasePaise, credit.currency)}${
                    credit.maximumPurchasePaise != null ? ` up to ${formatMoney(credit.maximumPurchasePaise, credit.currency)}` : ''
                  } per purchase.`
                : 'Choose how much to spend; the minimum purchase is shown at checkout.'}
            </li>
            <li>
              <strong className="text-[#170B2E]">GST added at checkout.</strong> You see the credits, tax and total before
              you pay.
            </li>
            <li>
              <strong className="text-[#170B2E]">Each purchase has its own expiry.</strong> {purchaseExpiryText(credit)}
            </li>
            <li>
              <strong className="text-[#170B2E]">Paid features unlock</strong> after your first verified credit purchase.
            </li>
            <li>
              <strong className="text-[#170B2E]">Free credits are for calls.</strong> Any welcome or promotional credits
              cover audio, video and screen share only, and carry their own expiry. AI features (Live Translate, AI voice
              agents, post-call reports) always use purchased credits.
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-5 bg-gradient-to-br from-[#F8F4FD] to-[#EFE5FC] p-6 sm:p-8">
          {credit ? (
            <>
              <p className="text-sm text-[#3D3650]">
                Published price:{' '}
                <strong className="text-[#170B2E]">
                  {formatMoney(credit.creditPricePaise, credit.currency)} per credit
                </strong>
              </p>
              <label className="block text-sm text-[#3D3650]">
                Amount to spend (₹, before GST)
                <input
                  type="number"
                  inputMode="numeric"
                  min={minRupees}
                  step={100}
                  value={amount}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setRupees(Number.isFinite(n) ? Math.max(0, n) : 0);
                  }}
                  className="mt-2 w-full rounded-lg border border-[#D6C4EE] bg-white p-3 text-[#170B2E]"
                />
              </label>
              <div aria-live="polite" className="mt-auto">
                {credits != null ? (
                  <>
                    <p className="text-4xl font-bold tracking-tight text-[#170B2E]">
                      <span data-testid="calculated-credits">{formatCredits(credits)}</span>{' '}
                      <span className="text-lg font-semibold text-[#3D3650]">credits</span>
                    </p>
                    <p className="mt-1 text-sm text-[#3D3650]" data-testid="calculated-total">
                      {formatMoney(amountPaise, credit.currency)} + GST {formatRate(rates.taxPercent)}% (
                      {formatMoney(gstPaise, credit.currency)}) = {formatMoney(amountPaise + gstPaise, credit.currency)}
                    </p>
                    {minutesHint(credits, rates) && <p className="mt-1 text-xs text-[#3D3650]">{minutesHint(credits, rates)}</p>}
                  </>
                ) : (
                  <p className="text-sm text-[#3D3650]" role="alert">
                    {belowMin
                      ? `The minimum purchase is ${formatMoney(credit.minimumPurchasePaise, credit.currency)}.`
                      : `The maximum single purchase is ${formatMoney(credit.maximumPurchasePaise ?? 0, credit.currency)}.`}
                  </p>
                )}
                <p className="mt-3 text-xs text-[#3D3650]">
                  An estimate: the checkout quote is final. Credits are rounded down to whole units.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-[#3D3650]" data-testid="price-not-published">
              {PRICE_NOT_PUBLISHED}
            </p>
          )}
          <Link
            href={cta}
            className="btn-primary inline-flex items-center justify-center gap-2 self-start rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
          >
            {token ? 'Buy credits' : 'Create an account to buy credits'} <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Auto Top-Up ──────────────────────────────────────────────────────────
export function AutoTopUpExplainer() {
  return (
    <div data-testid="auto-topup-explainer">
      <p className="mb-5 max-w-3xl text-sm text-[#3D3650]">
        Keep your wallet funded automatically. Choose a credit threshold, a top-up amount and a monthly maximum in your wallet, then authorize a Razorpay eMandate. Auto Top-Up only charges after your mandate is confirmed, and you can disable it at any time.
      </p>
    </div>
  );
}

/** Shared visual pricing overview for the home page and /pricing. */
function PrepaidPricingFeature({ rates, credit, pageHeading = false }: { rates: CreditRates; credit: PublishedCreditPricing | null; pageHeading?: boolean }) {
  const token = useClientToken();
  const cta = token ? '/dashboard/billing?add=1' : '/signup';
  const Heading = pageHeading ? 'h1' : 'h2';
  const price = credit ? `${formatMoney(credit.creditPricePaise, credit.currency)} per credit` : 'Published soon';
  const purchaseSteps = ['Choose a purchase amount', 'See estimated credits and taxes', 'Complete payment securely', 'Credits added after successful payment'];
  const steps = [
    { icon: CreditCard, title: 'Add credits', body: 'Choose a monetary amount and review your credit estimate before checkout.' },
    { icon: PhoneCall, title: 'Use across features', body: 'Credits are consumed based on the feature you use and its configured rate.' },
    { icon: Receipt, title: 'Track & manage', body: 'Monitor your balance, purchase history and individual credit-lot expiry dates.' },
  ];
  const usageRows = [
    { icon: Mic, feature: 'Audio calls', rate: `${formatRate(rates.audioCreditsPerMinute)} credits/min`, detail: 'Voice calls with real-time transcription' },
    { icon: Video, feature: 'Video calls', rate: `${formatRate(rates.videoCreditsPerMinute)} credits/min`, detail: 'Video calls with real-time translation' },
    { icon: Monitor, feature: 'Screen sharing', rate: `${formatRate(rates.screenShareCreditsPerMinute)} credits/min`, detail: 'Screen-sharing time during a call' },
    ...(rates.aiCreditsPerMinute != null ? [{ icon: Bot, feature: 'AI calling agents', rate: `${formatRate(rates.aiCreditsPerMinute)} credits/min`, detail: 'AI voice agents and assistants' }] : []),
    { icon: Sparkles, feature: 'Live Translate', rate: 'Varies by provider', detail: 'Real-time translation for calls and meetings' },
  ];

  return (
    <div className="space-y-12 sm:space-y-16" data-testid="prepaid-pricing-feature">
      <div className="grid items-center gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:gap-14">
        <div>
          <p className="section-label font-mono text-xs uppercase tracking-[0.2em]">Simple, flexible pricing</p>
          <Heading className="lp-h2 mt-5 max-w-xl font-bold text-[#170B2E]">Pricing that moves with your usage.</Heading>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#3D3650] sm:text-lg">Add prepaid credits to your wallet and use them across eligible PurpleCallio features. Choose your purchase amount, review the estimated credits and taxes, and continue when you&apos;re ready.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={cta} data-testid="pricing-primary-cta" className="btn-primary inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_rgba(65,6,134,0.8)]">
              {token ? 'Buy credits' : 'Create an account'} <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <a href="#how-credits-work" className="inline-flex items-center gap-2 rounded-lg border border-[#D6C4EE] bg-white px-5 py-3 text-sm font-semibold text-[#6425C4] hover:bg-[#F8F4FD]">How credits work</a>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[#E7DFF5] bg-gradient-to-br from-white via-[#FCFAFF] to-[#F5EEFF] p-6 shadow-[0_22px_55px_-36px_rgba(65,6,134,0.5)] sm:p-8">
          <div className="absolute -right-20 -top-20 h-52 w-52 rounded-full bg-[#A05DF9]/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#7F40E8]/10 text-[#7F40E8] ring-1 ring-[#7F40E8]/15"><Wallet size={27} aria-hidden="true" /></span>
              <div><h3 className="text-xl font-bold text-[#170B2E]">Prepaid Credits</h3><p className="mt-1 max-w-sm text-sm leading-6 text-[#3D3650]">Add credits to your wallet and use them across eligible PurpleCallio features.</p></div>
            </div>
            <span className="hidden shrink-0 items-center gap-1 rounded-full border border-[#E0D2F6] bg-white/70 px-3 py-1 text-xs font-semibold text-[#6425C4] sm:inline-flex"><Sparkles size={13} aria-hidden="true" /> Prepaid</span>
          </div>
          <div className="relative mt-7 grid gap-6 border-t border-[#E7DFF5] pt-6 sm:grid-cols-[0.9fr_1.1fr] sm:gap-8">
            <div>
              <p className="text-sm font-semibold text-[#170B2E]">Current price</p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-[#170B2E]" data-testid="credit-price">{price}</p>
              <p className="mt-3 text-xs leading-5 text-[#5D536E]">{credit ? 'Price is shown before taxes. The final amount is calculated at checkout.' : PRICE_NOT_PUBLISHED}</p>
              <Link href={cta} className="btn-primary mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white">Buy credits <ArrowRight size={15} aria-hidden="true" /></Link>
            </div>
            <ul className="space-y-3 border-[#E7DFF5] text-sm text-[#3D3650] sm:border-l sm:pl-7">
              {purchaseSteps.map((step, index) => <li key={step} className="flex items-center gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#7F40E8]/10 text-xs font-bold text-[#6425C4]">{index + 1}</span>{step}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <div id="how-credits-work" className="grid gap-8 border-y border-[#E7DFF5] py-8 sm:py-10 lg:grid-cols-[0.9fr_2.1fr]">
        <div><h3 className="text-2xl font-bold tracking-tight text-[#170B2E]">How it works</h3><p className="mt-3 max-w-sm text-sm leading-6 text-[#3D3650]">Getting started is simple. Add credits, use them across features, and stay in control.</p></div>
        <ol className="grid gap-6 sm:grid-cols-3">
          {steps.map((step, index) => <li key={step.title}><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#7F40E8]/10 text-[#7F40E8] ring-1 ring-[#7F40E8]/15"><step.icon size={21} aria-hidden="true" /></span><p className="mt-4 font-semibold text-[#170B2E]">{index + 1}. {step.title}</p><p className="mt-2 text-sm leading-6 text-[#3D3650]">{step.body}</p></li>)}
        </ol>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#E7DFF5] bg-gradient-to-br from-[#FCFAFF] via-white to-[#F7F1FE] p-6 sm:p-8">
        <div className="grid gap-7 lg:grid-cols-[0.85fr_1.6fr]">
          <div><h3 className="text-2xl font-bold tracking-tight text-[#170B2E]">Feature usage &amp; credit consumption</h3><p className="mt-3 text-sm leading-6 text-[#3D3650]">Different features use different amounts of credits. The purchase price is separate from each feature&apos;s consumption rate.</p></div>
          <div className="overflow-x-auto rounded-xl border border-[#E7DFF5] bg-white"><table className="min-w-[540px] w-full text-left text-sm"><thead className="border-b border-[#E7DFF5] bg-[#FCFAFF] text-xs text-[#5D536E]"><tr><th className="px-4 py-3 font-semibold">Feature</th><th className="px-4 py-3 font-semibold">Consumption rate</th><th className="px-4 py-3 font-semibold">What it&apos;s used for</th></tr></thead><tbody>{usageRows.map((row) => <tr key={row.feature} className="border-b border-[#E7DFF5] last:border-0"><td className="px-4 py-3 font-medium text-[#170B2E]"><span className="mr-2 inline-flex h-6 w-6 translate-y-1 items-center justify-center rounded-md bg-[#7F40E8]/10 text-[#7F40E8]"><row.icon size={14} aria-hidden="true" /></span>{row.feature}</td><td className="px-4 py-3 text-[#3D3650]">{row.rate}</td><td className="px-4 py-3 text-[#3D3650]">{row.detail}</td></tr>)}</tbody></table><p className="px-4 py-3 text-xs text-[#5D536E]">Rates are configured by your administrator and may vary by feature and provider.</p></div>
        </div>
      </div>
    </div>
  );
}

// ── Live Translate (early access) ────────────────────────────────────────
/** Rates come from GET /translation/estimate (admin-managed), with a "Pricing set at launch" fallback. */
function LiveTranslatePricing() {
  return (
    <div id="live-translate" className="scroll-mt-24" data-testid="live-translate-pricing">
      <h3 className="mb-2 mt-16 flex flex-wrap items-center gap-2 text-xl font-bold text-[#170B2E]">
        Live Translate
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Early access</span>
      </h3>
      <p className="mb-5 max-w-3xl text-sm text-[#3D3650]">
        Real-time voice translation and captions for 1:1 calls. Billed per minute for each person translating (one side 1×, both sides 2×),
        from the same credit balance, on top of the call&apos;s own audio or video minutes. Same-language calls aren&apos;t
        charged for translation.{' '}
        <Link href="/features/live-translation" className="font-medium text-[#6425C4] hover:text-[#170B2E]">
          About Live Translate →
        </Link>
      </p>
      <TranslationRateList />
      <div className="mt-5">
        <CostGuardEstimator />
      </div>
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────
function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-5 mt-16 text-xl font-bold text-[#170B2E]">{children}</h3>;
}

/**
 * Public prepaid pricing, fed by GET /billing/credit-rates (consumption rates,
 * GST) and GET /billing/credit-pricing/current (price per credit).
 * `summary` (homepage) renders a link to the pricing page; `full` adds the
 * credit explainer, Auto Top-Up details and Live Translate.
 */
export default function PricingSection({
  variant = 'summary',
  bare = false,
  initialRates,
  initialCredit,
}: {
  variant?: 'summary' | 'full';
  /** Inside a page that already has its own heading and gutters. */
  bare?: boolean;
  /** Server-fetched data so the page's HTML has real rates (SEO/AEO). */
  initialRates?: PublicPricing;
  initialCredit?: PublishedCreditPricing | null;
}) {
  const state = usePublicPricing(initialRates);
  const priceState = usePublishedCreditPricing(initialCredit);
  const full = variant === 'full';
  // An unavailable price endpoint is treated like an unpublished price — never invented.
  const credit = priceState.status === 'ready' ? priceState.data : null;
  const loading = state.status === 'loading' || priceState.status === 'loading';

  return (
    <section id="pricing" className={bare ? 'scroll-mt-24' : 'section-base px-6 py-24'}>
      <div className={bare ? '' : 'mx-auto max-w-6xl'}>
        {state.status === 'error' && <PricingError onRetry={state.retry} />}
        {state.status !== 'error' && loading && <PricingLoading />}
        {state.status === 'ready' && !loading && (
          <>
            <PrepaidPricingFeature rates={state.data.creditRates} credit={credit} pageHeading={full} />

            {full ? (
              <>
                <SubHeading>More about your credits</SubHeading>
                <HowCreditsWork pricing={state.data} credit={credit} />

                <div id="auto-top-up" className="scroll-mt-24">
                  <SubHeading>Auto Top-Up</SubHeading>
                  <AutoTopUpExplainer />
                </div>

                <LiveTranslatePricing />
              </>
            ) : (
              <div className="mt-10 text-center">
                <Link href="/pricing" className="text-sm font-medium text-[#6425C4] hover:text-[#170B2E]">
                  See detailed pricing and credit tools →
                </Link>
              </div>
            )}
          </>
        )}

        {full && (
          <div className="mt-12 rounded-xl border border-[#E7DFF5] p-8 text-center">
            <p className="mb-2 text-lg font-bold text-[#170B2E]">Questions about credits?</p>
            <p className="mx-auto mb-6 max-w-xl text-sm text-[#3D3650]">
              Read how credit purchases, expiry, Auto Top-Up and refunds work, or review the billing terms.
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
