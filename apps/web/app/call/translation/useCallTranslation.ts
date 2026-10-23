"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
   TranslationClient,
   type TranslationClientConfig,
   type TranslationMode,
   type TranslationPhrase,
   type TranslationRepeatRequest,
   type TranslationState,
} from "@purplecallio/sdk";

export const DEFAULT_ORIGINAL_VOLUME = 0.2;

export interface CallTranslationDefaults {
   mode: TranslationMode;
   /** This participant's language (speak and hear default to it). */
   language?: string;
   role?: "caller" | "receiver";
}

const MODES: TranslationMode[] = ["off", "captions", "voice"];

function lower(v: unknown): string | undefined {
   return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined;
}

/**
 * Reads translation defaults from `GET /calls/:id/details`. Tolerant of the
 * shapes the REST layer may use: `translation: { mode, config }` plus either
 * `participants[].language`, `callerLanguage` / `receiverLanguage`, or a
 * top-level `language`. Returns null when the call has no translation info.
 */
export function translationDefaultsFromDetails(data: unknown): CallTranslationDefaults | null {
   if (!data || typeof data !== "object") return null;
   const d = data as Record<string, any>;
   const rawMode = lower(d.translation?.mode ?? d.translationMode);
   const mode = MODES.includes(rawMode as TranslationMode) ? (rawMode as TranslationMode) : undefined;

   const role: "caller" | "receiver" | undefined =
      lower(d.role) === "caller" || lower(d.role) === "receiver"
         ? (lower(d.role) as "caller" | "receiver")
         : d.participantId && d.participantId === d.callerId
           ? "caller"
           : d.participantId && d.participantId === d.receiverId
             ? "receiver"
             : undefined;

   let language: string | undefined = lower(d.language ?? d.participantLanguage);
   if (!language && Array.isArray(d.participants)) {
      const me =
         d.participants.find((p: any) => p?.id && p.id === d.participantId) ??
         d.participants.find((p: any) => role && lower(p?.role) === role);
      language = lower(me?.language);
   }
   if (!language && role) language = lower(role === "caller" ? d.callerLanguage : d.receiverLanguage);

   if (!mode && !language) return null;
   return { mode: mode ?? "off", language, role };
}

/** The browser's language, as a base code (`en-IN` → `en`). */
export function browserLanguage(): string {
   const nav = typeof navigator !== "undefined" ? navigator.language : "";
   return (nav || "en").toLowerCase().split("-")[0] || "en";
}

export interface TranslationPrefs {
   speak: string;
   hear: string;
   mode: TranslationMode;
   originalVolume: number;
}

/** What the page needs from a translation client (lets tests inject a fake). */
export type CallTranslationClient = Pick<
   TranslationClient,
   | "enable"
   | "disable"
   | "setMode"
   | "setLanguages"
   | "setOriginalVolume"
   | "replay"
   | "requestRepeat"
   | "getState"
   | "on"
   | "phrases"
>;

export interface UseCallTranslationOptions {
   token: string | null;
   /** Socket.IO origin (no `/api`). */
   serverUrl: string;
   /** True while the call is up; translation is torn down when it turns false. */
   active: boolean;
   defaults: CallTranslationDefaults | null;
   getRemoteElements: () => (HTMLMediaElement | null | undefined)[];
   getLocalStream: () => MediaStream | null | undefined;
   createClient?: (config: TranslationClientConfig) => CallTranslationClient;
}

export interface CallTranslation {
   state: TranslationState | null;
   phrases: TranslationPhrase[];
   repeatRequests: TranslationRepeatRequest[];
   /** Connecting or connected. */
   enabled: boolean;
   prefs: TranslationPrefs;
   setMode: (mode: TranslationMode) => void;
   setLanguages: (l: { speak?: string; hear?: string }) => void;
   setOriginalVolume: (v: number) => void;
   replay: (phraseId: string, rate?: number) => boolean;
   requestRepeat: (phraseId: string) => boolean;
   dismissRepeatRequest: (phraseId: string) => void;
   disable: () => void;
}

/**
 * Live Translate for the hosted call page. Nothing connects until the user
 * (or the call's own translation default) turns it on, so a call without
 * translation behaves exactly as before.
 */
export function useCallTranslation(opts: UseCallTranslationOptions): CallTranslation {
   const optsRef = useRef(opts);
   optsRef.current = opts;
   const clientRef = useRef<CallTranslationClient | null>(null);
   const offsRef = useRef<(() => void)[]>([]);
   const autoTriedRef = useRef(false);

   const [state, setState] = useState<TranslationState | null>(null);
   const [phrases, setPhrases] = useState<TranslationPhrase[]>([]);
   const [repeatRequests, setRepeatRequests] = useState<TranslationRepeatRequest[]>([]);
   const [prefs, setPrefs] = useState<TranslationPrefs>(() => ({
      speak: browserLanguage(),
      hear: browserLanguage(),
      mode: "off",
      originalVolume: DEFAULT_ORIGINAL_VOLUME,
   }));
   const prefsRef = useRef(prefs);
   prefsRef.current = prefs;
   const userTouchedRef = useRef(false);

   // Seed languages from the call details (unless the user already chose).
   useEffect(() => {
      const lang = opts.defaults?.language;
      if (!lang || lang === "auto" || userTouchedRef.current) return;
      setPrefs((p) => ({ ...p, speak: lang, hear: lang }));
   }, [opts.defaults?.language]);

   const ensureClient = useCallback((): CallTranslationClient | null => {
      if (clientRef.current) return clientRef.current;
      const { token, serverUrl, createClient } = optsRef.current;
      if (!token) return null;
      const config: TranslationClientConfig = {
         serverUrl,
         token,
         originalVolume: prefsRef.current.originalVolume,
         remoteAudio: () => optsRef.current.getRemoteElements().filter(Boolean) as HTMLMediaElement[],
         stream: () => optsRef.current.getLocalStream() ?? null,
      };
      const client = createClient ? createClient(config) : new TranslationClient(config);
      clientRef.current = client;
      offsRef.current = [
         client.on("state", (s) => {
            setState(s);
            if (s.status === "ready") {
               setPrefs((p) => ({
                  ...p,
                  mode: s.mode,
                  speak: s.you.speak || p.speak,
                  hear: s.you.hear || p.hear,
               }));
            }
            if (s.status === "ended") setPrefs((p) => ({ ...p, mode: "off" }));
         }),
         client.on("phrases", (list) => setPhrases(list)),
         client.on("repeat.requested", (r) =>
            setRepeatRequests((list) => [...list.filter((x) => x.phraseId !== r.phraseId), r]),
         ),
      ];
      return client;
   }, []);

   const enable = useCallback(
      (mode: TranslationMode) => {
         const client = ensureClient();
         if (!client) return;
         const { speak, hear, originalVolume } = prefsRef.current;
         setPrefs((p) => ({ ...p, mode }));
         void client.enable({ speak, hear, mode, originalVolume }).catch(() => undefined);
      },
      [ensureClient],
   );

   const disable = useCallback(() => {
      clientRef.current?.disable();
      setPrefs((p) => ({ ...p, mode: "off" }));
      setRepeatRequests([]);
   }, []);

   const isLive = state?.status === "ready" || state?.status === "connecting";

   const setMode = useCallback(
      (mode: TranslationMode) => {
         userTouchedRef.current = true;
         if (mode === "off") return disable();
         if (isLive && clientRef.current) {
            clientRef.current.setMode(mode);
            setPrefs((p) => ({ ...p, mode }));
         } else enable(mode);
      },
      [disable, enable, isLive],
   );

   const setLanguages = useCallback(
      (l: { speak?: string; hear?: string }) => {
         userTouchedRef.current = true;
         setPrefs((p) => ({ ...p, ...(l.speak ? { speak: l.speak } : {}), ...(l.hear ? { hear: l.hear } : {}) }));
         if (isLive) clientRef.current?.setLanguages(l);
      },
      [isLive],
   );

   const setOriginalVolume = useCallback((v: number) => {
      setPrefs((p) => ({ ...p, originalVolume: v }));
      clientRef.current?.setOriginalVolume(v);
   }, []);

   // Call created with translation on → start it once the call is up.
   useEffect(() => {
      const d = opts.defaults;
      if (!opts.active || !d || d.mode === "off" || autoTriedRef.current) return;
      autoTriedRef.current = true;
      if (d.language && d.language !== "auto" && !userTouchedRef.current) {
         prefsRef.current = { ...prefsRef.current, speak: d.language, hear: d.language };
         setPrefs(prefsRef.current);
      }
      enable(d.mode);
   }, [opts.active, opts.defaults, enable]);

   // Tear down when the call ends or the page unmounts.
   useEffect(() => {
      if (opts.active) return;
      clientRef.current?.disable();
   }, [opts.active]);
   useEffect(
      () => () => {
         offsRef.current.forEach((off) => off());
         clientRef.current?.disable();
         clientRef.current = null;
      },
      [],
   );

   return {
      state,
      phrases,
      repeatRequests,
      enabled: isLive,
      prefs,
      setMode,
      setLanguages,
      setOriginalVolume,
      replay: (id, rate) => clientRef.current?.replay(id, rate ? { rate } : undefined) ?? false,
      requestRepeat: (id) => clientRef.current?.requestRepeat(id) ?? false,
      dismissRepeatRequest: (id) => setRepeatRequests((list) => list.filter((r) => r.phraseId !== id)),
      disable,
   };
}
