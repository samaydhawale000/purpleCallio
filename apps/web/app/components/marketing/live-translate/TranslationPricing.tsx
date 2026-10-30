"use client";

import { useEffect, useState } from "react";
import { Calculator } from "lucide-react";
import { PRICING_FALLBACK } from "../../../lib/live-translate";
import {
   fetchTranslationEstimate,
   loadTranslationRates,
   type EstimateMode,
   type TranslationEstimate,
   type TranslationRates,
} from "../../../lib/live-translate-api";

const fmt = (n: number, max = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: max });

export function useTranslationRates(): { status: "loading" | "ready"; rates: TranslationRates | null } {
   const [rates, setRates] = useState<TranslationRates | null>(null);
   const [done, setDone] = useState(false);
   useEffect(() => {
      let active = true;
      loadTranslationRates()
         .then((r) => active && setRates(r))
         .catch(() => undefined)
         .finally(() => active && setDone(true));
      return () => {
         active = false;
      };
   }, []);
   return { status: done ? "ready" : "loading", rates };
}

function RateValue({ estimate }: { estimate: TranslationEstimate | null }) {
   if (!estimate) return <span className="text-[#3D3650]">{PRICING_FALLBACK}</span>;
   return (
      <span>
         <strong className="text-[#170B2E]">{fmt(estimate.ratePerMinute)} credits</strong> per minute, per person translating
         {estimate.approxInrPerMinute != null && <span className="text-[#3D3650]"> (≈ ₹{fmt(estimate.approxInrPerMinute)})</span>}
      </span>
   );
}

/** Voice + captions per-minute rates from GET /translation/estimate; never hard-coded. */
export function TranslationRateList({ className = "" }: { className?: string }) {
   const { status, rates } = useTranslationRates();
   return (
      <dl className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`} data-testid="translation-rates">
         {(["voice", "captions"] as const).map((mode) => (
            <div key={mode} className="rounded-xl border border-[#E7DFF5] bg-white p-4">
               <dt className="text-xs font-semibold uppercase tracking-wider text-[#6425C4]">
                  {mode === "voice" ? "Voice translation" : "Translated captions"}
               </dt>
               <dd className="mt-1 text-sm">
                  {status === "loading" ? <span className="text-[#3D3650]">Loading current rate…</span> : <RateValue estimate={rates?.[mode] ?? null} />}
               </dd>
            </div>
         ))}
      </dl>
   );
}

/**
 * CostGuard estimator: mode, minutes per call and calls per month → credits
 * and approximate ₹, straight from GET /translation/estimate.
 */
export function CostGuardEstimator() {
   const [mode, setMode] = useState<EstimateMode>("voice");
   const [minutes, setMinutes] = useState(10);
   const [calls, setCalls] = useState(100);
   const [listeners, setListeners] = useState<1 | 2>(2);
   const [result, setResult] = useState<TranslationEstimate | null>(null);
   const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

   useEffect(() => {
      let active = true;
      setStatus("loading");
      const t = window.setTimeout(() => {
         fetchTranslationEstimate({ mode, minutes: Math.max(1, minutes), calls: Math.max(1, calls), listeners }).then((r) => {
            if (!active) return;
            setResult(r);
            setStatus(r ? "ready" : "unavailable");
         });
      }, 250);
      return () => {
         active = false;
         window.clearTimeout(t);
      };
   }, [mode, minutes, calls, listeners]);

   const perCall = result ? (result.creditsPerCall ?? Math.ceil(result.ratePerMinute * minutes * listeners)) : null;
   const total = result ? (result.totalCredits ?? (perCall ?? 0) * calls) : null;
   const inrPerCall = result?.approxInrPerCall ?? null;
   const inrTotal = result?.approxInrTotal ?? null;

   return (
      <div id="costguard-calculator" className="scroll-mt-24 rounded-2xl border border-[#E7DFF5] bg-white p-6" data-testid="costguard-estimator">
         <p className="flex items-center gap-2 font-semibold text-[#170B2E]">
            <Calculator size={18} className="text-[#7F40E8]" aria-hidden="true" />
            CostGuard estimator
         </p>
         <p className="mt-1 text-sm text-[#3D3650]">Estimate what translated calls will cost before you scale.</p>

         <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <fieldset>
               <legend className="mb-1.5 text-xs font-semibold text-[#3D3650]">Mode</legend>
               <div className="flex rounded-lg border border-[#E7DFF5] p-1">
                  {(["voice", "captions"] as const).map((m) => (
                     <button
                        key={m}
                        type="button"
                        aria-pressed={mode === m}
                        onClick={() => setMode(m)}
                        className={`flex-1 rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                           mode === m ? "bg-[#7F40E8] text-white" : "text-[#3D3650] hover:bg-[#F8F4FD]"
                        }`}
                     >
                        {m}
                     </button>
                  ))}
               </div>
            </fieldset>
            <fieldset>
               <legend className="mb-1.5 text-xs font-semibold text-[#3D3650]">People translating</legend>
               <div className="flex rounded-lg border border-[#E7DFF5] p-1">
                  {([1, 2] as const).map((n) => (
                     <button
                        key={n}
                        type="button"
                        aria-pressed={listeners === n}
                        onClick={() => setListeners(n)}
                        className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                           listeners === n ? "bg-[#7F40E8] text-white" : "text-[#3D3650] hover:bg-[#F8F4FD]"
                        }`}
                     >
                        {n === 1 ? "One side" : "Both"}
                     </button>
                  ))}
               </div>
            </fieldset>
            <label className="text-xs font-semibold text-[#3D3650]">
               Translated minutes per call
               <input
                  type="number"
                  min={1}
                  max={600}
                  value={minutes}
                  onChange={(e) => setMinutes(Math.min(600, Math.max(1, Number(e.target.value) || 1)))}
                  className="mt-1.5 w-full rounded-lg border border-[#E7DFF5] px-3 py-2 text-sm font-normal text-[#170B2E]"
               />
            </label>
            <label className="text-xs font-semibold text-[#3D3650]">
               Translated calls per month
               <input
                  type="number"
                  min={1}
                  max={1000000}
                  value={calls}
                  onChange={(e) => setCalls(Math.min(1_000_000, Math.max(1, Number(e.target.value) || 1)))}
                  className="mt-1.5 w-full rounded-lg border border-[#E7DFF5] px-3 py-2 text-sm font-normal text-[#170B2E]"
               />
            </label>
         </div>

         <div className="mt-5 rounded-xl bg-[#F8F4FD] p-4 text-sm" aria-live="polite">
            {status === "loading" && <p className="text-[#3D3650]">Calculating…</p>}
            {status === "unavailable" && (
               <p className="text-[#3D3650]">
                  {PRICING_FALLBACK}. Live Translate is in early access; rates will appear here once they are published.
               </p>
            )}
            {status === "ready" && result && (
               <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <p>
                     <span className="block text-xs text-[#3D3650]">Rate</span>
                     <strong className="text-[#170B2E]">{fmt(result.ratePerMinute)} credits/min</strong>
                  </p>
                  <p>
                     <span className="block text-xs text-[#3D3650]">Per call</span>
                     <strong className="text-[#170B2E]">{fmt(perCall ?? 0, 0)} credits</strong>
                     {inrPerCall != null && <span className="text-[#3D3650]"> ≈ ₹{fmt(inrPerCall)}</span>}
                  </p>
                  <p>
                     <span className="block text-xs text-[#3D3650]">Per month</span>
                     <strong className="text-[#170B2E]">{fmt(total ?? 0, 0)} credits</strong>
                     {inrTotal != null && <span className="text-[#3D3650]"> ≈ ₹{fmt(inrTotal)}</span>}
                  </p>
               </div>
            )}
            {status === "ready" && result?.note && <p className="mt-3 text-xs text-[#3D3650]">{result.note}</p>}
         </div>
         <p className="mt-3 text-xs text-[#3D3650]">
            Billed per minute for each person who receives translation. Two people without a shared language means both
            sides (2×); one side (1×) only when one of them already understands the other&apos;s language. Credits come
            from your prepaid balance; rupee amounts use the published credit price. GST extra.
         </p>
      </div>
   );
}
