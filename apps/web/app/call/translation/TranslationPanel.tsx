"use client";

import type { TranslationMode } from "@purplecallio/sdk";
import { LanguageSelect, useCallLanguages } from "./LanguageSelect";
import { AMBER, type CallTranslationTheme } from "./theme";
import type { CallTranslation } from "./useCallTranslation";

const MODES: { value: TranslationMode; label: string; hint: string }[] = [
   { value: "off", label: "Off", hint: "No translation" },
   { value: "captions", label: "Captions", hint: "Translated captions only" },
   { value: "voice", label: "Voice", hint: "Hear a translated voice and see captions" },
];

const ERROR_TEXT: Record<string, string> = {
   TRANSLATION_DISABLED: "Live Translate is not available right now.",
   TRANSLATION_SESSION_INVALID: "This call link can no longer use translation.",
   TRANSLATION_NOT_IN_PLAN: "Live Translate is not included in this plan.",
   TRANSLATION_INSUFFICIENT_CREDITS: "Not enough credits to start translation.",
   TRANSLATION_CALL_ENDED: "The call has ended.",
   TRANSLATION_MICROPHONE_DENIED: "Microphone access was denied.",
   TRANSLATION_MICROPHONE_UNAVAILABLE: "No microphone was found.",
   TRANSLATION_AUDIO_UNSUPPORTED: "This browser cannot run Live Translate.",
   TRANSLATION_CONNECTION_FAILED: "Could not connect to Live Translate.",
};

export function translationErrorText(code?: string): string {
   return (code && ERROR_TEXT[code]) || "Live Translate ran into a problem.";
}

function remainingText(seconds?: number): string | null {
   if (seconds === undefined || !Number.isFinite(seconds)) return null;
   const s = Math.max(0, Math.round(seconds));
   return s < 60 ? `${s} s left` : `${Math.ceil(s / 60)} min left`;
}

/** Translation settings for the hosted call: languages, mode, original volume, notices. */
export function TranslationPanel({
   translation: tr,
   apiUrl,
   theme,
   splitView,
   onSplitViewChange,
   onClose,
}: {
   translation: CallTranslation;
   apiUrl: string;
   theme: CallTranslationTheme;
   splitView: boolean;
   onSplitViewChange: (v: boolean) => void;
   onClose: () => void;
}) {
   const { languages } = useCallLanguages(apiUrl);
   const state = tr.state;
   const mode: TranslationMode = tr.enabled ? (state?.mode ?? tr.prefs.mode) : "off";
   const volumePct = Math.round(tr.prefs.originalVolume * 100);
   const limit = state?.limit;

   return (
      <div
         role="dialog"
         aria-label="Live Translate"
         className="absolute bottom-4 right-4 z-20 w-[min(340px,calc(100%-2rem))] rounded-2xl p-4 flex flex-col gap-3 shadow-2xl"
         style={{ background: theme.surfaceBg, border: `1px solid ${theme.borderColor}`, color: theme.textPrimary }}
         onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
         <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Live Translate</span>
            <button
               type="button"
               onClick={onClose}
               aria-label="Close translation settings"
               className="text-lg leading-none px-1"
               style={{ color: theme.textSecondary }}
            >
               ×
            </button>
         </div>

         <LanguageSelect
            label="My language"
            value={tr.prefs.speak}
            onChange={(speak) => tr.setLanguages({ speak })}
            languages={languages}
            require="captions"
            theme={theme}
         />
         <LanguageSelect
            label="I want to hear"
            value={tr.prefs.hear}
            onChange={(hear) => tr.setLanguages({ hear })}
            languages={languages}
            require={mode === "voice" ? "voice" : "captions"}
            theme={theme}
         />

         <div
            role="radiogroup"
            aria-label="Translation mode"
            className="flex gap-1 p-1 rounded-full"
            style={{ border: `1px solid ${theme.borderColor}`, background: theme.shellBg }}
         >
            {MODES.map((m) => (
               <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  aria-label={`Translation ${m.label.toLowerCase()}: ${m.hint}`}
                  title={m.hint}
                  onClick={() => tr.setMode(m.value)}
                  className="flex-1 rounded-full py-1.5 text-xs font-medium"
                  style={{
                     background: mode === m.value ? theme.primary : "transparent",
                     color: mode === m.value ? "#fff" : theme.textPrimary,
                  }}
               >
                  {m.label}
               </button>
            ))}
         </div>

         {state?.status === "connecting" && (
            <p role="status" className="text-xs" style={{ color: theme.textSecondary }}>
               Connecting translation…
            </p>
         )}
         {state?.error && state.status !== "ready" && (
            <p role="alert" className="text-xs" style={{ color: AMBER }}>
               {translationErrorText(state.error.code)}
            </p>
         )}

         <label className="text-xs flex flex-col gap-1" style={{ color: theme.textSecondary }}>
            Original voice while translation plays: {volumePct}%
            <input
               type="range"
               min={0}
               max={100}
               step={5}
               value={volumePct}
               aria-label="Original voice volume while translation plays"
               onChange={(e) => tr.setOriginalVolume(Number(e.target.value) / 100)}
               style={{ accentColor: theme.primary }}
            />
         </label>

         <label className="flex items-center gap-2 text-xs" style={{ color: theme.textSecondary }}>
            <input
               type="checkbox"
               checked={splitView}
               onChange={(e) => onSplitViewChange(e.target.checked)}
               aria-label="Show split chat view"
            />
            Split chat view
         </label>

         {state?.replayEnabled && (
            <p className="text-xs" style={{ color: theme.textSecondary }} data-testid="replay-enabled">
               ● Replay enabled — you can replay what the other person said.
            </p>
         )}
         {limit && (
            <p
               role={limit.kind === "warning" ? "status" : "alert"}
               className="text-xs rounded-lg px-2.5 py-1.5"
               style={{ background: `${AMBER}22`, color: AMBER }}
            >
               {limit.message ||
                  (limit.kind === "warning"
                     ? "Translation is close to its limit."
                     : limit.kind === "stepped_down"
                       ? "Switched to captions to stay within the limit."
                       : "Translation paused: the limit was reached. The call continues.")}
               {remainingText(limit.remainingSeconds) && ` (${remainingText(limit.remainingSeconds)})`}
            </p>
         )}
         {mode === "voice" && (
            <p className="text-xs" style={{ color: theme.textSecondary }}>
               Tip: use headphones so the translated voice isn&apos;t picked up by your microphone.
            </p>
         )}
      </div>
   );
}

/** Control-bar icon: two speech bubbles ("A" / "अ"). */
export function TranslateIcon() {
   return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
         <path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 5.5 5 7" strokeLinecap="round" strokeLinejoin="round" />
         <path d="M11 5c-.8 3.5-3.2 6.5-7 8" strokeLinecap="round" strokeLinejoin="round" />
         <path d="M13 21l4-9 4 9M14.5 18h5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
   );
}
