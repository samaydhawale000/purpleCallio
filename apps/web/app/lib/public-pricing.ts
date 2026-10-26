/**
 * Helpers for the public (marketing) pricing surfaces: pricing page, homepage,
 * FAQ, docs and legal pages. PurpleCallio sells prepaid credits — there are no
 * subscription plans to list. Everything shown is fetched:
 *
 *  - consumption rates + GST from GET /billing/credit-rates
 *  - the admin-published price per credit from GET /billing/credit-pricing/current
 *
 * Nothing here hard-codes a price, credit amount or rate.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { formatRate, validityPhrase } from './pricing-format';
import { formatMoney, getPublishedCreditPricing, type CreditRates, type PublishedCreditPricing } from './billing';

export interface PublicPricing {
  creditRates: CreditRates;
}

// ── Shared fetch cache (one request per endpoint for every widget on a page) ──
const CACHE_TTL_MS = 5 * 60 * 1000;

function createCache<T>(load: () => Promise<T>) {
  let cached: { at: number; promise: Promise<T> } | null = null;
  return {
    get(): Promise<T> {
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;
      const promise = load().catch((err) => {
        cached = null;
        throw err;
      });
      cached = { at: Date.now(), promise };
      return promise;
    },
    reset() {
      cached = null;
    },
  };
}

const ratesCache = createCache<PublicPricing>(() =>
  api.get<CreditRates>('/billing/credit-rates').then((r) => ({ creditRates: r.data })),
);
const creditPriceCache = createCache<PublishedCreditPricing | null>(() =>
  // An unpublished price comes back as null / an empty body.
  getPublishedCreditPricing('INR').then((p) => (p && typeof p === 'object' && p.creditPricePaise > 0 ? p : null)),
);

export function loadPublicPricing(): Promise<PublicPricing> {
  return ratesCache.get();
}

export function loadPublishedCreditPricing(): Promise<PublishedCreditPricing | null> {
  return creditPriceCache.get();
}

/** Test hook / manual refresh. */
export function resetPublicPricingCache() {
  ratesCache.reset();
  creditPriceCache.reset();
}

export type LoadState<T> =
  | { status: 'loading'; data: null; retry: () => void }
  | { status: 'error'; data: null; retry: () => void }
  | { status: 'ready'; data: T; retry: () => void };

export type PublicPricingState = LoadState<PublicPricing>;

/** `initial` (server-rendered data) starts the state as ready; the client still refreshes it. */
function useCached<T>(load: () => Promise<T>, reset: () => void, initial?: { data: T }): LoadState<T> {
  const [result, setResult] = useState<{ data: T } | null>(initial ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    load()
      .then((d) => {
        if (active) {
          setResult({ data: d });
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, load]);

  const retry = useCallback(() => {
    reset();
    setError(false);
    setResult(null);
    setAttempt((n) => n + 1);
  }, [reset]);

  if (result) return { status: 'ready', data: result.data, retry };
  if (error) return { status: 'error', data: null, retry };
  return { status: 'loading', data: null, retry };
}

/** Live consumption rates and GST (GET /billing/credit-rates). */
export function usePublicPricing(initial?: PublicPricing): PublicPricingState {
  return useCached(loadPublicPricing, ratesCache.reset, initial ? { data: initial } : undefined);
}

/**
 * The admin-published price per credit (GET /billing/credit-pricing/current).
 * `data` is null while no price has been published yet.
 */
export function usePublishedCreditPricing(
  initial?: PublishedCreditPricing | null,
): LoadState<PublishedCreditPricing | null> {
  return useCached(
    loadPublishedCreditPricing,
    creditPriceCache.reset,
    initial === undefined ? undefined : { data: initial },
  );
}

// ── Prepaid purchases ────────────────────────────────────────────────────
/** Whole credits a purchase amount buys at the published rate (rounded down, like the server). */
export function creditsForAmount(amountPaise: number, pricing: Pick<PublishedCreditPricing, 'creditPricePaise'>): number {
  if (!pricing.creditPricePaise || pricing.creditPricePaise <= 0 || !Number.isFinite(amountPaise)) return 0;
  return Math.max(0, Math.floor(amountPaise / pricing.creditPricePaise));
}

export function purchaseExpiryText(pricing: Pick<PublishedCreditPricing, 'purchasedValidityDays'> | null | undefined): string {
  return `Purchased credits expire ${validityPhrase(pricing?.purchasedValidityDays)}, per purchase.`;
}

export function minimumPurchaseText(pricing: Pick<PublishedCreditPricing, 'minimumPurchasePaise' | 'currency'>): string {
  return `Minimum purchase ${formatMoney(pricing.minimumPurchasePaise, pricing.currency)}`;
}

export const PRICE_NOT_PUBLISHED =
  'Credit pricing will be published soon. Consumption rates below already apply to every credit you hold.';

// ── Credits ──────────────────────────────────────────────────────────────

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

export function gstNote(rates: Pick<CreditRates, 'taxPercent'>): string {
  return `Prices exclude GST (${formatRate(rates.taxPercent)}%), added at checkout.`;
}

export { formatRate, validityPhrase };
