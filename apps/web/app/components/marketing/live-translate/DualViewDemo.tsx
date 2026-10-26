"use client";

import type React from "react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
   Captions,
   Check,
   Hand,
   Headphones,
   Languages,
   Mic,
   PhoneOff,
   RotateCcw,
   ShieldAlert,
   Video,
   Volume1,
} from "lucide-react";
import ashaPortrait from "../../../assets/images/live-translate-asha.webp";
import danielPortrait from "../../../assets/images/live-translate-daniel.webp";

/**
 * Animated in-call mock of Live Translate, as Daniel (English) sees it while
 * Asha speaks Marathi: DualView captions over her video, a MeaningGuard alert
 * when an amount changes, and Daniel asking her to repeat it.
 *
 * Pure DOM with CSS animations. Server render and reduced-motion users get the finished state, with no
 * looping animation. The loop only runs while the demo is on screen.
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
 *  phrase i original  → step 2i + 1, translated → step 2i + 2
 *  MeaningGuard alert → step 7 (after phrase 2 is translated)
 *  "Ask to repeat"    → step 8
 *  phrase 3 original  → step 9, translated → step 10
 */
const FLAG_STEP = 7;
const TAP_STEP = 8;
const LAST_STEP = 10;
const STEP_MS = 1300;
const HOLD_STEPS = 4; // pause on the finished state before looping

function stateAt(step: number) {
   const starts = PHRASES.map((_, i) => (i < 3 ? 2 * i + 1 : 9));
   let current = 0;
   starts.forEach((start, i) => {
      if (step >= start) current = i;
   });
   return {
      current,
      translated: step >= starts[current] + 1,
      flag: step >= FLAG_STEP && step < 9,
      tapped: step >= TAP_STEP,
   };
}

export function DualViewDemo({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
   const reduce = useReducedMotion();
   const ref = useRef<HTMLDivElement>(null);
   const [step, setStep] = useState(LAST_STEP); // SSR / no-JS: the finished state
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
   const { current, translated, flag, tapped } = stateAt(effective);
   const phrase = PHRASES[current];
   const speaking = effective > 0 && !translated;

   return (
      <div
         ref={ref}
         className={`@container min-w-0 ${className}`}
         role="img"
         aria-label="Example translated call as the listener sees it: Asha speaks Marathi and Daniel reads and hears English. MeaningGuard flags an amount that may not match, and Daniel asks Asha to repeat it."
         data-testid="dualview-demo"
      >
         <div
            aria-hidden="true"
            className={`overflow-hidden rounded-[22px] bg-[#130A24] p-[2cqw] text-white ${
               dark
                  ? "ring-1 ring-white/20 shadow-[0_40px_80px_-30px_rgba(0,0,0,.6)]"
                  : "ring-1 ring-[#E7DFF5] shadow-[0_40px_80px_-35px_rgba(65,6,134,.55)]"
            }`}
         >
            {/* Top bar */}
            <div className="mb-[2cqw] flex items-center justify-between gap-2 px-[0.6cqw] text-[max(10px,2.1cqw)]">
               <span className="flex min-w-0 items-center gap-[1.4cqw]">
                  <span className="h-[1.6cqw] min-h-1.5 w-[1.6cqw] min-w-1.5 animate-pulse rounded-full bg-emerald-400 motion-reduce:animate-none" />
                  <span className="truncate font-semibold">Order support</span>
                  <span className="font-mono text-white/50">04:12</span>
               </span>
               <span className="flex shrink-0 items-center gap-[1.2cqw]">
                  <span className="inline-flex items-center gap-[0.8cqw] rounded-full bg-white/10 px-[1.8cqw] py-[0.6cqw]">
                     <Languages className="h-[2.4cqw] min-h-3 w-[2.4cqw] min-w-3 text-[#C4A3FF]" />
                     <span lang="mr">मराठी</span> → English
                  </span>
                  <span className="rounded-full bg-[#7F40E8] px-[1.8cqw] py-[0.6cqw] font-semibold">Voice</span>
               </span>
            </div>

            {/* Stage: both participants */}
            <div className="grid grid-cols-2 gap-[1.6cqw]">
               <Tile
                  portrait={ashaPortrait}
                  name="Asha"
                  language={<span lang="mr">मराठी</span>}
                  status={speaking ? "Speaking" : "Live"}
                  active={speaking}
               />
               <div className="relative">
                  <Tile
                     portrait={danielPortrait}
                     name="Daniel (you)"
                     language="English"
                     status={translated ? "Hearing English" : "Listening"}
                     active={translated && !flag}
                     listener
                  />
                  {/* MeaningGuard alert, shown to the listener */}
                  {flag && (
                     <div className="lt-pop absolute inset-x-[5%] bottom-[5%] rounded-[12px] bg-white p-[1.8cqw] text-[#170B2E] shadow-[0_20px_40px_-15px_rgba(0,0,0,.6)]">
                        <p className="flex items-center gap-[0.8cqw] text-[max(9px,1.8cqw)] font-bold text-amber-700">
                           <ShieldAlert className="h-[2.4cqw] min-h-3 w-[2.4cqw] min-w-3" /> MeaningGuard
                        </p>
                        <p className="mt-[0.6cqw] text-[max(9px,1.8cqw)] font-semibold leading-snug">This amount may not match what Asha said.</p>
                        <div className="mt-[1.2cqw] flex flex-wrap items-center gap-[1cqw]">
                           <span
                              className={`inline-flex items-center gap-[0.6cqw] rounded-full px-[1.6cqw] py-[0.6cqw] text-[max(8px,1.65cqw)] font-semibold text-white transition-colors ${
                                 tapped ? "bg-emerald-500" : "bg-[#7F40E8]"
                              }`}
                           >
                              {tapped ? <Check className="h-[1.9cqw] min-h-2.5 w-[1.9cqw] min-w-2.5" /> : <Hand className="h-[1.9cqw] min-h-2.5 w-[1.9cqw] min-w-2.5" />}
                              {tapped ? "Repeat requested" : "Ask to repeat"}
                           </span>
                           <span className="hidden items-center gap-[0.5cqw] text-[max(8px,1.5cqw)] text-[#3D3650] @[420px]:inline-flex">
                              <RotateCcw className="h-[1.7cqw] min-h-2.5 w-[1.7cqw] min-w-2.5" /> Replay
                           </span>
                        </div>
                     </div>
                  )}
               </div>
            </div>

            {/* DualView captions */}
            <div
               key={current}
               className={`lt-fade-up mt-[1.6cqw] rounded-[14px] bg-white/[0.07] px-[2.4cqw] py-[1.8cqw] ${
                  phrase.flagged && flag ? "ring-2 ring-amber-400" : phrase.repeat ? "ring-1 ring-emerald-400/80" : "ring-1 ring-white/10"
               }`}
            >
               <div className="flex items-start gap-[2cqw]">
                  <span className="mt-[0.3cqw] shrink-0 rounded-md bg-white/10 px-[1cqw] py-[0.3cqw] text-[max(8px,1.5cqw)] font-semibold uppercase tracking-wider text-white/60">
                     Original
                  </span>
                  <p className="text-[max(10px,1.95cqw)] leading-snug text-white/70" lang="mr">
                     {phrase.original}
                  </p>
               </div>
               <div className="mt-[1cqw] flex items-start gap-[2cqw]">
                  <span className="mt-[0.4cqw] shrink-0 rounded-md bg-[#7F40E8] px-[1cqw] py-[0.3cqw] text-[max(8px,1.5cqw)] font-semibold uppercase tracking-wider">
                     English
                  </span>
                  <p
                     className={`min-h-[1.4em] text-[max(11px,2.5cqw)] font-semibold leading-snug transition-opacity duration-300 ${translated ? "opacity-100" : "opacity-0"}`}
                     lang="en"
                  >
                     {phrase.translated}
                     {phrase.flagged && flag && (
                        <span className="ml-[1cqw] inline-flex -translate-y-px items-center rounded-full bg-amber-400 px-[1.2cqw] text-[max(8px,1.55cqw)] font-bold text-amber-950">
                           may not be accurate
                        </span>
                     )}
                     {phrase.repeat && translated && (
                        <span className="ml-[1cqw] inline-flex -translate-y-px items-center gap-[0.4cqw] rounded-full bg-emerald-500 px-[1.2cqw] text-[max(8px,1.55cqw)] font-bold">
                           <Check className="h-[1.7cqw] min-h-2.5 w-[1.7cqw] min-w-2.5" /> repeated
                        </span>
                     )}
                  </p>
               </div>
            </div>

            {/* Call controls */}
            <div className="mt-[2cqw] flex items-center justify-between gap-[1.6cqw] px-[0.6cqw]">
               <span className="flex items-center gap-[1cqw] text-[max(9px,1.8cqw)] text-white/70">
                  <Volume1 className="h-[2.6cqw] min-h-3 w-[2.6cqw] min-w-3" />
                  <span className="hidden @[380px]:inline">Original voice</span> 20%
                  <span className="h-[0.9cqw] min-h-1 w-[10cqw] overflow-hidden rounded-full bg-white/15">
                     <span className="block h-full w-1/5 rounded-full bg-[#C4A3FF]" />
                  </span>
               </span>
               <span className="flex items-center gap-[1.2cqw]">
                  <Control icon={Mic} />
                  <Control icon={Video} />
                  <Control icon={Captions} active />
                  <Control icon={Languages} active />
                  <Control icon={PhoneOff} danger />
               </span>
            </div>
         </div>
      </div>
   );
}

function Control({ icon: Icon, active, danger }: { icon: typeof Mic; active?: boolean; danger?: boolean }) {
   return (
      <span
         className={`grid h-[6.4cqw] min-h-7 w-[6.4cqw] min-w-7 place-items-center rounded-full ${
            danger ? "bg-red-500" : active ? "bg-[#7F40E8]" : "bg-white/10"
         }`}
      >
         <Icon className="h-[2.8cqw] min-h-3.5 w-[2.8cqw] min-w-3.5" />
      </span>
   );
}

function Tile({
   portrait,
   name,
   language,
   status,
   active,
   listener,
}: {
   portrait: typeof ashaPortrait;
   name: string;
   language: React.ReactNode;
   status: string;
   active: boolean;
   listener?: boolean;
}) {
   return (
      <div className={`relative aspect-[4/5] overflow-hidden rounded-[14px] bg-[#2A1650] transition-shadow duration-300 ${active ? "ring-2 ring-[#A76AFF]" : "ring-1 ring-white/10"}`}>
         <Image src={portrait} alt="" fill sizes="(max-width: 1024px) 45vw, 280px" className="object-cover" />
         <div className="absolute inset-0 bg-gradient-to-t from-[#0B0517]/75 via-transparent to-transparent" />
         <span className="absolute left-[5%] top-[5%] inline-flex items-center gap-[0.8cqw] rounded-full bg-black/45 px-[1.4cqw] py-[0.6cqw] text-[max(9px,1.7cqw)] font-semibold backdrop-blur">
            {listener ? <Headphones className="h-[1.9cqw] min-h-2.5 w-[1.9cqw] min-w-2.5" /> : <Mic className="h-[1.9cqw] min-h-2.5 w-[1.9cqw] min-w-2.5" />}
            {language}
         </span>
         <div className="absolute inset-x-[5%] bottom-[5%] flex items-center justify-between gap-[1cqw]">
            <span className="min-w-0 leading-tight">
               <span className="block truncate text-[max(10px,2cqw)] font-semibold">{name}</span>
               <span className="block truncate text-[max(8px,1.55cqw)] text-white/65">{status}</span>
            </span>
            <span className="flex h-[2.6cqw] shrink-0 items-center gap-[0.4cqw]">
               {[50, 90, 60, 100, 40].map((h, i) => (
                  <span
                     key={i}
                     className={`w-[0.5cqw] min-w-[2px] rounded-full ${listener ? "bg-[#C4A3FF]" : "bg-emerald-400"} ${active ? "translation-wave" : "opacity-30"}`}
                     style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }}
                  />
               ))}
            </span>
         </div>
      </div>
   );
}
