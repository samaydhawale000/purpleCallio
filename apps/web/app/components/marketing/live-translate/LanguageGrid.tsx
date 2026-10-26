"use client";

import { useEffect, useState } from "react";
import { FALLBACK_LANGUAGES, type TranslationLanguage } from "../../../lib/live-translate";
import { fetchTranslationLanguages } from "../../../lib/live-translate-api";

function Badge({ on, label }: { on: boolean | null; label: string }) {
   if (on === null) {
      return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">{label}: validating</span>;
   }
   return on ? (
      <span className="rounded-full bg-[#7F40E8]/10 px-2 py-0.5 text-[10px] font-semibold text-[#6425C4]">{label}</span>
   ) : (
      <span className="rounded-full bg-[#F3F1F6] px-2 py-0.5 text-[10px] text-[#3D3650]/70 line-through">{label}</span>
   );
}

/**
 * Languages with separate voice and captions badges, from
 * GET /translation/languages. The static Soniox list is shown first (server
 * render) and whenever the API isn't available.
 */
export function LanguageGrid() {
   const [live, setLive] = useState<TranslationLanguage[] | null>(null);
   useEffect(() => {
      let active = true;
      fetchTranslationLanguages().then((l) => active && setLive(l));
      return () => {
         active = false;
      };
   }, []);
   const languages = live ?? FALLBACK_LANGUAGES;

   return (
      <div data-testid="language-grid">
         <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {languages.map((l) => (
               <li key={l.code} className="rounded-xl border border-[#E7DFF5] bg-white p-3">
                  <p className="text-base font-semibold text-[#170B2E]" lang={l.code} dir={l.rtl ? "rtl" : undefined}>
                     {l.nativeName}
                  </p>
                  <p className="text-xs text-[#3D3650]">{l.name}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                     <Badge on={l.voice} label="Voice" />
                     <Badge on={l.captions} label="Captions" />
                  </div>
               </li>
            ))}
         </ul>
         <p className="mt-4 text-xs text-[#3D3650]">
            Every language supports captions and voice, and any language can be translated into any other.
         </p>
      </div>
   );
}
