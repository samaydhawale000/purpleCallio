import Link from "next/link";
import { ArrowRight, Languages } from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "../../motion/Reveal";
import { DualViewDemo } from "./DualViewDemo";
import {
   FEATURE_THEMES,
   LIVE_TRANSLATE_FEATURES,
   LIVE_TRANSLATE_PATH,
   LIVE_TRANSLATE_SIGNUP,
   LIVE_TRANSLATE_STATUS,
} from "../../../lib/live-translate";

/** Homepage: "Live Translate: talk to anyone, in their language" (early access). */
export function LiveTranslateSection() {
   return (
      <section id="live-translate" className="section-base px-6 py-24" aria-labelledby="live-translate-title">
         <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
               <Reveal variant="left" className="min-w-0">
                  <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
                     <Languages size={14} aria-hidden="true" /> {LIVE_TRANSLATE_STATUS}
                  </p>
                  <h2 id="live-translate-title" className="lp-h2 font-bold leading-tight text-[#170B2E]">
                     Live Translate: talk to anyone, in their language
                  </h2>
                  <p className="mt-4 max-w-xl leading-relaxed text-[#3D3650]">
                     Two people on a 1:1 call speak different languages, and each hears and reads the other in their
                     own, a short moment behind the speaker. Built so possible misunderstandings get flagged, costs
                     stay inside your limits and quality is measurable. 60 languages, from English, Spanish and
                     Arabic to Hindi, Japanese and more.
                  </p>
                  <div className="mt-8 flex flex-wrap gap-3">
                     <Link
                        href={LIVE_TRANSLATE_PATH}
                        className="btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                     >
                        Explore Live Translate <ArrowRight size={16} aria-hidden="true" />
                     </Link>
                     <Link
                        href={LIVE_TRANSLATE_SIGNUP}
                        className="rounded-xl border border-[#E7DFF5] px-5 py-3 text-sm font-semibold text-[#170B2E] hover:border-[#D6C4EE]"
                     >
                        Join early access
                     </Link>
                  </div>
               </Reveal>
               <Reveal variant="right" delay={0.1} className="min-w-0">
                  <DualViewDemo />
               </Reveal>
            </div>

            <div className="mt-16 grid grid-cols-1 gap-8 lg:grid-cols-3">
               {FEATURE_THEMES.map((t) => (
                  <div key={t.theme} className="min-w-0">
                     <Reveal>
                        <p className="section-label font-mono text-xs uppercase tracking-widest">{t.title}</p>
                        <p className="mt-1 text-sm text-[#3D3650]">{t.body}</p>
                     </Reveal>
                     <RevealGroup stagger={0.1} className="mt-4 space-y-4">
                        {LIVE_TRANSLATE_FEATURES.filter((f) => f.theme === t.theme).map((f) => (
                           <RevealItem key={f.id} variant="up">
                              <Link
                                 href={`${LIVE_TRANSLATE_PATH}#${f.id}`}
                                 className="group block rounded-2xl border border-[#E7DFF5] bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-[#D6C4EE] hover:shadow-[0_20px_45px_-24px_rgba(65,6,134,0.3)]"
                                 data-testid={`lt-card-${f.id}`}
                              >
                                 <div className="flex items-start gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#7F40E8]/10 text-[#7F40E8]">
                                       <f.icon size={20} aria-hidden="true" />
                                    </span>
                                    <div className="min-w-0">
                                       <h3 className="font-bold text-[#170B2E]">{f.brand}</h3>
                                       <p className="text-xs text-[#6425C4]">{f.description}</p>
                                    </div>
                                 </div>
                                 <p className="mt-3 text-sm font-medium text-[#170B2E]">{f.promise}</p>
                                 <p className="mt-1 text-sm leading-relaxed text-[#3D3650]">{f.why}</p>
                              </Link>
                           </RevealItem>
                        ))}
                     </RevealGroup>
                  </div>
               ))}
            </div>
         </div>
      </section>
   );
}
