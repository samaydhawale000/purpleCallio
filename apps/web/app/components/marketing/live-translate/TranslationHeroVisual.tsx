"use client";

import Image from "next/image";
import { Code2, Languages, Mic, Sparkles, Video, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import nehaPortrait from "../../../assets/images/live-translate-asha.webp";
import pierrePortrait from "../../../assets/images/live-translate-daniel.webp";
import indiaFlag from "../../../assets/images/flag-india.webp";
import franceFlag from "../../../assets/images/flag-france.webp";

const CONVERSATIONS = [
   { english: "Can you help me with my order?", french: "Pouvez-vous m’aider avec ma commande ?" },
   { english: "When will it arrive?", french: "Quand va-t-il arriver ?" },
   { english: "I need it by the end of this week.", french: "J’en ai besoin avant la fin de la semaine." },
   { english: "Thank you for your help!", french: "Merci pour votre aide !" },
];

/** Floating capability chips around the globe (position in % of the visual). */
const CHIPS: { label: string; icon: LucideIcon; className: string; tone: string }[] = [
   { label: "Voice & Video", icon: Video, className: "left-[22%] top-[1%]", tone: "from-[#7F40E8] to-[#4F46E5]" },
   { label: "AI Voice Agents", icon: Sparkles, className: "right-[3%] top-[6%]", tone: "from-[#A05DF9] to-[#6425C4]" },
   { label: "Live Translate", icon: Languages, className: "left-[18%] bottom-[2%]", tone: "from-[#A05DF9] to-[#7F40E8]" },
   { label: "Developer APIs", icon: Code2, className: "right-[6%] bottom-[2%]", tone: "from-[#4F46E5] to-[#6366F1]" },
];

/** Illustrative only: this never opens media devices or starts a call. */
export function TranslationHeroVisual() {
   const [index, setIndex] = useState(0);
   const [phase, setPhase] = useState<"speaking" | "translated">("speaking");
   const line = CONVERSATIONS[index];

   useEffect(() => {
      const translated = window.setTimeout(() => setPhase("translated"), 1600);
      const next = window.setTimeout(() => {
         setIndex((i) => (i + 1) % CONVERSATIONS.length);
         setPhase("speaking");
      }, 4200);
      return () => {
         window.clearTimeout(translated);
         window.clearTimeout(next);
      };
   }, [index]);

   return (
      <div
         className="hero-globe @container relative mx-auto aspect-[1.12] w-full max-w-[640px]"
         role="img"
         aria-label="Neha speaks English and Pierre hears it in French, translated in real time"
      >
         {/* Globe */}
         <div aria-hidden="true" className="absolute left-[14%] top-[8%] aspect-square w-[72%] rounded-full bg-[radial-gradient(circle_at_40%_35%,rgba(255,255,255,.95),rgba(233,221,255,.85)_45%,rgba(205,180,255,.55)_75%,rgba(190,160,255,.25))] shadow-[inset_0_0_60px_rgba(255,255,255,.9),0_30px_80px_-40px_rgba(100,37,196,.55)]">
            <div className="hero-globe-dots absolute inset-[4%] rounded-full" />
            <div className="absolute inset-[3%] rounded-full border border-white/80" />
            <div className="absolute inset-x-[3%] top-[30%] h-[40%] rounded-[50%] border border-[#C9B2F5]/50" />
            <div className="absolute inset-y-[3%] left-[30%] w-[40%] rounded-[50%] border border-[#C9B2F5]/50" />
         </div>
         {/* Orbit rings */}
         <div aria-hidden="true" className="absolute left-[2%] top-[22%] h-[56%] w-[96%] rounded-[50%] border border-[#B487FA]/40" />
         <div aria-hidden="true" className="absolute left-[6%] top-[16%] h-[68%] w-[88%] rounded-[50%] border border-white/70" />

         {/* Floating orbs */}
         <span aria-hidden="true" className="hero-orb absolute left-[1%] top-[24%] h-[3.6%] w-[3.2%]" />
         <span aria-hidden="true" className="hero-orb absolute right-[14%] top-[0%] h-[3%] w-[2.7%] opacity-60" />
         <span aria-hidden="true" className="hero-orb absolute right-[-2%] top-[20%] h-[3.4%] w-[3%]" />
         <span aria-hidden="true" className="hero-orb absolute left-[3%] bottom-[16%] h-[2.2%] w-[2%]" />

         {/* Dashed connectors from chips to the cards */}
         <span aria-hidden="true" className="absolute left-[29%] top-[11%] h-[12%] border-l border-dashed border-[#B9A3E6]" />
         <span aria-hidden="true" className="absolute right-[17%] top-[16%] h-[10%] border-l border-dashed border-[#B9A3E6]" />
         <span aria-hidden="true" className="absolute left-[29%] bottom-[11%] h-[9%] border-l border-dashed border-[#B9A3E6]" />
         <span aria-hidden="true" className="absolute right-[19%] bottom-[11%] h-[9%] border-l border-dashed border-[#B9A3E6]" />

         {CHIPS.map(({ label, icon: Icon, className, tone }) => (
            <div key={label} className={`absolute z-20 flex items-center gap-[1.6cqw] rounded-full border border-white bg-white/90 py-[1cqw] pl-[1cqw] pr-[2.6cqw] shadow-[0_10px_30px_-14px_rgba(65,6,134,.45)] backdrop-blur ${className}`}>
               <span className={`grid h-[6.6cqw] w-[6.6cqw] place-items-center rounded-full bg-gradient-to-br text-white ${tone}`}>
                  <Icon className="h-[3.2cqw] w-[3.2cqw]" aria-hidden="true" />
               </span>
               <span className="whitespace-nowrap text-[max(9px,2.1cqw)] font-semibold text-[#2A1650]">{label}</span>
            </div>
         ))}

         <SpeakerCard
            className="left-[4%] top-[17%] -rotate-[4deg]"
            active={phase === "speaking"}
            name="Neha"
            country="India"
            language="English"
            flag={indiaFlag}
            portrait={nehaPortrait}
            text={line.english}
            flagSide="left"
         />
         <SpeakerCard
            className="right-[2%] top-[19%] rotate-[3deg]"
            active={phase === "translated"}
            name="Pierre"
            country="France"
            language="French"
            flag={franceFlag}
            portrait={pierrePortrait}
            text={phase === "translated" ? line.french : "…"}
            flagSide="right"
         />

         {/* Centre: mic, waves and direction arrows */}
         <div className="absolute left-1/2 top-[48%] z-10 flex w-[30%] -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            <svg aria-hidden="true" viewBox="0 0 200 60" className="absolute -top-[42%] w-[115%] overflow-visible">
               <defs>
                  <marker id="hero-arrow-purple" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8B5CF6" /></marker>
                  <marker id="hero-arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#60A5FA" /></marker>
               </defs>
               <path d="M35,28 C80,0 140,4 180,40" fill="none" stroke="#8B5CF6" strokeWidth="3" strokeLinecap="round" markerEnd="url(#hero-arrow-purple)" className="hero-arrow-path" />
            </svg>
            <div className="flex w-full items-center justify-center gap-[1.4cqw]">
               <Bars active={phase === "speaking"} />
               <span className={`relative grid h-[12cqw] w-[12cqw] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#A05DF9] to-[#5620C6] text-white shadow-[0_0_0_2cqw_rgba(167,106,255,.16),0_0_0_4cqw_rgba(167,106,255,.08),0_12px_30px_rgba(102,47,214,.45)] ${phase === "speaking" ? "translation-speaking" : ""}`}>
                  <Mic className="h-[5cqw] w-[5cqw]" aria-hidden="true" />
               </span>
               <Bars active={phase === "translated"} />
            </div>
            <svg aria-hidden="true" viewBox="0 0 200 60" className="absolute -bottom-[48%] w-[115%] overflow-visible">
               <path d="M175,10 C150,40 120,48 90,46" fill="none" stroke="#60A5FA" strokeWidth="3" strokeLinecap="round" markerEnd="url(#hero-arrow-blue)" className="hero-arrow-path" />
               <path d="M80,44 C55,40 35,30 22,14" fill="none" stroke="#8B5CF6" strokeWidth="3" strokeLinecap="round" markerEnd="url(#hero-arrow-purple)" className="hero-arrow-path" />
            </svg>
            <span className="mt-[5cqw] rounded-full border border-white bg-white/95 px-[2.4cqw] py-[1cqw] text-center leading-tight shadow-[0_8px_20px_-12px_rgba(65,6,134,.5)]">
               <span className="block text-[max(8px,1.7cqw)] font-medium text-[#6B35D3]">Real-time</span>
               <span className="block text-[max(9px,2.2cqw)] font-bold text-[#2A1650]">translation</span>
            </span>
         </div>
      </div>
   );
}

function SpeakerCard({
   className,
   active,
   name,
   country,
   language,
   flag,
   portrait,
   text,
   flagSide,
}: {
   className: string;
   active: boolean;
   name: string;
   country: string;
   language: string;
   flag: typeof indiaFlag;
   portrait: typeof nehaPortrait;
   text: string;
   flagSide: "left" | "right";
}) {
   return (
      <div className={`absolute z-10 w-[33%] transition-transform duration-500 ${active ? "scale-[1.03]" : ""} ${className}`}>
         {/* Speech bubble */}
         <div className={`relative z-10 rounded-[2.6cqw] border bg-white/95 p-[2cqw] shadow-[0_18px_40px_-22px_rgba(65,6,134,.55)] transition-colors duration-500 ${active ? "border-[#C4A3FF]" : "border-white"}`}>
            <div className="flex items-center gap-[1.4cqw]">
               <Image src={flag} alt="" className="h-[4.4cqw] w-[4.4cqw] rounded-full object-cover" />
               <div className="min-w-0 leading-tight">
                  <p className="truncate text-[max(8px,1.75cqw)] font-semibold text-[#2A1650]">{name} ({country})</p>
                  <p className="text-[max(7px,1.5cqw)] text-[#75658C]">{language}</p>
               </div>
            </div>
            <p className="mt-[1.4cqw] min-h-[2.6em] rounded-[1.6cqw] bg-[#F8F4FD] px-[1.6cqw] py-[1.2cqw] text-[max(8px,1.9cqw)] font-medium leading-snug text-[#2A1650]" lang={language === "French" ? "fr" : "en"}>
               {text}
            </p>
            <div className="mt-[1.2cqw] flex h-[3cqw] items-center justify-center gap-[0.5cqw]" aria-hidden="true">
               {[30, 55, 40, 80, 60, 95, 50, 75, 35, 65, 45, 25].map((h, i) => (
                  <span key={i} className={`w-[0.55cqw] rounded-full bg-[#A75BFF] ${active ? "translation-wave" : "opacity-40"}`} style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }} />
               ))}
            </div>
            <span aria-hidden="true" className={`absolute -bottom-[1.4cqw] h-[3cqw] w-[3cqw] rotate-45 border-b border-r bg-white ${flagSide === "left" ? "left-[40%]" : "right-[40%]"} ${active ? "border-[#C4A3FF]" : "border-white"}`} />
         </div>
         {/* Portrait */}
         <div className={`relative -mt-[1cqw] ml-[6%] w-[88%] overflow-hidden rounded-[3cqw] border-[0.6cqw] bg-white shadow-[0_24px_48px_-24px_rgba(65,6,134,.6)] transition-colors duration-500 ${active ? "border-[#C4A3FF]" : "border-white"}`}>
            <div className="relative aspect-[0.95] bg-[#EDE3FF]">
               <Image src={portrait} alt="" fill sizes="(max-width: 640px) 30vw, 200px" className="object-cover" priority />
            </div>
         </div>
         <Image
            src={flag}
            alt=""
            className={`absolute bottom-[2cqw] h-[6cqw] w-[6cqw] rounded-full border-[0.5cqw] border-white object-cover shadow-md ${flagSide === "left" ? "left-[10%]" : "right-[10%]"}`}
         />
      </div>
   );
}

function Bars({ active }: { active: boolean }) {
   return (
      <div className="flex h-[7cqw] flex-1 items-center justify-between" aria-hidden="true">
         {[35, 60, 45, 85, 55, 100, 40].map((h, i) => (
            <span key={i} className={`w-[0.8cqw] rounded-full bg-gradient-to-b from-[#A75BFF] to-[#6366F1] ${active ? "translation-wave" : "opacity-50"}`} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
         ))}
      </div>
   );
}
