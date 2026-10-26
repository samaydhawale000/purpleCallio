import { PURPLECALLIO_API_URL } from "./brand";
import type { CreditRates, PublishedCreditPricing } from "./billing";
import type { PublicPricing } from "./public-pricing";

/**
 * Server-side reads of the public pricing endpoints, so /pricing renders real
 * rates in its HTML (search engines and AI answer engines don't run the
 * client fetch). Cached for 5 minutes; any failure returns undefined and the
 * page falls back to loading in the browser, exactly as before.
 */
const API = (process.env.API_INTERNAL_URL || PURPLECALLIO_API_URL).replace(/\/$/, "");
const REVALIDATE_SECONDS = 300;

async function getJson<T>(path: string): Promise<T | undefined> {
  try {
    const res = await fetch(`${API}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return undefined;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return undefined;
  }
}

export interface ServerPricing {
  /** undefined = unavailable (client loads it). */
  rates?: PublicPricing;
  /** undefined = unavailable; null = no price published yet. */
  credit?: PublishedCreditPricing | null;
}

export async function getServerPricing(): Promise<ServerPricing> {
  const [rates, credit] = await Promise.all([
    getJson<CreditRates>("/billing/credit-rates"),
    getJson<PublishedCreditPricing | null>("/billing/credit-pricing/current?currency=INR"),
  ]);
  return {
    rates: rates && typeof rates === "object" ? { creditRates: rates } : undefined,
    credit:
      credit === undefined
        ? undefined
        : credit && typeof credit === "object" && credit.creditPricePaise > 0
          ? credit
          : null,
  };
}
