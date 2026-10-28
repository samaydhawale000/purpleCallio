import { writable, type Readable } from 'svelte/store';

import {
  TranslationClient,
  type TranslationClientConfig,
  type TranslationMode,
  type TranslationOptions,
  type TranslationPhrase,
  type TranslationReady,
  type TranslationRepeatRequest,
  type TranslationState,
} from '@purplecallio/sdk';

export interface CreateTranslationOptions extends Partial<TranslationClientConfig> {
  /** Use an existing client (e.g. `meeting.translation`); otherwise built from `serverUrl` + `token`. */
  client?: TranslationClient;
}

/** Stores + actions around the SDK's `TranslationClient`. Call `destroy()` from `onDestroy()`. */
export interface PurpleCallioTranslation {
  client: TranslationClient;
  state: Readable<TranslationState>;
  phrases: Readable<TranslationPhrase[]>;
  repeatRequests: Readable<TranslationRepeatRequest[]>;
  /** Resolves with `ready`, or `null` on failure (see `$state.error`). */
  enable(options?: TranslationOptions): Promise<TranslationReady | null>;
  /**
   * Turns translation off. With `meeting.translation` that is for the whole
   * call; `{ share: false }` leaves only this participant (e.g. on hang-up).
   */
  disable(options?: { share?: boolean }): void;
  /** "Join translation": retries audio the browser blocked (`$state.audioBlocked`). Call from a click. */
  resumeAudio(): Promise<boolean>;
  setMode(mode: TranslationMode): void;
  setLanguages(languages: { speak?: string; hear?: string }): void;
  setOriginalVolume(volume: number): void;
  replay(phraseId: string, options?: { rate?: number }): boolean;
  requestRepeat(phraseId: string): boolean;
  destroy(): void;
}

export function createTranslation(options: CreateTranslationOptions): PurpleCallioTranslation {
  const owned = !options.client;
  let client: TranslationClient;
  if (options.client) client = options.client;
  else {
    if (!options.serverUrl || !options.token) throw new Error('PurpleCallio: serverUrl and token are required');
    const { client: _c, ...config } = options;
    client = new TranslationClient(config as TranslationClientConfig);
  }

  const state = writable<TranslationState>(client.getState());
  const phrases = writable<TranslationPhrase[]>(client.phrases);
  const repeatRequests = writable<TranslationRepeatRequest[]>([]);
  const offs = [
    client.on('state', (s) => state.set(s)),
    client.on('phrases', (list) => phrases.set(list)),
    client.on('repeat.requested', (r) => repeatRequests.update((list) => [...list.filter((x) => x.phraseId !== r.phraseId), r])),
  ];
  let destroyed = false;

  return {
    client,
    state: { subscribe: state.subscribe },
    phrases: { subscribe: phrases.subscribe },
    repeatRequests: { subscribe: repeatRequests.subscribe },
    enable: (o) => client.enable(o).catch(() => null),
    disable: (o) => client.disable(o),
    resumeAudio: () => client.resumeAudio(),
    setMode: (m) => client.setMode(m),
    setLanguages: (l) => client.setLanguages(l),
    setOriginalVolume: (v) => client.setOriginalVolume(v),
    replay: (id, o) => client.replay(id, o),
    requestRepeat: (id) => client.requestRepeat(id),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offs.forEach((off) => off());
      if (owned) client.disable();
    },
  };
}
