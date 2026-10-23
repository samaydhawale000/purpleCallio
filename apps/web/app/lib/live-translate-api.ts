/** Client-side fetchers for Live Translate public endpoints (graceful fallbacks). */
import { api } from "./api";
import type { TranslationLanguage } from "./live-translate";

function parseLanguages(data: unknown): TranslationLanguage[] | null {
   const list = (data as { languages?: unknown })?.languages;
   if (!Array.isArray(list) || list.length === 0) return null;
   const out: TranslationLanguage[] = [];
   for (const raw of list) {
      const l = raw as Record<string, unknown>;
      if (typeof l?.code !== "string" || typeof l?.name !== "string") return null;
      out.push({
         code: l.code,
         name: l.name,
         nativeName: typeof l.nativeName === "string" ? l.nativeName : l.name,
         rtl: l.rtl === true,
         voice: l.voice === true,
         captions: l.captions === true,
      });
   }
   return out;
}

export async function fetchTranslationLanguages(): Promise<TranslationLanguage[] | null> {
   try {
      const res = await api.get("/translation/languages");
      return parseLanguages(res?.data);
   } catch {
      return null;
   }
}

// ── Estimates (CostGuard) ────────────────────────────────────────────────
export type EstimateMode = "voice" | "captions";

export interface TranslationEstimate {
   mode: EstimateMode;
   ratePerMinute: number;
   creditsPerCall: number | null;
   totalCredits: number | null;
   approxInrPerCall: number | null;
   note: string | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseEstimate(data: unknown, mode: EstimateMode): TranslationEstimate | null {
   const d = data as Record<string, unknown> | null;
   const rate = num(d?.ratePerMinute);
   if (rate == null || rate <= 0) return null;
   return {
      mode,
      ratePerMinute: rate,
      creditsPerCall: num(d?.creditsPerCall),
      totalCredits: num(d?.totalCredits),
      approxInrPerCall: num(d?.approxInrPerCall),
      note: typeof d?.note === "string" ? d.note : null,
   };
}

export async function fetchTranslationEstimate(params: {
   mode: EstimateMode;
   minutes: number;
   calls?: number;
}): Promise<TranslationEstimate | null> {
   try {
      const res = await api.get("/translation/estimate", {
         params: { mode: params.mode, minutes: params.minutes, calls: params.calls ?? 1 },
      });
      return parseEstimate(res?.data, params.mode);
   } catch {
      return null;
   }
}

export interface TranslationRates {
   voice: TranslationEstimate | null;
   captions: TranslationEstimate | null;
}

let ratesCache: { at: number; promise: Promise<TranslationRates> } | null = null;

/** Per-minute voice + captions rates (one request pair shared per page load). */
export function loadTranslationRates(): Promise<TranslationRates> {
   if (ratesCache && Date.now() - ratesCache.at < 5 * 60 * 1000) return ratesCache.promise;
   const promise = Promise.all([
      fetchTranslationEstimate({ mode: "voice", minutes: 1 }),
      fetchTranslationEstimate({ mode: "captions", minutes: 1 }),
   ]).then(([voice, captions]) => ({ voice, captions }));
   ratesCache = { at: Date.now(), promise };
   return promise;
}

export function resetTranslationRatesCache() {
   ratesCache = null;
}

