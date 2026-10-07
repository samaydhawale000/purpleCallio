/**
 * Helpers for the public (marketing) pricing surfaces: pricing page, homepage,
 * FAQ, docs and legal pages. Everything is derived from GET /billing/plans via
 * `getPublicPricing()` — nothing here hard-codes a price, credit amount,
 * feature or rate.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  formatMoney,
  getPublicPricing,
  intervalLabel,
  type CreditRates,
  type Feature,
  type Plan,
  type PlanVersion,
  type PublicPricing,
} from './billing';

// ── Fetching (one request shared by every pricing widget on a page) ───────
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; promise: Promise<PublicPricing> } | null = null;

export function loadPublicPricing(): Promise<PublicPricing> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;
  const promise = getPublicPricing().catch((err) => {
    cached = null;
    throw err;
  });
  cached = { at: Date.now(), promise };
  return promise;
}

/** Test hook / manual refresh. */
export function resetPublicPricingCache() {
  cached = null;
}

export type PublicPricingState =
  | { status: 'loading'; data: null; retry: () => void }
  | { status: 'error'; data: null; retry: () => void }
  | { status: 'ready'; data: PublicPricing; retry: () => void };

export function usePublicPricing(): PublicPricingState {
  const [data, setData] = useState<PublicPricing | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadPublicPricing()
      .then((d) => {
        if (active) {
          setData(d);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    resetPublicPricingCache();
    setError(false);
    setData(null);
    setAttempt((n) => n + 1);
  }, []);

  if (data) return { status: 'ready', data, retry };
  if (error) return { status: 'error', data: null, retry };
  return { status: 'loading', data: null, retry };
}

// ── Plans ────────────────────────────────────────────────────────────────
export function sortPlans(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** True when the plan is the "talk to us" / custom offering. */
export function isContactPlan(plan: Plan) {
  return plan.customPricing || plan.ctaAction === 'CONTACT_SALES';
}

export function isFreePlan(plan: Plan) {
  return plan.type === 'FREE' || (!plan.customPricing && (plan.version?.pricePaise ?? 0) === 0);
}

/** Price headline + interval suffix ("₹0", "₹2,999" + "per month", or "Custom pricing"). */
export function planPrice(plan: Plan): { amount: string; suffix: string | null } {
  if (plan.customPricing || !plan.version) return { amount: 'Custom pricing', suffix: null };
  const v = plan.version;
  const interval = intervalLabel(v);
  return {
    amount: formatMoney(v.pricePaise, v.currency),
    suffix: interval ? `per ${interval}` : null,
  };
}

export function planCtaLabel(plan: Plan): string {
  if (plan.ctaLabel) return plan.ctaLabel;
  switch (plan.ctaAction) {
    case 'SIGNUP':
      return 'Get started';
    case 'CONTACT_SALES':
      return 'Talk to us';
    default:
      return `Choose ${plan.name}`;
  }
}

/**
 * Where a plan's CTA goes. Logged-out visitors go through sign-up, which
 * remembers the choice (/signup?plan=<slug> or /signup?intent=custom) and
 * routes them to the plan / custom-plan flow after authentication.
 */
export function planCtaHref(plan: Plan, loggedIn: boolean): string {
  switch (plan.ctaAction) {
    case 'SIGNUP':
      return loggedIn ? '/dashboard/billing' : '/signup';
    case 'CONTACT_SALES':
      return loggedIn ? '/dashboard/billing/plans?custom=1' : '/signup?intent=custom';
    case 'CHECKOUT':
    default:
      return loggedIn
        ? `/dashboard/billing/plans?plan=${encodeURIComponent(plan.slug)}`
        : `/signup?plan=${encodeURIComponent(plan.slug)}`;
  }
}

/** How many months one plan period covers (for monthly-equivalent comparisons). */
export function periodMonths(v: Pick<PlanVersion, 'billingInterval' | 'intervalCount'>): number {
  const count = Math.max(1, v.intervalCount || 1);
  if (v.billingInterval === 'YEAR') return 12 * count;
  if (v.billingInterval === 'CUSTOM') return count / 30;
  return count;
}

export function monthlyCredits(plan: Plan): number | null {
  if (!plan.version) return null;
  return plan.version.includedCredits / periodMonths(plan.version);
}

/** Feature key → registry display name (unknown keys fall back to the key). */
export function featureNames(features: Feature[]): Map<string, string> {
  return new Map(features.map((f) => [f.key, f.name]));
}

function humanize(key: string) {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}


// ── Credits ──────────────────────────────────────────────────────────────
export const formatRate = (n: number) => (n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export interface UsageProfile {
  callsPerMonth: number;
  avgParticipants: number;
  avgMinutes: number;
  /** % of participant-minutes with video on (the rest are audio-only). */
  videoPercent: number;
  /** % of call time during which one participant shares a screen. */
  screenSharePercent: number;
}

export interface UsageEstimate {
  audioMinutes: number;
  videoMinutes: number;
  screenShareMinutes: number;
  audioCredits: number;
  videoCredits: number;
  screenShareCredits: number;
  totalCredits: number;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

/**
 * Participant-minutes per media type → credits, using the API's credit rates.
 * Screen sharing is metered as its own category (one sharer per call).
 */
export function estimateUsage(profile: UsageProfile, rates: Pick<CreditRates, 'audioCreditsPerMinute' | 'videoCreditsPerMinute' | 'screenShareCreditsPerMinute'>): UsageEstimate {
  const calls = Math.max(0, profile.callsPerMonth || 0);
  const people = Math.max(0, profile.avgParticipants || 0);
  const minutes = Math.max(0, profile.avgMinutes || 0);
  const participantMinutes = calls * people * minutes;
  const videoMinutes = Math.round((participantMinutes * clampPct(profile.videoPercent)) / 100);
  const audioMinutes = Math.round(participantMinutes - videoMinutes);
  const screenShareMinutes = Math.round((calls * minutes * clampPct(profile.screenSharePercent)) / 100);
  const audioCredits = audioMinutes * rates.audioCreditsPerMinute;
  const videoCredits = videoMinutes * rates.videoCreditsPerMinute;
  const screenShareCredits = screenShareMinutes * rates.screenShareCreditsPerMinute;
  return {
    audioMinutes,
    videoMinutes,
    screenShareMinutes,
    audioCredits,
    videoCredits,
    screenShareCredits,
    totalCredits: Math.ceil(audioCredits + videoCredits + screenShareCredits),
  };
}

/**
 * Smallest self-serve plan whose monthly-equivalent included credits cover
 * the estimate; otherwise the custom plan (if one is public); otherwise null.
 */
export function recommendPlan(credits: number, plans: Plan[]): { plan: Plan | null; kind: 'fits' | 'custom' | 'none' } {
  const selfServe = sortPlans(plans)
    .filter((p) => !isContactPlan(p) && p.version)
    .sort((a, b) => (monthlyCredits(a) ?? 0) - (monthlyCredits(b) ?? 0));
  const fit = selfServe.find((p) => (monthlyCredits(p) ?? 0) >= credits);
  if (fit) return { plan: fit, kind: 'fits' };
  const custom = sortPlans(plans).find(isContactPlan) ?? null;
  return custom ? { plan: custom, kind: 'custom' } : { plan: null, kind: 'none' };
}

export function topUpExpiryText(rates: Pick<CreditRates, 'topUpExpiryPolicy' | 'topUpExpiryDays'>): string {
  switch (rates.topUpExpiryPolicy) {
    case 'NEVER':
      return 'Top-up credits currently do not expire.';
    case 'DAYS':
      return rates.topUpExpiryDays
        ? `Top-up credits currently expire ${rates.topUpExpiryDays} days after purchase.`
        : 'Top-up credits expire according to the policy shown at purchase.';
    case 'SUBSCRIPTION_END':
      return 'Top-up credits currently expire at the end of your plan period.';
    default:
      return 'Top-up credits expire according to the policy shown at purchase.';
  }
}

export function gstNote(rates: Pick<CreditRates, 'taxPercent'>): string {
  return `Prices exclude GST (${formatRate(rates.taxPercent)}%), added at checkout.`;
}
