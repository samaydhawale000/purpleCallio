import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import WebSocket from 'ws';

import { pcm16Seconds, resamplePcm16 } from '../../audio/pcm';
import { getLanguage, normalizeLanguage } from '../../languages';
import {
  TRANSLATION_INPUT_SAMPLE_RATE,
  TRANSLATION_OUTPUT_SAMPLE_RATE,
  TranslationConnectConfig,
  TranslationProvider,
  TranslationProviderError,
  TranslationProviderErrorCode,
  TranslationProviderMode,
  TranslationProviderSession,
} from '../translation-provider.interface';

/**
 * OpenAI dedicated realtime translation sessions (gpt-realtime-translate),
 * raw WebSocket, no SDK. Docs (checked 2026-10-22):
 * - https://developers.openai.com/api/docs/guides/realtime-translation
 * - https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide
 * - https://developers.openai.com/api/docs/models/gpt-realtime-translate
 *
 * Path chosen: the dedicated endpoint `wss://api.openai.com/v1/realtime/translations?model=…`
 * (verified in the guide, the cookbook and the model page, which lists
 * "Realtime translation (v1/realtime/translations)" as its only endpoint), not
 * the GA `/v1/realtime` voice-agent endpoint with a translator prompt.
 *
 * What the endpoint offers, and how this file maps it:
 * - Auth `Authorization: Bearer <key>`; config via `session.update` with
 *   `session.audio.output.language` (target), `audio.input.transcription.model`
 *   (`gpt-realtime-whisper`, enables source transcript deltas) and
 *   `audio.input.noise_reduction`.
 * - Input `session.input_audio_buffer.append` (base64 PCM16 24 kHz); output
 *   `session.output_audio.delta` (base64 PCM16 24 kHz),
 *   `session.output_transcript.delta` (target text),
 *   `session.input_transcript.delta` (source text). `session.close` flushes and
 *   is answered by `session.closed`.
 * - There is NO commit / turn / response lifecycle and NO done events per
 *   phrase: the model translates a continuous stream ("keep appending audio,
 *   including silence between phrases"). Our clients only send audio while
 *   speaking, so endOfSpeech() appends trailing silence to let the model finish,
 *   and the phrase is closed when output goes idle (or after a maximum wait).
 * - No custom prompt / instructions / voice selection ("no custom prompting or
 *   voice selection parameters"), so lexicon and context are NOT sent; the relay
 *   applies PurpleLex post-processing on the text. Captions mode discards audio
 *   (no documented text-only option).
 * - No usage events are documented; pricing is per minute of streamed audio, so
 *   usage reports audio seconds sent (including silence padding) and received.
 */
export const OPENAI_TRANSLATE_URL =
  'wss://api.openai.com/v1/realtime/translations';
export const OPENAI_TRANSLATE_DEFAULT_MODEL = 'gpt-realtime-translate';
export const OPENAI_TRANSLATE_TRANSCRIBE_MODEL = 'gpt-realtime-whisper';
/** PCM16 mono at 24 kHz in both directions. */
export const OPENAI_TRANSLATE_SAMPLE_RATE = 24_000;
/** The 13 output languages listed by the cookbook (checked 2026-10-22). */
export const OPENAI_TRANSLATE_OUTPUT_LANGUAGES = [
  'en',
  'es',
  'pt',
  'fr',
  'ja',
  'ru',
  'zh',
  'de',
  'ko',
  'hi',
  'id',
  'vi',
  'it',
] as const;

export const OPENAI_TRANSLATE_OPTIONS = 'OPENAI_TRANSLATE_OPTIONS';

export interface OpenAiTranslateOptions {
  /** Full endpoint URL; default env OPENAI_TRANSLATE_BASE_URL or OPENAI_TRANSLATE_URL. */
  baseUrl?: string;
  connectTimeoutMs?: number;
  /** Silence appended after endOfSpeech so the model flushes the phrase. */
  trailingSilenceMs?: number;
  /** Phrase is done after this long without output once speech ended. */
  phraseIdleMs?: number;
  /** Upper bound from endOfSpeech to phraseDone. */
  maxPhraseWaitMs?: number;
  /** When the next phrase starts, the previous one closes within this. */
  nextPhraseGraceMs?: number;
}

const DEFAULTS = {
  connectTimeoutMs: 10_000,
  trailingSilenceMs: 1_000,
  phraseIdleMs: 900,
  maxPhraseWaitMs: 6_000,
  nextPhraseGraceMs: 1_500,
};
/** After session.created, accept the session if no session.updated/error follows. */
const READY_GRACE_MS = 1_500;
const SILENCE_CHUNK_MS = 200;

interface ServerEvent {
  type?: string;
  delta?: string;
  error?: { type?: string; code?: string | null };
}

function model(): string {
  return (
    process.env.OPENAI_TRANSLATE_MODEL?.trim() || OPENAI_TRANSLATE_DEFAULT_MODEL
  );
}

@Injectable()
export class OpenAiTranslateProvider implements TranslationProvider {
  readonly name = 'openai-translate';
  private readonly logger = new Logger(OpenAiTranslateProvider.name);
  private readonly options: OpenAiTranslateOptions;

  constructor(
    @Optional()
    @Inject(OPENAI_TRANSLATE_OPTIONS)
    options?: OpenAiTranslateOptions,
  ) {
    this.options = options ?? {};
  }

  /** Read on every call. */
  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  /** Voice and captions come from the same session, so `mode` never narrows support. */
  supports(
    source: string,
    target: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _mode?: TranslationProviderMode,
  ): boolean {
    const t = normalizeLanguage(target);
    if (!t || t === 'auto') return false;
    if (!(OPENAI_TRANSLATE_OUTPUT_LANGUAGES as readonly string[]).includes(t))
      return false;
    const s = normalizeLanguage(source);
    if (s === 'auto') return true;
    // Voice and captions come from the same session, so the mode never narrows support.
    return Boolean(s && getLanguage(s)?.openai.input);
  }

  connect(
    config: TranslationConnectConfig,
  ): Promise<TranslationProviderSession> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      this.logger.error(
        'event=translation_provider_not_configured provider=openai-translate',
      );
      return Promise.reject(
        new TranslationProviderError('TRANSLATION_PROVIDER_UNAVAILABLE'),
      );
    }
    const target = normalizeLanguage(config.targetLanguage);
    if (!target || target === 'auto') {
      return Promise.reject(
        new TranslationProviderError('TRANSLATION_PROVIDER_UNAVAILABLE'),
      );
    }
    const base =
      this.options.baseUrl ||
      process.env.OPENAI_TRANSLATE_BASE_URL?.trim() ||
      OPENAI_TRANSLATE_URL;
    const url = `${base}?model=${encodeURIComponent(model())}`;

    let socket: WebSocket;
    try {
      // The key travels in a header only; never log headers.
      socket = new WebSocket(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch {
      return Promise.reject(
        new TranslationProviderError('TRANSLATION_CONNECTION_FAILED'),
      );
    }
    const session = new OpenAiTranslateSession(
      socket,
      this.logger,
      config.mode,
      { ...DEFAULTS, ...stripUndefined(this.options) },
    );
    return session.open(target);
  }
}

export class OpenAiTranslateSession extends TranslationProviderSession {
  private ready = false;
  private closed = false;
  private closing = false;

  /** Audio sent since the current phrase began (or since the last phraseDone). */
  private phraseActive = false;
  private ending = false;
  private source = '';
  private translated = '';
  private sentSeconds = 0;
  private receivedSeconds = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;
  private maxDeadline = 0;

  constructor(
    private readonly socket: WebSocket,
    private readonly logger: Logger,
    private readonly mode: TranslationProviderMode,
    private readonly opts: Required<Omit<OpenAiTranslateOptions, 'baseUrl'>>,
  ) {
    super();
  }

  open(target: string): Promise<OpenAiTranslateSession> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      let graceTimer: NodeJS.Timeout | null = null;
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        this.ready = true;
        resolve(this);
      };
      const fail = (code: TranslationProviderErrorCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        this.closing = true;
        this.safeClose();
        this.markClosed(false);
        reject(new TranslationProviderError(code));
      };
      const timer = setTimeout(() => {
        this.logger.warn(
          'event=translation_provider_setup_timeout provider=openai-translate',
        );
        fail('TRANSLATION_PROVIDER_UNAVAILABLE');
      }, this.opts.connectTimeoutMs);
      timer.unref?.();

      this.socket.on('unexpected-response', (req, res) => {
        // HTTP refusal of the upgrade (401/403/429/…): the provider is reachable but refused us.
        this.logger.warn(
          `event=translation_provider_refused provider=openai-translate status=${Number(res?.statusCode) || 0}`,
        );
        try {
          req.destroy();
        } catch {
          // ignore
        }
        fail('TRANSLATION_PROVIDER_UNAVAILABLE');
      });
      this.socket.on('open', () => {
        opened = true;
        this.send({
          type: 'session.update',
          session: {
            audio: {
              input: {
                transcription: { model: OPENAI_TRANSLATE_TRANSCRIBE_MODEL },
                noise_reduction: { type: 'near_field' },
              },
              output: { language: target },
            },
          },
        });
      });
      this.socket.on('message', (data) => {
        const event = parse(data);
        if (!event) {
          this.logger.warn(
            'event=translation_provider_bad_message provider=openai-translate',
          );
          return;
        }
        if (!this.ready) {
          if (event.type === 'session.updated') succeed();
          else if (event.type === 'session.created' && !graceTimer) {
            // The translation guide only documents session.created; if no
            // session.updated arrives, accept once no error followed.
            graceTimer = setTimeout(succeed, READY_GRACE_MS);
            graceTimer.unref?.();
          } else if (event.type === 'error') {
            this.logError(event);
            fail('TRANSLATION_PROVIDER_UNAVAILABLE');
          }
          return;
        }
        this.handle(event);
      });
      this.socket.on('error', (err) => {
        // Never log err.message: it can echo request details.
        this.logger.warn(
          `event=translation_provider_socket_error provider=openai-translate error=${safeToken(err?.name)}`,
        );
        if (!this.ready)
          fail(
            opened
              ? 'TRANSLATION_PROVIDER_UNAVAILABLE'
              : 'TRANSLATION_CONNECTION_FAILED',
          );
      });
      this.socket.on('close', (code) => {
        if (!this.ready) {
          this.logger.warn(
            `event=translation_provider_setup_rejected provider=openai-translate closeCode=${Number(code) || 0}`,
          );
          fail(
            opened
              ? 'TRANSLATION_PROVIDER_UNAVAILABLE'
              : 'TRANSLATION_CONNECTION_FAILED',
          );
          return;
        }
        if (!this.closing) {
          this.logger.warn(
            `event=translation_provider_closed provider=openai-translate closeCode=${Number(code) || 0}`,
          );
          this.emitError('TRANSLATION_CONNECTION_FAILED');
        }
        this.markClosed(true);
      });
    });
  }

  sendAudio(pcm16: Buffer): void {
    if (this.closed || !this.ready || pcm16.length < 2) return;
    if (this.ending) {
      // The next phrase began: close the previous one soon.
      this.shortenMaxWait(this.opts.nextPhraseGraceMs);
    } else {
      this.phraseActive = true;
    }
    this.append(
      resamplePcm16(
        pcm16,
        TRANSLATION_INPUT_SAMPLE_RATE,
        OPENAI_TRANSLATE_SAMPLE_RATE,
      ),
    );
    if (this.ending) this.pendingNext = true;
  }

  /** Audio of the next phrase arrived while the previous one was still ending. */
  private pendingNext = false;

  endOfSpeech(): void {
    if (this.closed || !this.ready || !this.phraseActive || this.ending) return;
    this.ending = true;
    // No commit event exists: trailing silence lets the model finish the phrase.
    const chunk = Buffer.alloc(
      Math.round((OPENAI_TRANSLATE_SAMPLE_RATE * SILENCE_CHUNK_MS) / 1000) * 2,
    );
    for (let ms = 0; ms < this.opts.trailingSilenceMs; ms += SILENCE_CHUNK_MS)
      this.append(chunk);
    this.armIdle();
    this.maxDeadline = Date.now() + this.opts.maxPhraseWaitMs;
    this.maxTimer = setTimeout(
      () => this.finishPhrase(),
      this.opts.maxPhraseWaitMs,
    );
    this.maxTimer.unref?.();
  }

  close(): void {
    if (this.closed) return;
    this.closing = true;
    this.send({ type: 'session.close' });
    this.safeClose();
    this.markClosed(true);
  }

  // ── Inbound ──────────────────────────────────────────
  private handle(event: ServerEvent) {
    switch (event.type) {
      case 'session.input_transcript.delta':
        if (!event.delta) return;
        this.source += event.delta;
        this.emit('transcript', { text: this.source.trim(), final: false });
        this.touch();
        return;
      case 'session.output_transcript.delta':
        if (!event.delta) return;
        this.translated += event.delta;
        this.emit('translation', {
          text: this.translated.trim(),
          final: false,
        });
        this.touch();
        return;
      case 'session.output_audio.delta': {
        if (!event.delta) return;
        this.touch();
        // Captions mode: the endpoint always speaks; discard the audio.
        if (this.mode !== 'voice') return;
        const pcm = resamplePcm16(
          Buffer.from(event.delta, 'base64'),
          OPENAI_TRANSLATE_SAMPLE_RATE,
          TRANSLATION_OUTPUT_SAMPLE_RATE,
        );
        this.receivedSeconds += pcm16Seconds(
          pcm,
          TRANSLATION_OUTPUT_SAMPLE_RATE,
        );
        this.emit('audio', pcm);
        return;
      }
      case 'session.closed':
        if (this.ending) this.finishPhrase();
        this.closing = true;
        this.safeClose();
        this.markClosed(true);
        return;
      case 'error':
        this.logError(event);
        // A refused client event leaves the session usable.
        if (event.error?.type === 'invalid_request_error') return;
        this.emitError('TRANSLATION_CONNECTION_FAILED');
        this.closing = true;
        this.safeClose();
        this.markClosed(true);
        return;
      default:
        return;
    }
  }

  /** Output arrived: while the phrase is ending, restart the idle window. */
  private touch() {
    if (this.ending) this.armIdle();
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.finishPhrase(),
      this.opts.phraseIdleMs,
    );
    this.idleTimer.unref?.();
  }

  private shortenMaxWait(ms: number) {
    if (!this.maxTimer || this.maxDeadline - Date.now() <= ms) return;
    clearTimeout(this.maxTimer);
    this.maxDeadline = Date.now() + ms;
    this.maxTimer = setTimeout(() => this.finishPhrase(), ms);
    this.maxTimer.unref?.();
  }

  private finishPhrase() {
    if (!this.ending || this.closed) return;
    this.clearTimers();
    const source = this.source.trim();
    const translated = this.translated.trim();
    this.source = '';
    this.translated = '';
    this.ending = false;
    this.phraseActive = this.pendingNext;
    this.pendingNext = false;
    if (source) this.emit('transcript', { text: source, final: true });
    this.emit('translation', { text: translated, final: true });
    this.emit('usage', {
      audioInSeconds: round3(this.sentSeconds),
      audioOutSeconds: round3(this.receivedSeconds),
    });
    this.sentSeconds = 0;
    this.receivedSeconds = 0;
    this.emit('phraseDone');
  }

  private append(pcm24k: Buffer) {
    this.sentSeconds += pcm16Seconds(pcm24k, OPENAI_TRANSLATE_SAMPLE_RATE);
    this.send({
      type: 'session.input_audio_buffer.append',
      audio: pcm24k.toString('base64'),
    });
  }

  private logError(event: ServerEvent) {
    // type/code are stable identifiers; the message never leaves this layer.
    this.logger.warn(
      `event=translation_provider_error provider=openai-translate type=${safeToken(event.error?.type)} code=${safeToken(event.error?.code)}`,
    );
  }

  private emitError(code: TranslationProviderErrorCode) {
    if (this.listenerCount('error') > 0) this.emit('error', code);
  }

  // ── Plumbing ─────────────────────────────────────────
  private send(message: unknown) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // The close handler reports the failure.
    }
  }

  private safeClose() {
    try {
      if (this.socket.readyState === WebSocket.CONNECTING)
        this.socket.terminate();
      else this.socket.close(1000);
    } catch {
      // Already closed.
    }
  }

  private clearTimers() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.idleTimer = null;
    this.maxTimer = null;
  }

  private markClosed(emit: boolean) {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    if (emit) this.emit('closed');
    this.removeAllListeners();
  }
}

function parse(data: WebSocket.RawData): ServerEvent | null {
  try {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Buffer.from(data).toString('utf8');
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function safeToken(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value)
    ? value
    : 'unknown';
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
