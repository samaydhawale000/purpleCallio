"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { Check, Hand, RotateCcw, TriangleAlert, Volume2 } from "lucide-react";

/**
 * Animated DualView mock: a Marathi speaker and an English listener. Lines
 * appear original-first, the translation fills in, one amount gets a
 * MeaningGuard flag, and the listener taps "Ask to repeat".
 *
 * Pure DOM + framer-motion `m` components (MotionProvider in the root layout).
 * Server render and reduced-motion users get the finished conversation, with
 * no looping animation. The loop only runs while the demo is on screen.
 */

interface Phrase {
   original: string;
   translated: string;
   flagged?: boolean;
   repeat?: boolean;
}

const PHRASES: Phrase[] = [
   { original: "नमस्कार, मी तुमच्या ऑर्डरबद्दल बोलतेय.", translated: "Hello, I'm calling about your order." },
   { original: "डिलिव्हरी उद्या संध्याकाळी सहा वाजता येईल.", translated: "The delivery will arrive tomorrow at 6 pm." },
   { original: "एकूण रक्कम दोन हजार चारशे पन्नास रुपये आहे.", translated: "The total amount is ₹2,540.", flagged: true },
   { original: "दोन हजार चारशे पन्नास. ₹2,450.", translated: "Two thousand four hundred and fifty. ₹2,450.", repeat: true },
];

/*
 * Timeline steps:
 *  phrase i original  → step 2i + 1
 *  phrase i translated → step 2i + 2
 *  flag shown         → after phrase 2 translated (step 6) → step 7
 *  "Ask to repeat"    → step 8 (repeat requested)
 *  phrase 3 original  → step 9, translated → step 10
 */
const FLAG_STEP = 7;
const TAP_STEP = 8;
const LAST_STEP = 10;
const STEP_MS = 1300;
const HOLD_STEPS = 4; // pause on the finished conversation before looping

function visibleState(step: number) {
   const shown = PHRASES.map((p, i) => {
      const base = i < 3 ? 2 * i + 1 : 9;
      return { original: step >= base, translated: step >= base + 1 };
   });
   return { shown, flag: step >= FLAG_STEP, tapped: step >= TAP_STEP };
}

export function DualViewDemo({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
   const reduce = useReducedMotion();
   const ref = useRef<HTMLDivElement>(null);
   const [step, setStep] = useState(LAST_STEP); // SSR / no-JS: the finished conversation
   const [visible, setVisible] = useState(false);

   useEffect(() => {
      const el = ref.current;
      if (!el || typeof IntersectionObserver === "undefined") {
         setVisible(true);
         return;
      }
      const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
      io.observe(el);
      return () => io.disconnect();
   }, []);

   useEffect(() => {
      if (reduce || !visible) return;
      const id = window.setInterval(() => {
         setStep((s) => (s >= LAST_STEP + HOLD_STEPS ? 0 : s + 1));
      }, STEP_MS);
      return () => window.clearInterval(id);
   }, [reduce, visible]);

   const effective = reduce ? LAST_STEP : Math.min(step, LAST_STEP);
   const { shown, flag, tapped } = visibleState(effective);

   const shell = dark
      ? "bg-white/10 ring-1 ring-white/20 text-white backdrop-blur"
      : "bg-white ring-1 ring-[#E7DFF5] text-[#170B2E] shadow-[0_30px_60px_-30px_rgba(65,6,134,0.35)]";
   const muted = dark ? "text-white/65" : "text-[#3D3650]/80";
   const bubble = dark ? "bg-white/10" : "bg-[#F8F4FD]";

   return (
      <div
         ref={ref}
         className={`min-w-0 rounded-2xl p-5 ${shell} ${className}`}
         role="img"
         aria-label="Example DualView translated call: a Marathi speaker and an English listener. The amount in one phrase is flagged 'May not be accurate — check', and the listener asks the speaker to repeat it."
         data-testid="dualview-demo"
      >
         <div className={`mb-4 flex flex-wrap items-center justify-between gap-2 text-xs ${muted}`} aria-hidden="true">
            <span className="inline-flex items-center gap-2">
               <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 motion-reduce:animate-none" />
               Translated call · Voice
            </span>
            <span className="font-mono">Asha speaks मराठी → Daniel hears English</span>
         </div>

         <ul className="space-y-3" aria-hidden="true">
            {PHRASES.map((p, i) => {
               const s = shown[i];
               if (!s.original) return null;
               const isFlagged = p.flagged && flag;
               return (
                  <m.li
                     key={i}
                     initial={reduce ? false : { opacity: 0, y: 8 }}
                     animate={{ opacity: 1, y: 0 }}
                     transition={{ duration: 0.35 }}
                     className={`rounded-xl px-4 py-3 ${bubble} ${
                        isFlagged ? "ring-2 ring-amber-400" : p.repeat ? "ring-1 ring-emerald-400/70" : ""
                     }`}
                  >
                     <p className={`text-[13px] leading-relaxed ${muted}`} lang="mr">
                        {p.original}
                     </p>
                     <AnimatePresence initial={false}>
                        {s.translated && (
                           <m.p
                              key="t"
                              initial={reduce ? false : { opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ duration: 0.4 }}
                              className="mt-1 text-sm font-semibold leading-relaxed"
                              lang="en"
                           >
                              {p.translated}
                           </m.p>
                        )}
                     </AnimatePresence>
                     {isFlagged && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                           <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                              <TriangleAlert size={12} /> May not be accurate — check
                           </span>
                           <span className={`text-[11px] ${muted}`}>amount changed</span>
                           <span
                              className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                 tapped
                                    ? "bg-emerald-500 text-white"
                                    : dark
                                      ? "bg-white text-[#5B1BB5]"
                                      : "bg-[#7F40E8] text-white"
                              }`}
                           >
                              {tapped ? <Check size={12} /> : <Hand size={12} />}
                              {tapped ? "Repeat requested" : "Ask to repeat"}
                           </span>
                        </div>
                     )}
                     {isFlagged && (
                        <p className={`mt-2 inline-flex items-center gap-1 text-[10px] ${muted}`}>
                           <RotateCcw size={11} /> Replay original · optional setting, off by default
                        </p>
                     )}
                     {p.repeat && (
                        <p className="mt-1 text-[11px] font-medium text-emerald-500">Repeated after Daniel asked</p>
                     )}
                  </m.li>
               );
            })}
         </ul>

         <div className={`mt-4 flex items-center gap-2 text-[11px] ${muted}`} aria-hidden="true">
            <Volume2 size={13} />
            Original voice ducked to 20%
            <span className={`ml-auto h-1.5 w-24 overflow-hidden rounded-full ${dark ? "bg-white/15" : "bg-[#E7DFF5]"}`}>
               <span className={`block h-full w-1/5 rounded-full ${dark ? "bg-white/70" : "bg-[#7F40E8]"}`} />
            </span>
         </div>
      </div>
   );
}
