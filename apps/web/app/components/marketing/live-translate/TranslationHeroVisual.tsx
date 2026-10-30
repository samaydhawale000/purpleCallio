"use client";

import Image from "next/image";
import { Code2, Languages, Sparkles, Video, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import nehaPortrait from "../../../assets/images/live-translate-asha.webp";
import pierrePortrait from "../../../assets/images/live-translate-daniel.webp";
import indiaFlag from "../../../assets/images/flag-india.webp";
import franceFlag from "../../../assets/images/flag-france.webp";

type Side = "neha" | "pierre";

/** A short support call: each line in the speaker's language, with the other side's translation. */
const CONVERSATION: { from: Side; hi: string; fr: string }[] = [
   { from: "neha", hi: "नमस्ते! मुझे अपने ऑर्डर के बारे में जानना है।", fr: "Bonjour ! J’aimerais avoir des nouvelles de ma commande." },
   { from: "pierre", fr: "Bien sûr ! Quel est votre numéro de commande ?", hi: "ज़रूर! आपका ऑर्डर नंबर क्या है?" },
   { from: "neha", hi: "चार पाँच दो एक। यह कब तक पहुँचेगा?", fr: "Quatre, cinq, deux, un. Quand va-t-il arriver ?" },
   { from: "pierre", fr: "Il est déjà expédié, il arrivera jeudi.", hi: "यह भेज दिया गया है, गुरुवार तक पहुँच जाएगा।" },
   { from: "neha", hi: "बहुत बढ़िया! क्या मैं इसे ट्रैक कर सकती हूँ?", fr: "Super ! Est-ce que je peux le suivre ?" },
   { from: "pierre", fr: "Oui, je vous envoie le lien de suivi par SMS.", hi: "हाँ, मैं आपको ट्रैकिंग लिंक SMS पर भेज रहा हूँ।" },
];

const VOICE_LANG = { hi: "hi-IN", fr: "fr-FR" } as const;

type Gender = "female" | "male";

// The Web Speech API exposes no gender, so voices are matched by the names
// browsers ship (macOS, Windows/Edge, Chrome). Google's fr/hi voices are female.
const VOICE_NAMES: Record<Gender, RegExp> = {
   male: /\b(male|thomas|paul|henri|remy|rémy|claude|jacques|nicolas|daniel|guillaume|antoine|alain|fabrice|eddy|rocko|grandpa|madhur|hemant|rishi|prabhat)\b/i,
   female: /\b(female|flo|sandy|shelley|grandma|amélie|amelie|audrey|aurélie|aurelie|marie|julie|hortense|denise|eloise|éloïse|vivienne|brigitte|céline|celine|lekha|swara|kalpana|ananya|google)\b/i,
};

/** Best installed voice for the language and gender; pitch-shifts the closest match when none fits. */
function pickVoice(lang: keyof typeof VOICE_LANG, gender: Gender): { voice: SpeechSynthesisVoice; pitch: number } | null {
   const voices = window.speechSynthesis
      .getVoices()
      .filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang));
   if (voices.length === 0) return null;
   const other: Gender = gender === "male" ? "female" : "male";
   const exact = voices.find((v) => VOICE_NAMES[gender].test(v.name));
   if (exact) return { voice: exact, pitch: 1 };
   const neutral = voices.find((v) => !VOICE_NAMES[other].test(v.name)) ?? voices[0];
   return { voice: neutral, pitch: gender === "male" ? 0.7 : 1.15 };
}

/** Floating capability chips around the globe (position in % of the visual). */
const CHIPS: { label: string; icon: LucideIcon; className: string; tone: string }[] = [
   { label: "Voice & Video", icon: Video, className: "left-[22%] top-[1%]", tone: "from-[#7F40E8] to-[#4F46E5]" },
   { label: "AI Voice Agents", icon: Sparkles, className: "right-[3%] top-[6%]", tone: "from-[#A05DF9] to-[#6425C4]" },
   { label: "Live Translate", icon: Languages, className: "left-[18%] bottom-[2%]", tone: "from-[#A05DF9] to-[#7F40E8]" },
   { label: "Developer APIs", icon: Code2, className: "right-[6%] bottom-[2%]", tone: "from-[#4F46E5] to-[#6366F1]" },
];

/**
 * Speaks `text` with the browser's own speech synthesis and calls `done`
 * when it ends (or after a fallback delay: `onend` is unreliable in some
 * browsers). Lines without an installed voice for the language are skipped
 * silently rather than read out in the wrong accent. Returns a cancel.
 */
function say(text: string, lang: keyof typeof VOICE_LANG, gender: Gender, done: () => void): () => void {
   let finished = false;
   const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallback);
      done();
   };
   const fallback = window.setTimeout(finish, 1500 + text.length * 110);
   const synth = window.speechSynthesis;
   const picked = pickVoice(lang, gender);
   if (picked) {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = picked.voice;
      u.pitch = picked.pitch;
      u.lang = VOICE_LANG[lang];
      u.rate = 0.95;
      u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
   }
   return () => {
      finished = true;
      window.clearTimeout(fallback);
   };
}

/** Illustrative only: this never opens media devices or starts a call. */
export function TranslationHeroVisual() {
   const [index, setIndex] = useState(0);
   const [phase, setPhase] = useState<"speaking" | "translated">("speaking");
   const [soundOn, setSoundOn] = useState(false);
   // Known only after mount, so the server and first client render match.
   const [canSpeak, setCanSpeak] = useState(false);

   const line = CONVERSATION[index];
   const nehaSpeaks = line.from === "neha";

   useEffect(() => {
      if (!("speechSynthesis" in window)) return;
      setCanSpeak(true);
      // Voices load asynchronously in Chrome; asking once starts the load.
      window.speechSynthesis.getVoices();
      return () => window.speechSynthesis.cancel();
   }, []);

   useEffect(() => {
      const advance = () =>
         phase === "speaking"
            ? setPhase("translated")
            : (setIndex((i) => (i + 1) % CONVERSATION.length), setPhase("speaking"));
      if (!soundOn) {
         const t = window.setTimeout(advance, phase === "speaking" ? 1800 : 2800);
         return () => window.clearTimeout(t);
      }
      // Original voice first, then the translated voice on the other side,
      // both in the speaker's voice (Neha female, Pierre male).
      const original = nehaSpeaks ? "hi" : "fr";
      const lang = phase === "speaking" ? original : original === "hi" ? "fr" : "hi";
      let pause: number | undefined;
      const cancel = say(line[lang], lang, nehaSpeaks ? "female" : "male", () => {
         pause = window.setTimeout(advance, phase === "speaking" ? 250 : 700);
      });
      return () => {
         cancel();
         window.clearTimeout(pause);
      };
   }, [index, phase, soundOn, line, nehaSpeaks]);

   const toggleSound = () => {
      const synth = window.speechSynthesis;
      if (soundOn) {
         synth.cancel();
         setSoundOn(false);
         return;
      }
      // Speaking inside the click unlocks audio on iOS Safari.
      synth.cancel();
      synth.speak(new SpeechSynthesisUtterance(""));
      setPhase("speaking");
      setSoundOn(true);
   };

   // Which side is audible right now: the speaker, then the listener's translation.
   const nehaActive = nehaSpeaks === (phase === "speaking");
   const SoundIcon = soundOn ? Volume2 : VolumeX;

   return (
      <div
         className="hero-globe @container relative mx-auto aspect-[1.12] w-full max-w-[640px]"
         role="group"
         aria-label="Neha speaks Hindi and Pierre speaks French; each hears the other translated in real time"
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
            <div key={label} aria-hidden="true" className={`absolute z-20 flex items-center gap-[1.6cqw] rounded-full border border-white bg-white/90 py-[1cqw] pl-[1cqw] pr-[2.6cqw] shadow-[0_10px_30px_-14px_rgba(65,6,134,.45)] backdrop-blur ${className}`}>
               <span className={`grid h-[6.6cqw] w-[6.6cqw] place-items-center rounded-full bg-gradient-to-br text-white ${tone}`}>
                  <Icon className="h-[3.2cqw] w-[3.2cqw]" aria-hidden="true" />
               </span>
               <span className="whitespace-nowrap text-[max(9px,2.1cqw)] font-semibold text-[#2A1650]">{label}</span>
            </div>
         ))}

         <SpeakerCard
            className="left-[4%] top-[17%] -rotate-[4deg]"
            active={nehaActive}
            name="Neha"
            country="India"
            language="Hindi"
            lang="hi"
            flag={indiaFlag}
            portrait={nehaPortrait}
            text={nehaSpeaks || phase === "translated" ? line.hi : "…"}
            flagSide="left"
         />
         <SpeakerCard
            className="right-[2%] top-[19%] rotate-[3deg]"
            active={!nehaActive}
            name="Pierre"
            country="France"
            language="French"
            lang="fr"
            flag={franceFlag}
            portrait={pierrePortrait}
            text={!nehaSpeaks || phase === "translated" ? line.fr : "…"}
            flagSide="right"
         />

         {/* Centre: speaker button, waves and direction arrows */}
         <div className="absolute left-1/2 top-[48%] z-10 flex w-[30%] -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            <svg aria-hidden="true" viewBox="0 0 200 60" className={`absolute -top-[42%] w-[115%] overflow-visible transition-opacity duration-500 ${nehaSpeaks ? "opacity-100" : "opacity-30"}`}>
               <defs>
                  <marker id="hero-arrow-purple" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8B5CF6" /></marker>
                  <marker id="hero-arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#60A5FA" /></marker>
               </defs>
               <path d="M35,28 C80,0 140,4 180,40" fill="none" stroke="#8B5CF6" strokeWidth="3" strokeLinecap="round" markerEnd="url(#hero-arrow-purple)" className="hero-arrow-path" />
            </svg>
            <div className="flex w-full items-center justify-center gap-[1.4cqw]">
               <Bars active={nehaActive} />
               {canSpeak ? (
                  <button
                     type="button"
                     onClick={toggleSound}
                     aria-pressed={soundOn}
                     aria-label={soundOn ? "Mute the voices" : "Play the voices"}
                     title={soundOn ? "Mute the voices" : "Play the voices"}
                     className={`relative grid h-[12cqw] w-[12cqw] shrink-0 cursor-pointer place-items-center rounded-full bg-gradient-to-br from-[#A05DF9] to-[#5620C6] text-white shadow-[0_0_0_2cqw_rgba(167,106,255,.16),0_0_0_4cqw_rgba(167,106,255,.08),0_12px_30px_rgba(102,47,214,.45)] transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-[0.6cqw] focus-visible:outline-offset-[1cqw] focus-visible:outline-[#6425C4] ${soundOn ? "translation-speaking" : ""}`}
                  >
                     <SoundIcon className="h-[5cqw] w-[5cqw]" aria-hidden="true" />
                  </button>
               ) : (
                  <span aria-hidden="true" className="relative grid h-[12cqw] w-[12cqw] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#A05DF9] to-[#5620C6] text-white shadow-[0_0_0_2cqw_rgba(167,106,255,.16),0_0_0_4cqw_rgba(167,106,255,.08),0_12px_30px_rgba(102,47,214,.45)]">
                     <Volume2 className="h-[5cqw] w-[5cqw]" aria-hidden="true" />
                  </span>
               )}
               <Bars active={!nehaActive} />
            </div>
            <svg aria-hidden="true" viewBox="0 0 200 60" className={`absolute -bottom-[48%] w-[115%] overflow-visible transition-opacity duration-500 ${nehaSpeaks ? "opacity-30" : "opacity-100"}`}>
               <path d="M175,10 C150,40 120,48 90,46" fill="none" stroke="#60A5FA" strokeWidth="3" strokeLinecap="round" markerEnd="url(#hero-arrow-blue)" className="hero-arrow-path" />
               <path d="M80,44 C55,40 35,30 22,14" fill="none" stroke="#8B5CF6" strokeWidth="3" strokeLinecap="round" markerEnd="url(#hero-arrow-purple)" className="hero-arrow-path" />
            </svg>
            <span className="mt-[5cqw] rounded-full border border-white bg-white/95 px-[2.4cqw] py-[1cqw] text-center leading-tight shadow-[0_8px_20px_-12px_rgba(65,6,134,.5)]">
               <span className="block text-[max(8px,1.7cqw)] font-medium text-[#6B35D3]">
                  {canSpeak && !soundOn ? "Tap to listen" : "Real-time"}
               </span>
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
   lang,
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
   lang: string;
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
            <p className="mt-[1.4cqw] min-h-[3.4em] rounded-[1.6cqw] bg-[#F8F4FD] px-[1.6cqw] py-[1.2cqw] text-[max(8px,1.9cqw)] font-medium leading-snug text-[#2A1650]" lang={lang}>
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
