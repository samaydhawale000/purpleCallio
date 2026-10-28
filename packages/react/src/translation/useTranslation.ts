import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import {
  TranslationClient,
  type TranslationClientConfig,
  type TranslationError,
  type TranslationLimitEvent,
  type TranslationMode,
  type TranslationOptions,
  type TranslationPhrase,
  type TranslationReady,
  type TranslationRepeatRequest,
  type TranslationState,
} from '@purplecallio/sdk';

export interface UseTranslationOptions extends Partial<TranslationClientConfig> {
  /** Use an existing client, e.g. `meeting.translation`. Otherwise one is built from `serverUrl` + `token`. */
  client?: TranslationClient | null;
  /** Call `enable()` as soon as the client exists (browsers may block audio until a gesture). */
  autoEnable?: boolean;
}

export interface UseTranslationResult {
  client: TranslationClient | null;
  state: TranslationState;
  phrases: TranslationPhrase[];
  /** Connecting or connected. */
  enabled: boolean;
  /** Repeat requests addressed to you, newest last. Dismiss with `dismissRepeatRequest`. */
  repeatRequests: TranslationRepeatRequest[];
  error: TranslationError | null;
  /** Resolves with `ready`, or `null` on failure (the error lands in `error`). */
  enable: (options?: TranslationOptions) => Promise<TranslationReady | null>;
  /** With `meeting.translation` this is for the whole call; `{ share: false }` leaves only you. */
  disable: (options?: { share?: boolean }) => void;
  /** "Join translation": retries audio the browser blocked (`state.audioBlocked`). Call from a click. */
  resumeAudio: () => Promise<boolean>;
  setMode: (mode: TranslationMode) => void;
  setLanguages: (languages: { speak?: string; hear?: string }) => void;
  setOriginalVolume: (volume: number) => void;
  replay: (phraseId: string, options?: { rate?: number }) => boolean;
  requestRepeat: (phraseId: string) => boolean;
  dismissRepeatRequest: (phraseId: string) => void;
  dismissLimit: () => void;
}

const IDLE_STATE: TranslationState = {
  status: 'idle',
  mode: 'off',
  role: null,
  you: { speak: '', hear: '' },
  peer: null,
  replayEnabled: false,
  guard: null,
  limits: null,
  trial: false,
  speaking: false,
  playingPhraseId: null,
  originalVolume: 0,
  audioBlocked: false,
  limit: null,
  error: null,
};

/**
 * Live Translate for a call. Pass `client` (e.g. `meeting.translation`) or
 * `serverUrl` + `token` (the participant's call session token).
 *
 * ```tsx
 * const tr = useTranslation({ serverUrl, token, remoteAudio: () => audioRef.current });
 * <button onClick={() => tr.enable({ speak: 'en', hear: 'hi', mode: 'voice' })}>Translate</button>
 * <DualViewCaptions translation={tr} />
 * ```
 */
export function useTranslation(options: UseTranslationOptions): UseTranslationResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { client: given, serverUrl, token } = options;

  const [client, setClient] = useState<TranslationClient | null>(null);
  const [state, setState] = useState<TranslationState>(IDLE_STATE);
  const [phrases, setPhrases] = useState<TranslationPhrase[]>([]);
  const [repeatRequests, setRepeatRequests] = useState<TranslationRepeatRequest[]>([]);
  const [dismissedLimit, setDismissedLimit] = useState<TranslationLimitEvent | null>(null);

  useEffect(() => {
    let owned = false;
    let c: TranslationClient | null = given ?? null;
    if (!c && serverUrl && token) {
      const { client: _c, autoEnable: _a, ...config } = optionsRef.current;
      c = new TranslationClient({ ...(config as TranslationClientConfig), serverUrl, token });
      owned = true;
    }
    setClient(c);
    if (!c) {
      setState(IDLE_STATE);
      setPhrases([]);
      return;
    }
    setState(c.getState());
    setPhrases(c.phrases);
    const offs = [
      c.on('state', (s) => setState(s)),
      c.on('phrases', (list) => setPhrases(list)),
      c.on('repeat.requested', (r) => setRepeatRequests((list) => [...list.filter((x) => x.phraseId !== r.phraseId), r])),
      c.on('ended', () => setRepeatRequests([])),
    ];
    if (optionsRef.current.autoEnable) void c.enable().catch(() => undefined);
    return () => {
      offs.forEach((off) => off());
      if (owned) c!.disable();
    };
  }, [given, serverUrl, token]);

  const enable = useCallback(
    async (o?: TranslationOptions) => {
      if (!client) return null;
      try {
        return await client.enable(o);
      } catch {
        return null;
      }
    },
    [client],
  );
  const disable = useCallback((o?: { share?: boolean }) => client?.disable(o), [client]);
  const resumeAudio = useCallback(async () => (client ? client.resumeAudio() : false), [client]);
  const setMode = useCallback((m: TranslationMode) => client?.setMode(m), [client]);
  const setLanguages = useCallback((l: { speak?: string; hear?: string }) => client?.setLanguages(l), [client]);
  const setOriginalVolume = useCallback((v: number) => client?.setOriginalVolume(v), [client]);
  const replay = useCallback((id: string, o?: { rate?: number }) => client?.replay(id, o) ?? false, [client]);
  const requestRepeat = useCallback((id: string) => client?.requestRepeat(id) ?? false, [client]);
  const dismissRepeatRequest = useCallback(
    (id: string) => setRepeatRequests((list) => list.filter((r) => r.phraseId !== id)),
    [],
  );
  const dismissLimit = useCallback(() => setDismissedLimit(state.limit), [state.limit]);

  const visibleState = state.limit && state.limit === dismissedLimit ? { ...state, limit: null } : state;

  return {
    client,
    state: visibleState,
    phrases,
    enabled: state.status === 'connecting' || state.status === 'ready',
    repeatRequests,
    error: state.error,
    enable,
    disable,
    resumeAudio,
    setMode,
    setLanguages,
    setOriginalVolume,
    replay,
    requestRepeat,
    dismissRepeatRequest,
    dismissLimit,
  };
}

const TranslationContext = createContext<UseTranslationResult | null>(null);

export interface TranslationProviderProps extends UseTranslationOptions {
  children?: React.ReactNode;
}

/** Shares one `useTranslation()` with the translation components below it. */
export function TranslationProvider({ children, ...options }: TranslationProviderProps) {
  const value = useTranslation(options);
  return React.createElement(TranslationContext.Provider, { value }, children);
}

export function useTranslationContext(): UseTranslationResult | null {
  return useContext(TranslationContext);
}

/** Prop wins, then context; throws if neither is there. */
export function useResolvedTranslation(prop?: UseTranslationResult | null): UseTranslationResult {
  const ctx = useContext(TranslationContext);
  const value = prop ?? ctx;
  if (!value) {
    throw new Error('PurpleCallio: pass `translation={useTranslation(...)}` or render inside <TranslationProvider>');
  }
  return value;
}
