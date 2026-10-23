import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import WebSocket from 'ws';

import {
  pcm16Seconds,
  pcm16ToWav,
  resamplePcm16,
  wavToPcm16,
} from '../../audio/pcm';
import {
  fromSarvamCode,
  getLanguage,
  normalizeLanguage,
  toSarvamCode,
} from '../../languages';
import {
  TRANSLATION_INPUT_SAMPLE_RATE,
  TRANSLATION_OUTPUT_SAMPLE_RATE,
  TranslationConnectConfig,
  TranslationLexiconHint,
  TranslationProvider,
  TranslationProviderError,
  TranslationProviderErrorCode,
  TranslationProviderMode,
  TranslationProviderSession,
} from '../translation-provider.interface';

/**
 * Sarvam AI cascade: streaming STT (Saaras) → text translate → TTS (Bulbul).
 * Docs (checked 2026-10-22):
 * - STT WebSocket: https://docs.sarvam.ai/api-reference/speech-to-text/transcribe/ws
 *   `wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v4&language-code=…&sample_rate=16000
 *   &input_audio_codec=pcm_s16le&flush_signal=true`, header `Api-Subscription-Key`.
 *   Client `{ audio: { data, sample_rate, encoding: 'audio/wav' } }` and `{ type: 'flush' }`;
 *   server `{ type: 'data', data: { transcript, language_code, language_probability, metrics } }`,
 *   `{ type: 'error', data: { error, code } }`, `{ type: 'events', … }`.
 * - STT REST (fallback): https://docs.sarvam.ai/api-reference/speech-to-text/transcribe
 *   `POST /speech-to-text` multipart (`file`, `model`, `language_code`, `keyterms` (v4 only)).
 * - Translate: https://docs.sarvam.ai/api-reference/text/translate-text
 *   `POST /translate` `{ input, source_language_code, target_language_code, model }`,
 *   `sarvam-translate:v1` (22 + en, 2000 chars, no 'auto') / `mayura:v1` (11, 1000 chars, 'auto').
 *   No glossary parameter exists, so lexicon terms are not sent (the relay post-processes).
 * - TTS: https://docs.sarvam.ai/api-reference/text-to-speech/convert
 *   `POST /text-to-speech` `{ text, language_code, speaker, model: 'bulbul:v3',
 *   speech_sample_rate: 24000, output_audio_codec: 'wav' }` → `{ audios: [base64 WAV] }`.
 *   The TTS WebSocket (https://docs.sarvam.ai/api-reference/text-to-speech/stream) documents
 *   its codec as "currently supports MP3 only", which we can't decode without a new
 *   dependency, so REST WAV is used (a phrase is one short request anyway).
 *
 * Unverified (no live key in this environment):
 * - whether STT WS `data` messages are partial or per-VAD-segment (we treat each as a
 *   segment and accumulate them) and that a flush is always answered by a `data` message
 *   (a timeout falls back to REST with the buffered phrase audio);
 * - the `keyterms` query-parameter encoding on the WS (we send the REST JSON-array form).
 * `language_probability` is a language-ID score, not ASR confidence, so it is not
 * reported as `confidence`.
 */
export const SARVAM_BASE_URL = 'https://api.sarvam.ai';
export const SARVAM_STT_MODEL = 'saaras:v4';
export const SARVAM_TRANSLATE_MODEL = 'sarvam-translate:v1';
export const SARVAM_TRANSLATE_AUTO_MODEL = 'mayura:v1';
export const SARVAM_TTS_MODEL = 'bulbul:v3';
export const SARVAM_TTS_DEFAULT_SPEAKER = 'shubh';
export const SARVAM_OPTIONS = 'SARVAM_OPTIONS';

export interface SarvamOptions {
  /** REST base; default env SARVAM_BASE_URL or https://api.sarvam.ai. */
  baseUrl?: string;
  /** WebSocket base; default derived from baseUrl (http→ws). */
  wsBaseUrl?: string;
  /** Use the streaming STT WebSocket (default true; env SARVAM_STREAMING_STT=false disables). */
  streamingStt?: boolean;
  fetch?: typeof fetch;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Max wait for the STT flush answer before falling back to REST. */
  flushTimeoutMs?: number;
  /** After a flush answer, wait this long for further segments. */
  flushSettleMs?: number;
  speaker?: string;
}

const DEFAULTS = {
  connectTimeoutMs: 10_000,
  requestTimeoutMs: 15_000,
  flushTimeoutMs: 2_500,
  flushSettleMs: 250,
};
/** REST STT is for audio under 30 s. */
const MAX_PHRASE_BYTES = TRANSLATION_INPUT_SAMPLE_RATE * 2 * 30;
/** 100 ms of 24 kHz PCM16. */
const OUT_CHUNK_BYTES = (TRANSLATION_OUTPUT_SAMPLE_RATE / 10) * 2;
const MAX_KEYTERMS = 50;

type Fetch = typeof fetch;

@Injectable()
export class SarvamProvider implements TranslationProvider {
  readonly name = 'sarvam';
  private readonly logger = new Logger(SarvamProvider.name);
  private readonly options: SarvamOptions;

  constructor(@Optional() @Inject(SARVAM_OPTIONS) options?: SarvamOptions) {
    this.options = options ?? {};
  }

  isConfigured(): boolean {
    return Boolean(process.env.SARVAM_API_KEY?.trim());
  }

  /** Indian↔Indian and Indian↔English; voice only when Bulbul speaks the target. */
  supports(
    source: string,
    target: string,
    mode: TranslationProviderMode,
  ): boolean {
    const t = getLanguage(target);
    if (!t || !t.sarvam.translate) return false;
    if (mode === 'voice' && !t.sarvam.tts) return false;
    const s = normalizeLanguage(source);
    if (s === 'auto') return true;
    const sl = s ? getLanguage(s) : null;
    if (!sl || !sl.sarvam.stt || !sl.sarvam.translate) return false;
    return sl.indic || t.indic;
  }

  async connect(
    config: TranslationConnectConfig,
  ): Promise<TranslationProviderSession> {
    const apiKey = process.env.SARVAM_API_KEY?.trim();
    if (!apiKey) {
      this.logger.error(
        'event=translation_provider_not_configured provider=sarvam',
      );
      throw new TranslationProviderError('TRANSLATION_PROVIDER_UNAVAILABLE');
    }
    const target = normalizeLanguage(config.targetLanguage);
    const source = normalizeLanguage(config.sourceLanguage) ?? 'auto';
    if (!target || target === 'auto' || !toSarvamCode(target)) {
      throw new TranslationProviderError('TRANSLATION_PROVIDER_UNAVAILABLE');
    }
    const baseUrl = (
      this.options.baseUrl ||
      process.env.SARVAM_BASE_URL?.trim() ||
      SARVAM_BASE_URL
    ).replace(/\/+$/, '');
    const wsBaseUrl = (
      this.options.wsBaseUrl || baseUrl.replace(/^http/, 'ws')
    ).replace(/\/+$/, '');
    const streaming =
      this.options.streamingStt ??
      process.env.SARVAM_STREAMING_STT?.trim().toLowerCase() !== 'false';
    const voice =
      config.mode === 'voice' && Boolean(getLanguage(target)?.sarvam.tts);

    const session = new SarvamSession(this.logger, {
      apiKey,
      baseUrl,
      fetch: this.options.fetch ?? fetch,
      source,
      target,
      voice,
      speaker:
        this.options.speaker ||
        process.env.SARVAM_TTS_SPEAKER?.trim() ||
        SARVAM_TTS_DEFAULT_SPEAKER,
      lexicon: config.lexicon ?? [],
      requestTimeoutMs:
        this.options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
      flushTimeoutMs: this.options.flushTimeoutMs ?? DEFAULTS.flushTimeoutMs,
      flushSettleMs: this.options.flushSettleMs ?? DEFAULTS.flushSettleMs,
    });
    if (streaming) {
      const params = new URLSearchParams({
        model: SARVAM_STT_MODEL,
        'language-code':
          source === 'auto' ? 'unknown' : (toSarvamCode(source) ?? 'unknown'),
        sample_rate: String(TRANSLATION_INPUT_SAMPLE_RATE),
        input_audio_codec: 'pcm_s16le',
        flush_signal: 'true',
      });
      const terms = keyterms(config.lexicon ?? []);
      if (terms.length) params.set('keyterms', JSON.stringify(terms));
      await session.openStream(
        `${wsBaseUrl}/speech-to-text/ws?${params.toString()}`,
        this.options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
      );
    }
    return session;
  }
}

interface SessionConfig {
  apiKey: string;
  baseUrl: string;
  fetch: Fetch;
  source: string;
  target: string;
  voice: boolean;
  speaker: string;
  lexicon: TranslationLexiconHint[];
  requestTimeoutMs: number;
  flushTimeoutMs: number;
  flushSettleMs: number;
}

interface SttResult {
  text: string;
  language: string | null;
}

class Phrase {
  readonly chunks: Buffer[] = [];
  bytes = 0;
  readonly segments: string[] = [];
  language: string | null = null;
  settled = false;
  flushTimer: NodeJS.Timeout | null = null;
  settleTimer: NodeJS.Timeout | null = null;
  resolve!: (r: SttResult) => void;
  reject!: (e: unknown) => void;
  readonly transcript: Promise<SttResult>;

  constructor() {
    this.transcript = new Promise<SttResult>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    this.transcript.catch(() => undefined);
  }

  get audioSeconds() {
    return this.bytes / 2 / TRANSLATION_INPUT_SAMPLE_RATE;
  }

  text() {
    return this.segments.join(' ').replace(/\s+/g, ' ').trim();
  }

  audio() {
    return Buffer.concat(this.chunks);
  }

  clearTimers() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.flushTimer = null;
    this.settleTimer = null;
  }
}

class HttpFailure extends Error {
  constructor(readonly code: TranslationProviderErrorCode) {
    super(code);
  }
}

export class SarvamSession extends TranslationProviderSession {
  private closed = false;
  private ws: WebSocket | null = null;
  private wsAlive = false;
  private current: Phrase | null = null;
  /** Phrases flushed on the STT stream, waiting for their answer (FIFO). */
  private readonly awaitingFlush: Phrase[] = [];
  /** Phrases not yet fully emitted, oldest first. */
  private readonly unfinished: Phrase[] = [];
  private chain: Promise<void> = Promise.resolve();
  private readonly abort = new AbortController();

  constructor(
    private readonly logger: Logger,
    private readonly cfg: SessionConfig,
  ) {
    super();
  }

  // ── Streaming STT ────────────────────────────────────
  openStream(url: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url, {
        headers: { 'Api-Subscription-Key': this.cfg.apiKey },
      });
      this.ws = ws;
      const done = (code?: TranslationProviderErrorCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!code) return resolve();
        this.terminateWs();
        this.closed = true;
        this.abort.abort();
        reject(new TranslationProviderError(code));
      };
      const timer = setTimeout(() => {
        this.logger.warn(
          'event=translation_provider_setup_timeout provider=sarvam',
        );
        done('TRANSLATION_PROVIDER_UNAVAILABLE');
      }, timeoutMs);
      timer.unref?.();

      ws.on('unexpected-response', (req, res) => {
        this.logger.warn(
          `event=translation_provider_refused provider=sarvam status=${Number(res?.statusCode) || 0}`,
        );
        try {
          req.destroy();
        } catch {
          // ignore
        }
        done('TRANSLATION_PROVIDER_UNAVAILABLE');
      });
      ws.on('open', () => {
        this.wsAlive = true;
        done();
      });
      ws.on('message', (data) => this.onStreamMessage(data));
      ws.on('error', (err) => {
        this.logger.warn(
          `event=translation_provider_socket_error provider=sarvam error=${safeToken(err?.name)}`,
        );
        if (!settled) done('TRANSLATION_CONNECTION_FAILED');
      });
      ws.on('close', (code) => {
        const wasAlive = this.wsAlive;
        this.wsAlive = false;
        if (!settled) {
          done('TRANSLATION_CONNECTION_FAILED');
          return;
        }
        if (wasAlive && !this.closed) {
          // Keep translating: later phrases use REST STT.
          this.logger.warn(
            `event=translation_stt_stream_closed provider=sarvam closeCode=${Number(code) || 0}`,
          );
        }
        for (const p of this.awaitingFlush.splice(0)) this.flushTimedOut(p);
      });
    });
  }

  private onStreamMessage(raw: WebSocket.RawData) {
    if (this.closed) return;
    let msg: {
      type?: string;
      data?: {
        transcript?: string;
        language_code?: string | null;
        code?: string;
      };
    };
    try {
      msg = JSON.parse(rawToString(raw)) as typeof msg;
    } catch {
      this.logger.warn(
        'event=translation_provider_bad_message provider=sarvam',
      );
      return;
    }
    if (msg?.type === 'error') {
      this.logger.warn(
        `event=translation_provider_error provider=sarvam op=stt code=${safeToken(msg.data?.code)}`,
      );
      return;
    }
    if (msg?.type !== 'data' || !msg.data) return;
    const text =
      typeof msg.data.transcript === 'string' ? msg.data.transcript.trim() : '';
    const flushed = this.awaitingFlush[0];
    const phrase = flushed ?? this.current;
    if (!phrase) return;
    if (text) phrase.segments.push(text);
    if (msg.data.language_code) phrase.language = msg.data.language_code;
    if (flushed) {
      if (flushed.settleTimer) clearTimeout(flushed.settleTimer);
      flushed.settleTimer = setTimeout(
        () => this.flushAnswered(flushed),
        this.cfg.flushSettleMs,
      );
      flushed.settleTimer.unref?.();
    } else if (text && this.unfinished[0] === phrase) {
      // Partials only for the phrase being emitted, so outputs stay in order.
      this.emit('transcript', {
        text: phrase.text(),
        final: false,
        ...(lang(phrase.language) ? { language: lang(phrase.language)! } : {}),
      });
    }
  }

  private flushAnswered(phrase: Phrase) {
    const i = this.awaitingFlush.indexOf(phrase);
    if (i >= 0) this.awaitingFlush.splice(i, 1);
    this.settleStt(phrase, { text: phrase.text(), language: phrase.language });
  }

  /** No answer to the flush: use what the stream gave, else transcribe via REST. */
  private flushTimedOut(phrase: Phrase) {
    const i = this.awaitingFlush.indexOf(phrase);
    if (i >= 0) this.awaitingFlush.splice(i, 1);
    if (phrase.settled) return;
    if (phrase.text()) {
      this.settleStt(phrase, {
        text: phrase.text(),
        language: phrase.language,
      });
      return;
    }
    this.restStt(phrase).then(
      (r) => this.settleStt(phrase, r),
      (e) => this.failStt(phrase, e),
    );
  }

  private settleStt(phrase: Phrase, r: SttResult) {
    if (phrase.settled) return;
    phrase.settled = true;
    phrase.clearTimers();
    phrase.resolve(r);
  }

  private failStt(phrase: Phrase, e: unknown) {
    if (phrase.settled) return;
    phrase.settled = true;
    phrase.clearTimers();
    phrase.reject(e);
  }

  // ── Session API ──────────────────────────────────────
  sendAudio(pcm16: Buffer): void {
    if (this.closed || pcm16.length < 2) return;
    if (!this.current) {
      this.current = new Phrase();
      this.unfinished.push(this.current);
    }
    const phrase = this.current;
    if (phrase.bytes + pcm16.length <= MAX_PHRASE_BYTES) {
      phrase.chunks.push(pcm16);
      phrase.bytes += pcm16.length;
    }
    if (this.wsAlive && this.ws?.readyState === WebSocket.OPEN) {
      this.wsSend({
        audio: {
          data: pcm16.toString('base64'),
          sample_rate: String(TRANSLATION_INPUT_SAMPLE_RATE),
          encoding: 'audio/wav',
        },
      });
    }
  }

  endOfSpeech(): void {
    const phrase = this.current;
    if (this.closed || !phrase) return;
    this.current = null;

    if (this.wsAlive && this.ws?.readyState === WebSocket.OPEN) {
      this.awaitingFlush.push(phrase);
      this.wsSend({ type: 'flush' });
      phrase.flushTimer = setTimeout(
        () => this.flushTimedOut(phrase),
        this.cfg.flushTimeoutMs,
      );
      phrase.flushTimer.unref?.();
    } else {
      this.restStt(phrase).then(
        (r) => this.settleStt(phrase, r),
        (e) => this.failStt(phrase, e),
      );
    }

    // Stages run as soon as their input is ready; emission is serialized.
    const sttP = phrase.transcript;
    const trP = sttP.then((stt) => this.translate(stt));
    const ttsP = this.cfg.voice
      ? trP.then((tr) =>
          tr.text ? this.tts(tr.text) : { pcm: Buffer.alloc(0), characters: 0 },
        )
      : Promise.resolve(null);
    trP.catch(() => undefined);
    ttsP.catch(() => undefined);
    this.chain = this.chain.then(() =>
      this.emitPhrase(phrase, sttP, trP, ttsP),
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    for (const p of this.unfinished) p.clearTimers();
    this.terminateWs();
    this.emit('closed');
    this.removeAllListeners();
  }

  // ── Emission (in phrase order) ───────────────────────
  private async emitPhrase(
    phrase: Phrase,
    sttP: Promise<SttResult>,
    trP: Promise<{ text: string; characters: number }>,
    ttsP: Promise<{ pcm: Buffer; characters: number } | null>,
  ): Promise<void> {
    let characters = 0;
    let audioOutSeconds = 0;
    try {
      let stt: SttResult;
      try {
        stt = await sttP;
      } catch (e) {
        return this.fail(e);
      }
      if (this.closed) return;
      const language =
        lang(stt.language) ??
        (this.cfg.source !== 'auto' ? this.cfg.source : null);
      this.emit('transcript', {
        text: stt.text,
        final: true,
        ...(language ? { language } : {}),
      });

      let tr: { text: string; characters: number };
      try {
        tr = await trP;
      } catch (e) {
        return this.fail(e);
      }
      if (this.closed) return;
      characters += tr.characters;
      this.emit('translation', { text: tr.text, final: true });

      let speech: { pcm: Buffer; characters: number } | null = null;
      try {
        speech = await ttsP;
      } catch (e) {
        this.fail(e);
      }
      if (this.closed) return;
      if (speech) {
        characters += speech.characters;
        audioOutSeconds = pcm16Seconds(
          speech.pcm,
          TRANSLATION_OUTPUT_SAMPLE_RATE,
        );
        for (let o = 0; o < speech.pcm.length; o += OUT_CHUNK_BYTES) {
          this.emit(
            'audio',
            speech.pcm.subarray(
              o,
              Math.min(speech.pcm.length, o + OUT_CHUNK_BYTES),
            ),
          );
        }
      }
    } finally {
      const i = this.unfinished.indexOf(phrase);
      if (i >= 0) this.unfinished.splice(i, 1);
      if (!this.closed) {
        this.emit('usage', {
          audioInSeconds: round3(phrase.audioSeconds),
          ...(audioOutSeconds
            ? { audioOutSeconds: round3(audioOutSeconds) }
            : {}),
          characters,
        });
        this.emit('phraseDone');
      }
    }
  }

  private fail(e: unknown) {
    if (this.closed) return;
    const code: TranslationProviderErrorCode =
      e instanceof HttpFailure ? e.code : 'TRANSLATION_CONNECTION_FAILED';
    if (this.listenerCount('error') > 0) this.emit('error', code);
  }

  // ── REST calls ───────────────────────────────────────
  private async restStt(phrase: Phrase): Promise<SttResult> {
    const audio = phrase.audio();
    if (audio.length < 2) return { text: '', language: null };
    const form = new FormData();
    form.append(
      'file',
      new Blob(
        [new Uint8Array(pcm16ToWav(audio, TRANSLATION_INPUT_SAMPLE_RATE))],
        { type: 'audio/wav' },
      ),
      'phrase.wav',
    );
    form.append('model', SARVAM_STT_MODEL);
    form.append(
      'language_code',
      this.cfg.source === 'auto'
        ? 'unknown'
        : (toSarvamCode(this.cfg.source) ?? 'unknown'),
    );
    const terms = keyterms(this.cfg.lexicon);
    if (terms.length) form.append('keyterms', JSON.stringify(terms));
    const body = await this.request('stt', '/speech-to-text', form);
    return {
      text: typeof body.transcript === 'string' ? body.transcript.trim() : '',
      language:
        typeof body.language_code === 'string' ? body.language_code : null,
    };
  }

  private async translate(
    stt: SttResult,
  ): Promise<{ text: string; characters: number }> {
    if (!stt.text) return { text: '', characters: 0 };
    const source =
      lang(stt.language) ??
      (this.cfg.source !== 'auto' ? this.cfg.source : null);
    if (source === this.cfg.target) return { text: stt.text, characters: 0 };
    const sourceCode = source ? toSarvamCode(source) : null;
    const model = sourceCode
      ? SARVAM_TRANSLATE_MODEL
      : SARVAM_TRANSLATE_AUTO_MODEL;
    const parts = splitText(stt.text, sourceCode ? 1900 : 950);
    const out: string[] = [];
    for (const input of parts) {
      const body = await this.request('translate', '/translate', {
        input,
        source_language_code: sourceCode ?? 'auto',
        target_language_code: toSarvamCode(this.cfg.target),
        model,
        numerals_format: 'international',
      });
      out.push(
        typeof body.translated_text === 'string'
          ? body.translated_text.trim()
          : '',
      );
    }
    return { text: out.join(' ').trim(), characters: stt.text.length };
  }

  private async tts(
    text: string,
  ): Promise<{ pcm: Buffer; characters: number }> {
    const spoken = applyPronunciations(text, this.cfg.lexicon);
    const pcms: Buffer[] = [];
    for (const part of splitText(spoken, 2000)) {
      const body = await this.request('tts', '/text-to-speech', {
        text: part,
        language_code: toSarvamCode(this.cfg.target),
        speaker: this.cfg.speaker,
        model: SARVAM_TTS_MODEL,
        speech_sample_rate: TRANSLATION_OUTPUT_SAMPLE_RATE,
        output_audio_codec: 'wav',
      });
      const audios: unknown[] = Array.isArray(body.audios)
        ? (body.audios as unknown[])
        : [];
      for (const a of audios) {
        if (typeof a !== 'string') continue;
        const wav = wavToPcm16(Buffer.from(a, 'base64'));
        if (!wav) {
          this.logger.warn(
            'event=translation_provider_bad_audio provider=sarvam',
          );
          continue;
        }
        pcms.push(
          resamplePcm16(
            wav.pcm,
            wav.sampleRate,
            TRANSLATION_OUTPUT_SAMPLE_RATE,
          ),
        );
      }
    }
    return { pcm: Buffer.concat(pcms), characters: spoken.length };
  }

  private async request(
    op: string,
    path: string,
    body: FormData | Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.closed) throw new HttpFailure('TRANSLATION_CONNECTION_FAILED');
    const isForm = body instanceof FormData;
    let res: Response;
    try {
      res = await this.cfg.fetch(`${this.cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'api-subscription-key': this.cfg.apiKey,
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        },
        body: isForm ? body : JSON.stringify(body),
        signal: AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(this.cfg.requestTimeoutMs),
        ]),
      });
    } catch (err) {
      if (!this.closed) {
        this.logger.warn(
          `event=translation_provider_http_error provider=sarvam op=${op} error=${safeToken((err as Error)?.name)}`,
        );
      }
      throw new HttpFailure('TRANSLATION_CONNECTION_FAILED');
    }
    if (!res.ok) {
      // Status only: the body can echo request details.
      this.logger.warn(
        `event=translation_provider_http_error provider=sarvam op=${op} status=${res.status}`,
      );
      throw new HttpFailure('TRANSLATION_PROVIDER_UNAVAILABLE');
    }
    try {
      const data: unknown = await res.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('not an object');
      }
      return data as Record<string, unknown>;
    } catch {
      this.logger.warn(
        `event=translation_provider_bad_message provider=sarvam op=${op}`,
      );
      throw new HttpFailure('TRANSLATION_PROVIDER_UNAVAILABLE');
    }
  }

  // ── Plumbing ─────────────────────────────────────────
  private wsSend(message: unknown) {
    try {
      this.ws?.send(JSON.stringify(message));
    } catch {
      // The close handler switches to REST.
    }
  }

  private terminateWs() {
    const ws = this.ws;
    this.ws = null;
    this.wsAlive = false;
    if (!ws) return;
    try {
      ws.removeAllListeners('message');
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else ws.close(1000);
    } catch {
      // Already closed.
    }
  }
}

/** Lexicon terms the recognizer should expect (STT `keyterms`, ≤50 × ≤64 chars). */
function keyterms(lexicon: TranslationLexiconHint[]): string[] {
  const out: string[] = [];
  for (const h of lexicon) {
    const t = h.term?.trim();
    if (t && t.length <= 64 && !out.includes(t)) out.push(t);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

/** PRONOUNCE_AS hints rewrite the text sent to TTS only (captions keep the term). */
export function applyPronunciations(
  text: string,
  lexicon: TranslationLexiconHint[],
): string {
  let out = text;
  for (const h of lexicon) {
    if (
      h.kind !== 'PRONOUNCE_AS' ||
      !h.term?.trim() ||
      !h.pronunciation?.trim()
    )
      continue;
    out = out.replace(
      new RegExp(escapeRegExp(h.term.trim()), 'gi'),
      h.pronunciation.trim(),
    );
  }
  return out;
}

/** Splits on sentence ends (then spaces) so each part fits an API limit. */
export function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?।॥]+[.!?।॥]*\s*/g) ?? [text];
  const parts: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) parts.push(cur.trim());
    cur = '';
  };
  for (const s of sentences) {
    if ((cur + s).length <= max) {
      cur += s;
      continue;
    }
    push();
    let rest = s;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  push();
  return parts;
}

function lang(code: string | null | undefined): string | null {
  return fromSarvamCode(code);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rawToString(data: WebSocket.RawData): string {
  return Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : Buffer.from(data).toString('utf8');
}

function safeToken(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value)
    ? value
    : 'unknown';
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
