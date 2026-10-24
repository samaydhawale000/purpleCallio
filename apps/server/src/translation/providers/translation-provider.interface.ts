import { EventEmitter } from 'events';

/** See translation/PROTOCOL.md §3. Client audio is always 16 kHz; relay output is always 24 kHz. */
export const TRANSLATION_INPUT_SAMPLE_RATE = 16_000;
export const TRANSLATION_OUTPUT_SAMPLE_RATE = 24_000;

export type TranslationProviderMode = 'captions' | 'voice';

export interface TranslationLexiconHint {
  term: string;
  kind: 'DO_NOT_TRANSLATE' | 'TRANSLATE_AS' | 'PRONOUNCE_AS';
  /** TRANSLATE_AS: the agreed translation in the target language. */
  translation?: string;
  /** PRONOUNCE_AS: spoken hint for speech synthesis. */
  pronunciation?: string;
}

export interface TranslationContext {
  industry?: string;
  purpose?: string;
  speakerRole?: string;
  listenerRole?: string;
}

export interface TranslationConnectConfig {
  /** May be 'auto'. */
  sourceLanguage: string;
  targetLanguage: string;
  mode: TranslationProviderMode;
  lexicon: TranslationLexiconHint[];
  context?: TranslationContext;
}

/** Source-language speech recognition. */
export interface TranscriptEvent {
  text: string;
  final: boolean;
  /** Detected language, when the provider reports it. */
  language?: string;
  /** 0..1, only when the provider exposes a reliable value. */
  confidence?: number;
  alternatives?: string[];
}

/** Target-language text. */
export interface TranslationTextEvent {
  text: string;
  final: boolean;
}

export interface TranslationUsageEvent {
  audioInSeconds?: number;
  audioOutSeconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  characters?: number;
}

/** Stable codes only; provider error text never leaves the provider layer. */
export type TranslationProviderErrorCode =
  | 'TRANSLATION_PROVIDER_UNAVAILABLE'
  | 'TRANSLATION_CONNECTION_FAILED';

export interface TranslationProviderSessionEvents {
  transcript: [event: TranscriptEvent];
  translation: [event: TranslationTextEvent];
  /** PCM16 LE mono @ TRANSLATION_OUTPUT_SAMPLE_RATE (voice mode only). */
  audio: [pcm16: Buffer];
  /** The provider finished the current phrase (text final and audio done). */
  phraseDone: [];
  usage: [event: TranslationUsageEvent];
  error: [code: TranslationProviderErrorCode];
  /** Emitted once, whether closed by us or by the provider. */
  closed: [];
}

export abstract class TranslationProviderSession extends EventEmitter<TranslationProviderSessionEvents> {
  readonly inputSampleRate = TRANSLATION_INPUT_SAMPLE_RATE;
  readonly outputSampleRate = TRANSLATION_OUTPUT_SAMPLE_RATE;

  /** PCM16 LE mono @ 16 kHz. */
  abstract sendAudio(pcm16: Buffer): void;
  /** Commit / flush the current phrase (client VAD saw end of speech). */
  abstract endOfSpeech(): void;
  abstract close(): void;
}

export interface TranslationProvider {
  /** Route id: 'openai-translate' | 'sarvam' | 'mock'. */
  readonly name: string;
  isConfigured(): boolean;
  supports(source: string, target: string, mode: TranslationProviderMode): boolean;
  /** Resolves once the provider accepted the setup; rejects with TranslationProviderError. */
  connect(config: TranslationConnectConfig): Promise<TranslationProviderSession>;
}

export class TranslationProviderError extends Error {
  constructor(public readonly code: TranslationProviderErrorCode) {
    super(code);
    this.name = 'TranslationProviderError';
  }
}
