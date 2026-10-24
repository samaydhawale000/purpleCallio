"use client";

import { usePublicPricing } from "../../lib/public-pricing";

/** The live AI credit rate from the pricing API; never hard-coded. */
export function AiRateNote({ fallback = "AI calls are billed per minute in credits." }: { fallback?: string }) {
   const state = usePublicPricing();
   const rate = state.status === "ready" ? state.data.creditRates.aiCreditsPerMinute : undefined;
   if (!rate) return <>{fallback}</>;
   return (
      <>
         AI calls use <strong className="text-[#170B2E]">{rate} credits per minute</strong> from your plan&apos;s
         credit balance.
      </>
   );
}
