"use client";

import Link from "next/link";
import { formatCredits } from "../lib/billing";
import { formatRate, gstNote, purchaseExpiryText, usePublicPricing, usePublishedCreditPricing } from "../lib/public-pricing";

/**
 * The public display of record for credit prices and usage rates. Every value comes
 * from GET /billing/plans — used by the FAQ, docs and billing terms.
 */
export function PricingAuthority({ className = "" }: { className?: string; showPlans?: boolean }) {
   const state = usePublicPricing();
   const creditPrice = usePublishedCreditPricing();

   return (
      <section
         className={`rounded-xl border border-[#D6C4EE] bg-[#7F40E8]/5 p-5 ${className}`}
         aria-label="Current PurpleCallio credit pricing and usage rates"
      >
         <p className="font-semibold text-[#170B2E]">Prepaid credit pricing</p>
         <p className="mt-2 text-sm leading-6 text-[#3D3650]">
            <strong>PurpleCallio uses prepaid credits with no recurring subscription plan.</strong> Usage is measured in
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
                        {state.data.creditRates.aiCreditsPerMinute != null && (
                           <tr className="border-b border-[#E7DFF5] last:border-0">
                              <th className="py-3 pr-4 font-medium text-[#170B2E]">AI voice</th>
                              <td className="py-3">
                                 {formatRate(state.data.creditRates.aiCreditsPerMinute)} per call minute (after first credit purchase)
                              </td>
                           </tr>
                        )}
                     </tbody>
                  </table>
               </div>

               {creditPrice.status === "ready" && creditPrice.data && (
                  <p className="mt-5 text-sm text-[#3D3650]">Current published price: <strong>{(creditPrice.data.creditPricePaise / 100).toLocaleString("en-IN", { style: "currency", currency: creditPrice.data.currency })} per credit</strong>. Minimum purchase: {(creditPrice.data.minimumPurchasePaise / 100).toLocaleString("en-IN", { style: "currency", currency: creditPrice.data.currency })}.</p>
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
                     {gstNote(state.data.creditRates)} {creditPrice.status === "ready" ? purchaseExpiryText(creditPrice.data) : ""}
                  </p>
                  <p>
                     <Link href="/pricing" className="font-medium text-[#6425C4] hover:text-[#170B2E]">
                        See prepaid credit pricing →
                     </Link>
                  </p>
               </div>
            </>
         ) : state.status === "error" ? (
            <p className="mt-4 text-sm text-[#3D3650]">
               Current credit rates are temporarily unavailable.{" "}
               <button type="button" onClick={state.retry} className="font-medium text-[#6425C4] underline">
                  Retry
               </button>
            </p>
         ) : (
            <p role="status" className="mt-4 text-sm text-[#3D3650]">
               Loading current credit rates…
            </p>
         )}
      </section>
   );
}
