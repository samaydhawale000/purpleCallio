"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
   fetchTranslationLanguages,
   fontStackForScript,
   isRtlLanguage,
   lineHeightForScript,
   loadScriptFont,
   scriptForLanguage,
} from "@purplecallio/sdk";
import type { CallTranslationTheme } from "./theme";
import { SONIOX_FALLBACK_LANGUAGES } from "../../lib/soniox-languages";

export interface CallLanguage {
   code: string;
   name: string;
   nativeName: string;
   rtl?: boolean;
   /** Undefined when the server list isn't available (no badge shown). */
   voice?: boolean | null;
   captions?: boolean | null;
}

/** Used only if `GET /translation/languages` can't be reached. */
export const FALLBACK_LANGUAGES: CallLanguage[] = SONIOX_FALLBACK_LANGUAGES;
/* Legacy literal kept below temporarily for source-history readability.
   { code: "en", name: "English", nativeName: "English" },
   { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
   { code: "mr", name: "Marathi", nativeName: "मराठी" },
   { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
   { code: "te", name: "Telugu", nativeName: "తెలుగు" },
   { code: "bn", name: "Bengali", nativeName: "বাংলা" },
   { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી" },
   { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
   { code: "ml", name: "Malayalam", nativeName: "മലയാളം" },
   { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
   { code: "ur", name: "Urdu", nativeName: "اردو", rtl: true },
   { code: "ar", name: "Arabic", nativeName: "العربية", rtl: true },
   { code: "es", name: "Spanish", nativeName: "Español" },
   { code: "fr", name: "French", nativeName: "Français" },
   { code: "de", name: "German", nativeName: "Deutsch" },
]; */

const cache = new Map<string, Promise<CallLanguage[]>>();

/** Languages from the API (cached per base URL), or the fallback list. */
export function useCallLanguages(apiUrl: string, enabled = true): { languages: CallLanguage[]; fromServer: boolean } {
   const [state, setState] = useState<{ languages: CallLanguage[]; fromServer: boolean }>({
      languages: FALLBACK_LANGUAGES,
      fromServer: false,
   });
   useEffect(() => {
      if (!enabled) return;
      let live = true;
      let p = cache.get(apiUrl);
      if (!p) {
         p = fetchTranslationLanguages(apiUrl).then((r) => r.languages);
         p.catch(() => cache.delete(apiUrl));
         cache.set(apiUrl, p);
      }
      p.then(
         (languages) => live && languages.length > 0 && setState({ languages, fromServer: true }),
         () => undefined,
      );
      return () => {
         live = false;
      };
   }, [apiUrl, enabled]);
   return state;
}

export function scriptProps(code: string | undefined) {
   const script = scriptForLanguage(code);
   return {
      lang: code && code !== "auto" ? code : undefined,
      dir: (isRtlLanguage(code) ? "rtl" : "auto") as "rtl" | "auto",
      style: { fontFamily: fontStackForScript(script), lineHeight: lineHeightForScript(script) },
   };
}

/** Load Noto Sans fonts for the scripts of these languages (once per script). */
export function useScriptFonts(codes: (string | undefined)[]) {
   const key = [...new Set(codes.filter(Boolean).map((c) => scriptForLanguage(c)))].sort().join(",");
   useEffect(() => {
      if (key) key.split(",").forEach((s) => loadScriptFont(s));
   }, [key]);
}

/** Searchable language picker showing native names, with voice / captions badges. */
export function LanguageSelect({
   label,
   value,
   onChange,
   languages,
   require,
   theme,
}: {
   label: string;
   value: string;
   onChange: (code: string) => void;
   languages: CallLanguage[];
   require?: "voice" | "captions";
   theme: CallTranslationTheme;
}) {
   const [open, setOpen] = useState(false);
   const [query, setQuery] = useState("");
   const [active, setActive] = useState(0);
   const id = useId();
   const inputRef = useRef<HTMLInputElement>(null);
   const selected = languages.find((l) => l.code === value);
   useScriptFonts(open ? languages.map((l) => l.code) : [value]);

   const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return languages;
      return languages.filter((l) => [l.code, l.name, l.nativeName].some((s) => s.toLowerCase().includes(q)));
   }, [languages, query]);
   const usable = (l: CallLanguage) => !require || l[require] !== false;

   useEffect(() => {
      if (open) inputRef.current?.focus();
      else setQuery("");
   }, [open]);

   const choose = (l?: CallLanguage) => {
      if (!l || !usable(l)) return;
      onChange(l.code);
      setOpen(false);
   };

   const badge = (text: string) => (
      <span
         className="text-[10px] px-1.5 rounded-full"
         style={{ border: `1px solid ${theme.borderColor}`, color: theme.textSecondary }}
      >
         {text}
      </span>
   );

   return (
      <div className="relative">
         <span id={`${id}-label`} className="block text-xs mb-1" style={{ color: theme.textSecondary }}>
            {label}
         </span>
         <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby={`${id}-label ${id}-value`}
            onClick={() => setOpen((o) => !o)}
            className="w-full text-left px-2.5 py-1.5 rounded-lg text-sm"
            style={{ background: theme.shellBg, color: theme.textPrimary, border: `1px solid ${theme.borderColor}` }}
         >
            <span id={`${id}-value`}>
               {selected ? (
                  <>
                     <span {...scriptProps(selected.code)}>{selected.nativeName}</span>
                     {selected.nativeName !== selected.name && (
                        <span style={{ color: theme.textSecondary }}> · {selected.name}</span>
                     )}
                  </>
               ) : (
                  value || "Choose a language"
               )}
            </span>
         </button>
         {open && (
            <div
               className="absolute z-30 left-0 right-0 mt-1 p-1.5 rounded-xl shadow-xl"
               style={{ background: theme.surfaceBg, border: `1px solid ${theme.borderColor}` }}
            >
               <input
                  ref={inputRef}
                  role="combobox"
                  aria-label={`Search ${label}`}
                  aria-expanded="true"
                  aria-controls={`${id}-list`}
                  aria-autocomplete="list"
                  aria-activedescendant={filtered[active] ? `${id}-${filtered[active].code}` : undefined}
                  value={query}
                  placeholder="Search languages"
                  onChange={(e) => {
                     setQuery(e.target.value);
                     setActive(0);
                  }}
                  onKeyDown={(e) => {
                     if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setActive((i) => Math.min(filtered.length - 1, i + 1));
                     } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setActive((i) => Math.max(0, i - 1));
                     } else if (e.key === "Enter") {
                        e.preventDefault();
                        choose(filtered[active]);
                     } else if (e.key === "Escape") {
                        e.preventDefault();
                        setOpen(false);
                     }
                  }}
                  className="w-full mb-1.5 px-2 py-1 rounded-md text-sm bg-transparent"
                  style={{ color: theme.textPrimary, border: `1px solid ${theme.borderColor}` }}
               />
               <ul id={`${id}-list`} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto">
                  {filtered.length === 0 && (
                     <li className="text-xs px-2 py-1" style={{ color: theme.textSecondary }}>
                        No matching language.
                     </li>
                  )}
                  {filtered.map((l, i) => {
                     const ok = usable(l);
                     return (
                        <li
                           key={l.code}
                           id={`${id}-${l.code}`}
                           role="option"
                           aria-selected={l.code === value}
                           aria-disabled={!ok || undefined}
                           onMouseDown={(e) => e.preventDefault()}
                           onMouseEnter={() => setActive(i)}
                           onClick={() => choose(l)}
                           className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm"
                           style={{
                              color: theme.textPrimary,
                              cursor: ok ? "pointer" : "not-allowed",
                              opacity: ok ? 1 : 0.45,
                              background: i === active ? `${theme.primary}33` : "transparent",
                           }}
                        >
                           <span className="flex-1" {...scriptProps(l.code)} dir={l.rtl ? "rtl" : scriptProps(l.code).dir}>
                              {l.nativeName}
                           </span>
                           {l.nativeName !== l.name && (
                              <span className="text-xs" style={{ color: theme.textSecondary }}>
                                 {l.name}
                              </span>
                           )}
                           {l.voice && badge("Voice")}
                           {l.captions && badge("Captions")}
                        </li>
                     );
                  })}
               </ul>
            </div>
         )}
      </div>
   );
}
