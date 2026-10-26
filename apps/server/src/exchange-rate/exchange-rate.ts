/**
 * USD → INR used to value provider costs (Soniox, AI models) in paise.
 * Internal only: customers are billed in credits and never see this rate.
 *
 * Order: AI_USD_INR_RATE when set (a manual pin), else the live rate that
 * ExchangeRateService refreshes daily, else DEFAULT_USD_INR_RATE.
 */
export const DEFAULT_USD_INR_RATE = 95;
/** Anything outside this band is treated as a bad response, not a rate. */
const MIN_SANE_RATE = 50;
const MAX_SANE_RATE = 200;

let live: { rate: number; asOf: Date; source: string } | null = null;

export function isSaneUsdInrRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= MIN_SANE_RATE && rate <= MAX_SANE_RATE;
}

export function setLiveUsdInrRate(rate: number, source: string, asOf = new Date()) {
  if (isSaneUsdInrRate(rate)) live = { rate, asOf, source };
}

export function liveUsdInrRate() {
  return live;
}

export function usdInrRate(): number {
  const raw = process.env.AI_USD_INR_RATE;
  const pinned = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(pinned) && pinned > 0) return pinned;
  return live?.rate ?? DEFAULT_USD_INR_RATE;
}

/** Test hook. */
export function resetLiveUsdInrRate() {
  live = null;
}
