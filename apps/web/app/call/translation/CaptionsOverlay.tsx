"use client";

import { useState } from "react";
import { describeGuardReasons, SLOW_REPLAY_RATE, type TranslationPhrase } from "@purplecallio/sdk";
import { scriptProps, useScriptFonts } from "./LanguageSelect";
import { AMBER } from "./theme";
import type { CallTranslation } from "./useCallTranslation";

export type CaptionLayout = "translated" | "both" | "original";

const LAYOUTS: { value: CaptionLayout; label: string }[] = [
   { value: "translated", label: "Translated" },
   { value: "both", label: "Both" },
   { value: "original", label: "Original" },
];

const chip = "text-[11px] px-2 py-0.5 rounded-full border border-white/25 hover:bg-white/10";

/**
 * DualView captions over the video: the latest phrases with original and
 * translated lines, the one being voiced highlighted, MeaningGuard flags in
 * amber with plain reasons, "Ask to repeat" and (if enabled) "Replay
 * original". Or the split chat view.
 */
export function CaptionsOverlay({
   translation: tr,
   splitView,
   primary,
   maxPhrases = 3,
}: {
   translation: CallTranslation;
   splitView: boolean;
   primary: string;
   maxPhrases?: number;
}) {
   const [layout, setLayout] = useState<CaptionLayout>("both");
   const phrases = tr.phrases;
   useScriptFonts(phrases.slice(-20).flatMap((p) => [p.sourceLanguage, p.targetLanguage]));
   if (!tr.enabled && phrases.length === 0) return null;
   const replayEnabled = Boolean(tr.state?.replayEnabled);

   return (
      <div className="absolute inset-x-0 bottom-0 z-10 p-3 sm:p-4 pointer-events-none flex flex-col gap-2">
         {tr.repeatRequests.map((r) => (
            <div
               key={r.phraseId}
               role="alert"
               className="pointer-events-auto self-center max-w-xl rounded-xl px-3 py-2 text-sm text-white flex items-center gap-3"
               style={{ background: "rgba(15,23,42,0.85)", border: `1px solid ${AMBER}` }}
            >
               <span>
                  <span dir="auto">{r.prompt}</span>
                  {r.original && (
                     <span className="block text-xs text-white/70" dir="auto">
                        “{r.original}”
                     </span>
                  )}
               </span>
               <button type="button" className={chip} onClick={() => tr.dismissRepeatRequest(r.phraseId)} aria-label="Dismiss repeat request">
                  OK
               </button>
            </div>
         ))}

         <div
            className="pointer-events-auto mx-auto w-full max-w-3xl rounded-2xl text-white"
            style={{ background: "rgba(6,10,23,0.72)", backdropFilter: "blur(6px)" }}
         >
            {!splitView && (
               <div role="radiogroup" aria-label="Caption layout" className="flex gap-1 px-3 pt-2">
                  {LAYOUTS.map((l) => (
                     <button
                        key={l.value}
                        type="button"
                        role="radio"
                        aria-checked={layout === l.value}
                        onClick={() => setLayout(l.value)}
                        className={chip}
                        style={{ background: layout === l.value ? primary : undefined }}
                     >
                        {l.label}
                     </button>
                  ))}
               </div>
            )}
            {splitView ? (
               <SplitChat phrases={phrases.slice(-12)} replayEnabled={replayEnabled} onReplay={(id) => tr.replay(id)} primary={primary} />
            ) : (
               <ol role="log" aria-live="polite" aria-label="Live translation captions" className="list-none m-0 p-3 flex flex-col gap-1.5">
                  {phrases.length === 0 && <li className="text-xs text-white/70">Captions will appear here when someone speaks.</li>}
                  {phrases.slice(-maxPhrases).map((p) => (
                     <CaptionRow
                        key={p.phraseId}
                        phrase={p}
                        layout={layout}
                        replayEnabled={replayEnabled}
                        onReplay={() => tr.replay(p.phraseId)}
                        onSlowReplay={() => tr.replay(p.phraseId, SLOW_REPLAY_RATE)}
                        onRepeat={() => tr.requestRepeat(p.phraseId)}
                        primary={primary}
                     />
                  ))}
               </ol>
            )}
         </div>
      </div>
   );
}

function CaptionRow({
   phrase: p,
   layout,
   replayEnabled,
   onReplay,
   onSlowReplay,
   onRepeat,
   primary,
}: {
   phrase: TranslationPhrase;
   layout: CaptionLayout;
   replayEnabled: boolean;
   onReplay: () => boolean;
   onSlowReplay: () => boolean;
   onRepeat: () => boolean;
   primary: string;
}) {
   const [asked, setAsked] = useState(Boolean(p.repeatRequestedAt));
   const showOriginal = layout !== "translated" || !p.translated;
   const showTranslated = layout !== "original" && Boolean(p.translated);
   const reasons = p.flagged ? describeGuardReasons(p.guard?.reasons) : [];
   return (
      <li
         data-phrase-id={p.phraseId}
         aria-current={p.playing ? "true" : undefined}
         className="rounded-lg px-2.5 py-1.5 transition-colors"
         style={{
            background: p.playing ? `${primary}55` : "transparent",
            borderInlineStart: `3px solid ${p.flagged ? AMBER : "transparent"}`,
            opacity: p.final ? 1 : 0.85,
         }}
      >
         <span className="block text-[10px] uppercase tracking-wider text-white/60">{p.mine ? "You" : "Them"}</span>
         {showOriginal && (
            <p {...scriptProps(p.sourceLanguage)} className={showTranslated ? "m-0 text-sm text-white/75" : "m-0 text-base"}>
               {p.original}
            </p>
         )}
         {showTranslated && (
            <p {...scriptProps(p.targetLanguage)} className="m-0 text-base font-semibold">
               {p.translated}
            </p>
         )}
         {p.flagged && (
            <div role="note" className="mt-1 text-xs rounded-md px-2 py-1" style={{ background: `${AMBER}26`, color: AMBER }}>
               <strong>May not be accurate — check</strong>
               {reasons.length > 0 && <span> · {reasons.join(" · ")}</span>}
            </div>
         )}
         {!p.mine && p.final && (
            <div className="flex gap-1.5 mt-1">
               <button
                  type="button"
                  className={chip}
                  disabled={asked}
                  onClick={() => onRepeat() && setAsked(true)}
                  aria-label={`Ask to repeat: ${p.translated || p.original}`}
               >
                  {asked ? "Asked to repeat" : "Ask to repeat"}
               </button>
               {replayEnabled && (
                  <>
                     <button type="button" className={chip} onClick={onReplay} aria-label={`Replay original: ${p.original}`}>
                        Replay original
                     </button>
                     <button type="button" className={chip} onClick={onSlowReplay} aria-label={`Replay original slower: ${p.original}`}>
                        Slower
                     </button>
                  </>
               )}
            </div>
         )}
      </li>
   );
}

function SplitChat({
   phrases,
   replayEnabled,
   onReplay,
   primary,
}: {
   phrases: TranslationPhrase[];
   replayEnabled: boolean;
   onReplay: (id: string) => boolean;
   primary: string;
}) {
   const [open, setOpen] = useState<string | null>(null);
   const column = (list: TranslationPhrase[], own: boolean, label: string) => (
      <div role="log" aria-live={own ? "off" : "polite"} aria-label={label} className={`flex-1 min-w-0 flex flex-col gap-1.5 ${own ? "items-end" : "items-start"}`}>
         <span className="text-[10px] uppercase tracking-wider text-white/60">{label}</span>
         {list.map((p) => {
            const main = own ? { t: p.original, l: p.sourceLanguage } : { t: p.translated || p.original, l: p.translated ? p.targetLanguage : p.sourceLanguage };
            const other = own ? { t: p.translated, l: p.targetLanguage, k: "They hear" } : { t: p.original, l: p.sourceLanguage, k: "Original" };
            const isOpen = open === p.phraseId;
            return (
               <div key={p.phraseId} className="max-w-[90%]" onMouseEnter={() => setOpen(p.phraseId)} onMouseLeave={() => setOpen(null)}>
                  <button
                     type="button"
                     aria-expanded={isOpen}
                     onClick={() => setOpen(isOpen ? null : p.phraseId)}
                     className="text-left rounded-2xl px-3 py-1.5 text-sm"
                     style={{
                        background: p.playing ? `${primary}88` : own ? `${primary}55` : "rgba(255,255,255,0.1)",
                        border: `1px solid ${p.flagged ? AMBER : "transparent"}`,
                     }}
                  >
                     <span {...scriptProps(main.l)}>{main.t}</span>
                     {p.flagged && <span className="block text-[11px]" style={{ color: AMBER }}>May not be accurate — check</span>}
                  </button>
                  {isOpen && other.t && (
                     <div role="tooltip" className="mt-1 rounded-lg px-2.5 py-1.5 text-xs bg-black/70">
                        <span className="block text-white/60">{other.k}</span>
                        <span {...scriptProps(other.l)}>{other.t}</span>
                        {!own && replayEnabled && p.final && (
                           <button type="button" className={`${chip} block mt-1`} onClick={() => onReplay(p.phraseId)}>
                              Replay original
                           </button>
                        )}
                     </div>
                  )}
               </div>
            );
         })}
      </div>
   );
   return (
      <div className="flex gap-3 p-3 max-h-[45vh] overflow-y-auto">
         {column(phrases.filter((p) => !p.mine), false, "Them")}
         {column(phrases.filter((p) => p.mine), true, "You")}
      </div>
   );
}
