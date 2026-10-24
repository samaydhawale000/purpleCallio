"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, ArrowRightLeft, AudioLines, Languages, Mic, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import ashaPortrait from "../../../assets/images/live-translate-asha.webp";
import danielPortrait from "../../../assets/images/live-translate-daniel.webp";
import indiaFlag from "../../../assets/images/flag-india.webp";
import franceFlag from "../../../assets/images/flag-france.webp";

const CONVERSATIONS = [
   { original: "नमस्कार, मैं अपने ऑर्डर के बारे में कॉल कर रही हूँ।", spoken: "Hello, I’m calling about my order.", translated: "Bonjour, je vous appelle au sujet de ma commande." },
   { original: "क्या आप बता सकते हैं कि यह कब आएगा?", spoken: "Could you tell me when it will arrive?", translated: "Pouvez-vous me dire quand il arrivera ?" },
   { original: "मुझे इसे इस सप्ताह के अंत तक चाहिए।", spoken: "I need it by the end of this week.", translated: "J’en ai besoin avant la fin de cette semaine." },
   { original: "आपकी मदद के लिए धन्यवाद।", spoken: "Thank you for your help.", translated: "Merci pour votre aide." },
];

/** Illustrative only: this never opens media devices or starts a call. */
export function TranslationHeroVisual() {
   const [messageIndex, setMessageIndex] = useState(0);
   const [speaker, setSpeaker] = useState<"asha" | "daniel">("asha");
   const message = CONVERSATIONS[messageIndex];

   useEffect(() => {
      const translate = window.setTimeout(() => setSpeaker("daniel"), 1800);
      const nextMessage = window.setTimeout(() => {
         setMessageIndex((current) => (current + 1) % CONVERSATIONS.length);
         setSpeaker("asha");
      }, 4300);
      return () => {
         window.clearTimeout(translate);
         window.clearTimeout(nextMessage);
      };
   }, [messageIndex]);

   return (
      <div className="translation-visual relative mx-auto w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/70 bg-[radial-gradient(circle_at_center,rgba(255,255,255,.96),rgba(231,215,255,.82)_48%,rgba(243,237,255,.6))] p-3 shadow-[0_28px_80px_-40px_rgba(72,22,154,.6)] sm:p-5" aria-label="A live Hindi to French conversation being translated in real time">
         <div className="pointer-events-none absolute inset-[6%] rounded-full border border-[#D5BFFF]/60" aria-hidden="true" />
         <div className="pointer-events-none absolute left-[20%] top-[8%] h-[84%] w-[60%] rounded-full border border-white/80" aria-hidden="true" />
         <div className="pointer-events-none absolute left-[10%] top-[22%] h-[56%] w-[80%] rounded-full border border-[#B487FA]/35" aria-hidden="true" />

         <div className="relative grid grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)] sm:gap-4">
            <SpeakerPanel active={speaker === "asha"} name="Asha" language="Hindi" portrait={ashaPortrait} flag={indiaFlag} original={message.original} spoken={message.spoken} side="left" />

            <div className="relative z-10 flex min-h-72 flex-col items-center justify-center sm:min-h-96">
               <div className="rounded-full border border-white bg-white/90 px-2 py-1 text-center text-[9px] font-semibold text-[#6B35D3] shadow-sm sm:px-3 sm:py-2 sm:text-xs"><Languages className="mr-1 inline" size={13} /> Live speech translation</div>
               <span className="mt-2 rounded-full bg-[#7F40E8] px-2 py-1 text-[9px] font-bold text-white shadow-[0_6px_14px_rgba(127,64,232,.35)]">● LIVE</span>
               <div className={`relative mt-8 grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[#A05DF9] to-[#5620C6] text-white shadow-[0_0_0_10px_rgba(167,106,255,.18),0_12px_30px_rgba(102,47,214,.45)] sm:h-20 sm:w-20 ${speaker === "asha" ? "translation-speaking" : ""}`}>
                  <Mic className="relative z-10" size={30} aria-hidden="true" />
                  <Waveform active={speaker === "asha"} />
               </div>
               <div className="absolute top-[43%] left-[-6px] text-[#7F40E8] sm:left-0"><ArrowRight className="translation-arrow-right" size={28} strokeWidth={2.5} aria-hidden="true" /></div>
               <div className="absolute top-[60%] right-[-6px] text-[#42A5F5] sm:right-0"><ArrowLeft className="translation-arrow-left" size={28} strokeWidth={2.5} aria-hidden="true" /></div>
               <div className="mt-12 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[9px] font-semibold text-[#6B35D3] shadow-sm sm:px-3 sm:text-xs"><ArrowRightLeft size={13} /> Bidirectional</div>
            </div>

            <SpeakerPanel active={speaker === "daniel"} name="Daniel" language="French" portrait={danielPortrait} flag={franceFlag} original={message.translated} spoken={speaker === "daniel" ? "Translation delivered" : "Waiting for translation"} side="right" />
         </div>
      </div>
   );
}

function SpeakerPanel({ active, name, language, portrait, flag, original, spoken, side }: { active: boolean; name: string; language: string; portrait: typeof ashaPortrait; flag: typeof indiaFlag; original: string; spoken: string; side: "left" | "right" }) {
   return (
      <div className={`relative z-10 min-w-0 transition-all duration-500 ${active ? "scale-[1.02]" : "opacity-90"}`}>
         <div className="absolute -top-3 left-1/2 z-10 flex w-max max-w-[calc(100%-8px)] -translate-x-1/2 items-center gap-1.5 rounded-full border border-white bg-white/95 px-2 py-1 text-[9px] font-semibold text-[#4B2A78] shadow-[0_8px_18px_-12px_rgba(65,6,134,.55)] sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs">
            <Image src={flag} alt={`${language} flag`} className="h-4 w-4 object-contain sm:h-5 sm:w-5" />
            <span>{name} · {language}</span><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> <span className="hidden sm:inline">LIVE</span>
         </div>
         <div className={`overflow-hidden rounded-[1.35rem] border-2 bg-white p-1 shadow-[0_20px_38px_-24px_rgba(65,6,134,.55)] transition-colors duration-500 sm:rounded-[1.6rem] ${active ? "border-[#A76AFF]" : "border-white/90"}`}>
            <div className="relative aspect-[.9] overflow-hidden rounded-[1.1rem] bg-[#EDE3FF] sm:rounded-[1.35rem]"><Image src={portrait} alt={`${name} on a live call`} fill sizes="(max-width: 640px) 35vw, 250px" className={`object-cover ${side === "right" ? "object-center" : "object-center"}`} priority /></div>
            <div className="-mt-5 relative rounded-[1rem] bg-white px-2.5 py-2.5 shadow-[0_-8px_20px_rgba(255,255,255,.85)] sm:-mt-7 sm:rounded-[1.25rem] sm:px-4 sm:py-3">
               <p className="line-clamp-3 text-[10px] font-semibold leading-4 text-[#32195A] transition-all sm:text-sm sm:leading-5">{original}</p>
               <div className="mt-2 flex items-center gap-1.5 text-[9px] text-[#75658C] sm:text-xs"><AudioLines className={active ? "translation-audio" : ""} size={14} /><span className="line-clamp-1">{spoken}</span></div>
            </div>
         </div>
      </div>
   );
}

function Waveform({ active }: { active: boolean }) {
   return <div className="pointer-events-none absolute left-1/2 top-1/2 flex w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-between sm:w-40" aria-hidden="true">{[16, 25, 12, 32, 21, 36, 18, 28, 14].map((height, index) => <span key={index} className={`w-1 rounded-full bg-[#A75BFF] opacity-80 sm:w-1.5 ${active ? "translation-wave" : ""}`} style={{ height, animationDelay: `${index * 90}ms` }} />)}</div>;
}
