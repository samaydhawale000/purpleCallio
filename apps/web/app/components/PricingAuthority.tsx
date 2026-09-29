"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatPaise, type BillingRates } from "../lib/pricing";

/** The public display of record for rates. Values always come from GET /billing/rates. */
export function PricingAuthority({ className = "" }: { className?: string }) {
   const [rates, setRates] = useState<BillingRates | null>(null);
   const [unavailable, setUnavailable] = useState(false);

   useEffect(() => {
      let active = true;
      api.get<BillingRates>("/billing/rates")
         .then(({ data }) => {
            if (active) setRates(data);
         })
         .catch(() => {
            if (active) setUnavailable(true);
         });
      return () => {
         active = false;
      };
   }, []);

   return (
      <section
         className={`rounded-xl border border-[#D6C4EE] bg-[#7F40E8]/5 p-5 ${className}`}
         aria-label="Current PurpleCallio pricing"
      >
         <p className="font-semibold text-[#170B2E]">Authoritative pricing</p>
         <p className="mt-2 text-sm leading-6 text-[#3D3650]">
            <strong>PurpleCallio uses participant-minute billing.</strong> Audio,
            video, and screen sharing are tracked separately. Screen sharing is
            billed as its own usage category and is not automatically added as a
            surcharge to video minutes.
         </p>
         {rates ? <><div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[500px] text-left text-sm">
                     <thead className="border-b border-[#D6C4EE] text-xs uppercase tracking-wider text-[#3D3650]">
                        <tr>
                           <th className="pb-2 pr-4">Usage category</th>
                           <th className="pb-2 pr-4">Current rate</th>
                           <th className="pb-2">Free allowance</th>
                        </tr>
                     </thead>
                     <tbody className="text-[#3D3650]">
                        <tr className="border-b border-[#E7DFF5]">
                           <th className="py-3 pr-4 font-medium text-[#170B2E]">
                              Audio
                           </th>
                           <td className="py-3 pr-4">
                              {formatPaise(rates.audioPaise)} / participant-minute
                           </td>
                           <td className="py-3">
                              First {rates.freeAudioMins} participant-minutes
                              each month
                           </td>
                        </tr>
                        <tr className="border-b border-[#E7DFF5]">
                           <th className="py-3 pr-4 font-medium text-[#170B2E]">
                              Video
                           </th>
                           <td className="py-3 pr-4">
                              {formatPaise(rates.videoPaise)} / participant-minute
                           </td>
                           <td className="py-3">
                              First {rates.freeVideoMins} participant-minutes
                              each month
                           </td>
                        </tr>
                        <tr>
                           <th className="py-3 pr-4 font-medium text-[#170B2E]">
                              Screen sharing
                           </th>
                           <td className="py-3 pr-4">
                              {formatPaise(rates.screenSharePaise)} /
                              participant-minute
                           </td>
                           <td className="py-3">No free allowance</td>
                        </tr>
                     </tbody>
                  </table>
         </div>
         <div className="mt-5 space-y-2 text-sm leading-6 text-[#3D3650]">
                  <p>
                     <strong className="text-[#3D3650]">Example:</strong> 2
                     participants in a 10-minute video call use 20 video
                     participant-minutes.
                  </p>
                  <p>
                     <strong className="text-[#3D3650]">
                        Separate screen-sharing example:
                     </strong>{" "}
                     1 participant sharing for 10 minutes uses 10 screen-sharing
                     participant-minutes, independently of video usage.
                  </p>
                  <p>GST of {rates.taxPercent}% applies to billable usage.</p>
         </div></> : <p className="mt-4 text-sm text-[#3D3650]">{unavailable ? "Current rates are temporarily unavailable. Please check back before relying on pricing." : "Loading current rates…"}</p>}
      </section>
   );
}
