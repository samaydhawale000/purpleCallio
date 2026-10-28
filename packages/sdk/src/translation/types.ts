/**
 * Live Translate types. Mirrors §2 of the server's translation PROTOCOL.md —
 * if this file and the protocol disagree, the protocol wins.
 */

export type TranslationMode = 'off' | 'captions' | 'voice';
export type TranslationRole = 'caller' | 'receiver';

/** Guard reasons from MeaningGuard. Never a percentage. */
export type GuardReason =
  | 'term_mismatch:number'
  | 'term_mismatch:amount'
  | 'term_mismatch:date'
  | 'term_mismatch:phone'
  | 'term_mismatch:lexicon'
  | 'recognition_failed'
  | 'low_asr_confidence'
  | 'asr_alternatives_disagree'
  | 'length_mismatch'
  | 'language_mismatch'
  | 'poor_audio'
  | 'late_translation'
  | 'provider_error'
  | (string & {});

/** One phrase as sent by the relay; repeated with the same `phraseId` as text grows. */
export interface Caption {
  phraseId: string;
  speaker: TranslationRole;
  /** Detected language when the speaker's language is `auto`. */
  sourceLanguage: string;
  targetLanguage: string;
  /** The speaker's own words (speech-to-text). */
  original: string;
  /** May be `''` until the translation arrives. */
  translated: string;
  final: boolean;
  /** Epoch ms of `speech.start`. */
  startedAt: number;
  /** Epoch ms of `speech.end`. */
  endedAt?: number;
  /** Epoch ms the first translated audio chunk was sent. */
  translatedAudioAt?: number;
  guard?: { status: 'ok' | 'uncertain'; reasons: GuardReason[] };
  /** PurpleLex terms enforced on this phrase. */
  lexiconApplied?: string[];
}

/**
 * A DualView phrase: the merged caption plus what happened to it on this
 * device (when its translated audio played, whether a repeat was asked).
 */
export interface TranslationPhrase extends Caption {
  /** True when MeaningGuard marked the phrase uncertain. */
  flagged: boolean;
  /** Epoch ms translated audio for this phrase started playing locally. */
  playedAt?: number;
  /** Epoch ms its translated audio finished playing locally. */
  playedUntil?: number;
  /** True while this phrase's translated (or replayed) audio is playing. */
  playing: boolean;
  /** Epoch ms this device asked the speaker to repeat it. */
  repeatRequestedAt?: number;
  /** Whether this phrase was spoken by this participant. */
  mine: boolean;
}

export interface TranslationLanguagePair {
  speak: string;
  hear: string;
}

export interface TranslationReady {
  role: TranslationRole;
  inputSampleRate: number;
  outputSampleRate: number;
  mode: TranslationMode;
  you: TranslationLanguagePair;
  peer: TranslationLanguagePair | null;
  replayEnabled: boolean;
  guard: { enabled: boolean; sensitivity: string };
  limits: { maxMinutes: number | null; usedSeconds: number };
  trial: boolean;
}

export interface TranslationPeerEvent {
  connected: boolean;
  speak?: string;
  hear?: string;
}

export interface TranslationModeEvent {
  mode: TranslationMode;
  reason?: 'participant' | 'api' | 'limit';
}

export interface TranslationFlaggedEvent {
  phraseId: string;
  reasons: GuardReason[];
}

export interface TranslationRepeatRequest {
  phraseId: string;
  original: string;
  /** Already in the speaker's language. */
  prompt: string;
}

export interface TranslationLimitEvent {
  kind: 'warning' | 'stepped_down' | 'paused';
  scope: 'call' | 'budget' | 'credits';
  message: string;
  remainingSeconds?: number;
}

export interface TranslationEndedEvent {
  /**
   * Server reason, or `participant` (you called `disable()`), `switched_off`
   * (the other participant turned the call's translation off), `disconnected`, `error`.
   */
  reason: string;
}

/** `Error` with a stable `code`, e.g. `TRANSLATION_NOT_IN_PLAN`. */
export interface TranslationError extends Error {
  code: string;
}

export type TranslationStatus = 'idle' | 'connecting' | 'ready' | 'ended';

export interface TranslationState {
  status: TranslationStatus;
  mode: TranslationMode;
  role: TranslationRole | null;
  you: TranslationLanguagePair;
  peer: (TranslationLanguagePair & { connected: boolean }) | null;
  replayEnabled: boolean;
  guard: { enabled: boolean; sensitivity: string } | null;
  limits: { maxMinutes: number | null; usedSeconds: number } | null;
  trial: boolean;
  /** Local VAD says you are speaking (audio is being sent). */
  speaking: boolean;
  /** Phrase whose translated / replayed audio is playing now. */
  playingPhraseId: string | null;
  /**
   * Volume (0..1) of the other participant's original voice while their
   * speech is being translated for you in voice mode. 0 (default) mutes it.
   */
  originalVolume: number;
  /**
   * The browser is blocking audio (translation started without a user
   * gesture). Show a "Join translation" button that calls `enable()`.
   */
  audioBlocked: boolean;
  /** Most recent CostGuard event, cleared on the next `ready`. */
  limit: TranslationLimitEvent | null;
  error: TranslationError | null;
}

export interface TranslationPlaybackEvent {
  /** `null` when nothing is playing any more. */
  phraseId: string | null;
  replay: boolean;
}

export interface TranslationEventMap {
  ready: TranslationReady;
  /** The merged phrase after every caption update. */
  caption: TranslationPhrase;
  flagged: TranslationPhrase;
  'repeat.requested': TranslationRepeatRequest;
  limit: TranslationLimitEvent;
  mode: TranslationModeEvent;
  peer: TranslationPeerEvent;
  playback: TranslationPlaybackEvent;
  speaking: boolean;
  /** The whole DualView history after any change (caption, flag, playback, repeat). */
  phrases: TranslationPhrase[];
  error: TranslationError;
  ended: TranslationEndedEvent;
  state: TranslationState;
}

export type TranslationEvent = keyof TranslationEventMap;

/** Minimal Socket.IO surface the client uses (lets tests pass a fake). */
export interface TranslationSocketLike {
  readonly connected: boolean;
  on(event: string, handler: (...args: any[]) => void): unknown;
  emit(event: string, ...args: any[]): unknown;
  connect(): unknown;
  disconnect(): unknown;
  removeAllListeners(): unknown;
}

export type TranslationSocketFactory = (
  url: string,
  options: { auth: { token: string }; transports: string[]; path?: string; autoConnect: boolean },
) => TranslationSocketLike;

export type RemoteAudioTarget =
  | HTMLMediaElement
  | null
  | Iterable<HTMLMediaElement | null | undefined>
  | (() => Iterable<HTMLMediaElement | null | undefined> | HTMLMediaElement | null | undefined);

export interface TranslationOptions {
  /** Language you speak (`auto` to detect). */
  speak?: string;
  /** Language you want to hear. */
  hear?: string;
  /** Default `voice`. */
  mode?: TranslationMode;
  /**
   * Language the other participant speaks. When you turn translation on
   * and they haven't joined it yet, it becomes their language for the call.
   */
  peerLanguage?: string;
  /**
   * Volume (0..1) of the other participant's original voice while their
   * speech is translated for you in voice mode. Default 0 (muted).
   */
  originalVolume?: number;
}

/** A user turned translation on or off (see `TranslationClientConfig.shareSwitch`). */
export interface TranslationSwitchChange {
  mode: TranslationMode;
  /** Your languages, when turning on. */
  speak?: string;
  hear?: string;
  /** `peerLanguage`, when given and the other participant isn't in translation yet. */
  peerLanguage?: string;
  /** The other participant is already in translation (keep their languages). */
  peerPresent: boolean;
}

export interface TranslationClientConfig extends TranslationOptions {
  /**
   * PurpleCallio server origin, e.g. `https://api.example.com`. The client
   * connects to its `/translate` Socket.IO namespace; a trailing `/api` or
   * `/translate` is ignored.
   */
  serverUrl: string;
  /** The participant's call session token (`bj_session_…`), the same one used for the call. */
  token: string;
  /** Element(s) playing the other participant's original audio; held down while it is translated for you. */
  remoteAudio?: RemoteAudioTarget;
  /**
   * Mic to translate. Defaults to opening one with echo cancellation on.
   * Pass the call's own local stream to avoid a second mic; it is never stopped by this client.
   */
  stream?: MediaStream | null | (() => MediaStream | null | undefined);
  /** Socket.IO path, if your proxy serves it somewhere other than `/socket.io`. */
  socketPath?: string;
  /** How long `enable()` waits for `ready`. Default 15 s. */
  connectTimeoutMs?: number;
  /** Voice activity detection tuning. */
  vad?: Partial<VadOptions>;
  /** Advanced/testing: build the socket yourself. */
  socketFactory?: TranslationSocketFactory;
  /** Keep at most this many phrases in history. Default 500. */
  maxPhrases?: number;
  /**
   * Makes `enable()` / `disable()` one switch for the whole call: called
   * after you turn translation on (once ready) or off, so the other
   * participant can follow (`followCall()`). `meeting.translation` sets this.
   * A rejection surfaces as an `error` event; local translation stays as is.
   */
  shareSwitch?: (change: TranslationSwitchChange) => Promise<void>;
}

export interface VadOptions {
  /** Frame length in ms (frames are fed at this cadence). Default 20. */
  frameMs: number;
  /** Minimum RMS (0..1) counted as speech. Default 0.012. */
  threshold: number;
  /** Above-threshold time before `speech.start`. Default 60 ms. */
  onsetMs: number;
  /** Silence before `speech.end`. Default 600 ms. */
  hangoverMs: number;
  /** Audio kept from before the onset and sent with it. Default 200 ms. */
  prerollMs: number;
  /** A phrase longer than this is cut (end + start). Default 30 s. */
  maxPhraseMs: number;
}

/** `GET /translation/languages` entry. */
export interface TranslationLanguage {
  code: string;
  name: string;
  nativeName: string;
  /** ISO 15924 script code, e.g. `Deva`, `Taml`, `Arab`, `Latn`. */
  script: string;
  rtl: boolean;
  voice: boolean;
  captions: boolean;
  routes?: string[];
}

export interface TranslationLanguagesResponse {
  languages: TranslationLanguage[];
  pairs?: string;
}
