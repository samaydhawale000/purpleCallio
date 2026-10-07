"use client";

import Link from "next/link";
import { formatCredits, intervalLabel } from "../lib/billing";
import { formatRate, gstNote, planPrice, sortPlans, topUpExpiryText, usePublicPricing } from "../lib/public-pricing";

/**
 * The public display of record for plans and credit rates. Every value comes
 * from GET /billing/plans — used by the FAQ, docs and billing terms.
 */
export function PricingAuthority({ className = "", showPlans = true }: { className?: string; showPlans?: boolean }) {
   const state = usePublicPricing();

   return (
      <section
         className={`rounded-xl border border-[#D6C4EE] bg-[#7F40E8]/5 p-5 ${className}`}
         aria-label="Current PurpleCallio plans and credit rates"
      >
         <p className="font-semibold text-[#170B2E]">Current plans and credit rates</p>
         <p className="mt-2 text-sm leading-6 text-[#3D3650]">
            <strong>PurpleCallio uses simple prepaid plans with included usage credits.</strong> Usage is measured in
            participant-minutes and each media type — audio, video and screen sharing — consumes credits at its own
            rate. Screen sharing is its own category, not a surcharge on video.
         </p>

         {state.status === "ready" ? (
            <>
               <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                     <thead className="border-b border-[#D6C4EE] text-xs uppercase tracking-wider text-[#3D3650]">
                        <tr>
                           <th className="pb-2 pr-4">Usage category</th>
                           <th className="pb-2">Credits per participant-minute</th>
                        </tr>
                     </thead>
                     <tbody className="text-[#3D3650]">
                        {[
                           ["Audio", state.data.creditRates.audioCreditsPerMinute],
                           ["Video", state.data.creditRates.videoCreditsPerMinute],
                           ["Screen sharing", state.data.creditRates.screenShareCreditsPerMinute],
                        ].map(([label, rate]) => (
                           <tr key={label} className="border-b border-[#E7DFF5] last:border-0">
                              <th className="py-3 pr-4 font-medium text-[#170B2E]">{label}</th>
                              <td className="py-3">{formatRate(rate as number)}</td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>

               {showPlans && state.data.plans.length > 0 && (
                  <ul className="mt-5 space-y-1 text-sm text-[#3D3650]">
                     {sortPlans(state.data.plans).map((p) => {
                        const price = planPrice(p);
                        return (
                           <li key={p.id}>
                              <strong className="text-[#170B2E]">{p.name}:</strong> {price.amount}
                              {price.suffix ? ` ${price.suffix}` : ""}
                              {p.version && !p.customPricing
                                 ? ` · ${formatCredits(p.version.includedCredits)} credits per ${intervalLabel(p.version)}`
                                 : ""}
                           </li>
                        );
                     })}
                  </ul>
               )}

               <div className="mt-5 space-y-2 text-sm leading-6 text-[#3D3650]">
                  <p>
                     <strong>Example:</strong> 2 participants in a 10-minute video call use 20 video participant-minutes ={" "}
                     {formatRate(20 * state.data.creditRates.videoCreditsPerMinute)} credits.
                  </p>
                  <p>
                     <strong>Screen sharing:</strong> 1 participant sharing for 10 minutes uses 10 screen-share
                     participant-minutes = {formatRate(10 * state.data.creditRates.screenShareCreditsPerMinute)} credits,
                     independently of video usage.
                  </p>
                  <p>
                     {gstNote(state.data.creditRates)} {topUpExpiryText(state.data.creditRates)}
                  </p>
                  <p>
                     <Link href="/pricing" className="font-medium text-[#6425C4] hover:text-[#170B2E]">
                        See full plan details →
                     </Link>
                  </p>
               </div>
            </>
         ) : state.status === "error" ? (
            <p className="mt-4 text-sm text-[#3D3650]">
               Current plans and credit rates are temporarily unavailable.{" "}
               <button type="button" onClick={state.retry} className="font-medium text-[#6425C4] underline">
                  Retry
               </button>
            </p>
         ) : (
            <p role="status" className="mt-4 text-sm text-[#3D3650]">
               Loading current plans and credit rates…
            </p>
         )}
      </section>
   );
}
