import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

import { pcm16Seconds } from '../../audio/pcm';
import { getLanguage, normalizeLanguage } from '../../languages';
import {
  TRANSLATION_INPUT_SAMPLE_RATE,
  TRANSLATION_OUTPUT_SAMPLE_RATE,
  TranslationConnectConfig,
  TranslationProvider,
  TranslationProviderError,
  TranslationProviderMode,
  TranslationProviderSession,
} from '../translation-provider.interface';

/** Official Soniox realtime endpoints and currently documented model ids. */
export const SONIOX_STT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export const SONIOX_TTS_URL = 'wss://tts-rt.soniox.com/tts-websocket';
export const SONIOX_STT_MODEL = 'stt-rt-v5';
export const SONIOX_TTS_MODEL = 'tts-rt-v2';
const CONNECT_TIMEOUT_MS = 10_000;
/** Soniox ends a stream after 20 s without audio or a keepalive. */
const KEEPALIVE_MS = 8_000;
/** A phrase whose translation never finalizes after an endpoint is closed with what arrived. */
const PHRASE_SETTLE_MS = 1_500;
/** Marker tokens: `<end>` (endpoint detection) and `<fin>` (manual finalize). */
const BOUNDARY_TOKENS = new Set(['<end>', '<fin>']);

type Token = {
  text?: string;
  is_final?: boolean;
  language?: string;
  confidence?: number;
  translation_status?: 'none' | 'original' | 'translation';
};

/**
 * Backend-only Soniox STT+translation+TTS bridge.  Each relay direction owns
 * one STT socket, so caller→receiver and receiver→caller never share source
 * audio or playback.  Translation audio is emitted only by the relay to the
 * listening participant, which prevents it being captured as source audio.
 */
@Injectable()
export class SonioxProvider implements TranslationProvider {
  readonly name = 'soniox';
  private readonly logger = new Logger(SonioxProvider.name);

  isConfigured(): boolean {
    return Boolean(process.env.SONIOX_API_KEY?.trim());
  }

  supports(source: string, target: string, _mode: TranslationProviderMode): boolean {
    const s = normalizeLanguage(source);
    const t = normalizeLanguage(target);
    return Boolean(t && t !== 'auto' && (s === 'auto' || s) && getLanguage(t));
  }

  async connect(config: TranslationConnectConfig): Promise<TranslationProviderSession> {
    const apiKey = process.env.SONIOX_API_KEY?.trim();
    const source = normalizeLanguage(config.sourceLanguage);
    const target = normalizeLanguage(config.targetLanguage);
    if (!apiKey || !source || !target || target === 'auto')
      throw new TranslationProviderError('TRANSLATION_PROVIDER_UNAVAILABLE');

    const stt = new WebSocket(process.env.SONIOX_STT_URL?.trim() || SONIOX_STT_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const session = new SonioxSession(stt, apiKey, config, this.logger);
    return session.open();
  }
}

/**
 * One STT(+translation) stream, plus a lazily opened TTS stream in voice mode.
 *
 * Soniox token rules: final tokens arrive once and are appended; non-final
 * tokens are the current hypothesis and are replaced by every message.  The
 * relay gets the whole phrase so far on each event.  A phrase ends at an
 * `<end>`/`<fin>` marker once its translation has no pending non-final tokens.
 */
class SonioxSession extends TranslationProviderSession {
  private closed = false;
  private ready = false;
  private finalOriginal = '';
  private finalTranslation = '';
  private sentOriginal = '';
  private sentTranslation = '';
  private boundary = false;
  private originalFinalSent = false;
  private settleTimer: NodeJS.Timeout | null = null;
  private keepalive: NodeJS.Timeout | null = null;
  private lastSentAt = Date.now();
  private audioSinceFinalize = false;
  private processedMs = 0;
  private tts: WebSocket | null = null;
  private ttsReady = false;
  private readonly referenceId = `translation-${Math.random().toString(36).slice(2)}`;
  private ttsStreamId: string | null = null;
  /** `text_end` sent; waiting for Soniox to terminate the stream. */
  private ttsEnding = false;
  private ttsQueue: { text: string; end: boolean }[] = [];
  private phraseDonePending = false;

  constructor(
    private readonly stt: WebSocket,
    private readonly apiKey: string,
    private readonly config: TranslationConnectConfig,
    private readonly logger: Logger,
  ) { super(); }

  open(): Promise<this> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.close();
        reject(new TranslationProviderError('TRANSLATION_PROVIDER_UNAVAILABLE'));
      };
      const timeout = setTimeout(fail, CONNECT_TIMEOUT_MS);
      timeout.unref?.();
      this.stt.once('open', () => {
        const source = normalizeLanguage(this.config.sourceLanguage)!;
        const target = normalizeLanguage(this.config.targetLanguage)!;
        this.stt.send(JSON.stringify({
          model: process.env.SONIOX_STT_MODEL?.trim() || SONIOX_STT_MODEL,
          audio_format: 'pcm_s16le', num_channels: 1,
          sample_rate: TRANSLATION_INPUT_SAMPLE_RATE,
          language_hints: source === 'auto' ? [target] : [source, target],
          enable_language_identification: source === 'auto',
          enable_endpoint_detection: true,
          max_endpoint_delay_ms: 500,
          client_reference_id: this.referenceId,
          translation: { type: 'one_way', target_language: target },
        }));
        this.ready = true;
        this.lastSentAt = Date.now();
        this.keepalive = setInterval(() => this.sendKeepalive(), KEEPALIVE_MS);
        this.keepalive.unref?.();
        if (!settled) { settled = true; clearTimeout(timeout); resolve(this); }
      });
      this.stt.on('message', (raw) => this.onSttMessage(raw));
      this.stt.on('error', () => { if (!settled) fail(); else this.fail(); });
      this.stt.on('close', () => { if (!this.closed) this.fail(); });
      this.stt.on('unexpected-response', (_req, res) => {
        this.logger.warn(`event=translation_provider_refused provider=soniox status=${Number(res.statusCode) || 0}`);
        fail();
      });
    });
  }

  sendAudio(pcm16: Buffer): void {
    if (this.closed || !this.ready || this.stt.readyState !== WebSocket.OPEN) return;
    this.lastSentAt = Date.now();
    this.audioSinceFinalize = true;
    this.stt.send(pcm16);
  }

  /** Client VAD saw end of speech (with hangover): finalize now instead of waiting for the endpoint. */
  endOfSpeech(): void {
    if (!this.audioSinceFinalize) return;
    this.audioSinceFinalize = false;
    this.sendControl('finalize');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.keepalive) clearInterval(this.keepalive);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    try { if (this.stt.readyState === WebSocket.OPEN) this.stt.send(''); } catch {}
    try { this.stt.close(); } catch {}
    try { this.tts?.close(); } catch {}
    this.emit('closed');
  }

  private sendKeepalive() {
    if (Date.now() - this.lastSentAt >= KEEPALIVE_MS) this.sendControl('keepalive');
  }

  private sendControl(type: 'keepalive' | 'finalize') {
    if (this.closed || !this.ready || this.stt.readyState !== WebSocket.OPEN) return;
    this.lastSentAt = Date.now();
    try { this.stt.send(JSON.stringify({ type })); } catch {}
  }

  private onSttMessage(raw: WebSocket.RawData) {
    let message: { tokens?: Token[]; finished?: boolean; error_type?: string; total_audio_proc_ms?: number };
    try { message = JSON.parse(raw.toString()); } catch { return this.fail(); }
    if (message.error_type) {
      this.logger.warn(`event=translation_provider_error provider=soniox type=${message.error_type}`);
      return this.fail();
    }
    if (typeof message.total_audio_proc_ms === 'number' && message.total_audio_proc_ms > this.processedMs) {
      this.emit('usage', { audioInSeconds: (message.total_audio_proc_ms - this.processedMs) / 1000 });
      this.processedMs = message.total_audio_proc_ms;
    }

    let nonFinalOriginal = '';
    let nonFinalTranslation = '';
    let language: string | undefined;
    let confidence: number | undefined;
    let newFinalTranslation = '';
    for (const token of message.tokens ?? []) {
      const text = token.text ?? '';
      if (BOUNDARY_TOKENS.has(text)) { this.boundary = true; continue; }
      const final = token.is_final === true;
      if (token.translation_status === 'translation') {
        if (final) { this.finalTranslation += text; newFinalTranslation += text; }
        else nonFinalTranslation += text;
      } else {
        if (final) this.finalOriginal += text;
        else nonFinalOriginal += text;
        if (token.language) language = token.language;
        if (typeof token.confidence === 'number') confidence = token.confidence;
      }
    }

    const original = (this.finalOriginal + nonFinalOriginal).trim();
    if (original && original !== this.sentOriginal) {
      this.sentOriginal = original;
      this.originalFinalSent = !nonFinalOriginal && this.boundary;
      this.emit('transcript', { text: original, final: this.originalFinalSent, language, confidence });
    }
    const translation = (this.finalTranslation + nonFinalTranslation).trim();
    if (translation && translation !== this.sentTranslation && (nonFinalTranslation || !this.boundary)) {
      this.sentTranslation = translation;
      this.emit('translation', { text: translation, final: false });
    }
    if (this.config.mode === 'voice' && newFinalTranslation) this.sendTts(newFinalTranslation, false);

    if (!this.boundary) return;
    if (!nonFinalTranslation && this.finalTranslation.trim()) this.finishPhrase();
    else if (!this.finalOriginal.trim() && !nonFinalOriginal) this.resetPhrase(); // marker with no speech
    else this.armSettle();
  }

  /** Translation tokens can trail the endpoint marker; give them a moment, then close the phrase. */
  private armSettle() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => { this.settleTimer = null; if (!this.closed && this.boundary) this.finishPhrase(); }, PHRASE_SETTLE_MS);
    this.settleTimer.unref?.();
  }

  private finishPhrase() {
    const original = this.finalOriginal.trim();
    const translation = this.finalTranslation.trim();
    const originalSent = this.originalFinalSent && this.sentOriginal === original;
    this.resetPhrase();
    if (!original && !translation) return;
    if (original && !originalSent) this.emit('transcript', { text: original, final: true });
    this.emit('translation', { text: translation, final: true });
    if (this.config.mode === 'voice' && translation) {
      this.phraseDonePending = true;
      this.sendTts('', true);
    } else {
      this.emit('phraseDone');
    }
  }

  private resetPhrase() {
    if (this.settleTimer) { clearTimeout(this.settleTimer); this.settleTimer = null; }
    this.boundary = false;
    this.originalFinalSent = false;
    this.finalOriginal = '';
    this.finalTranslation = '';
    this.sentOriginal = '';
    this.sentTranslation = '';
  }

  /** Opened on first use and reopened after Soniox closes an idle TTS socket. */
  private openTts() {
    const tts = new WebSocket(process.env.SONIOX_TTS_URL?.trim() || SONIOX_TTS_URL, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.tts = tts;
    this.ttsReady = false;
    tts.on('open', () => {
      if (this.tts !== tts) return;
      this.ttsReady = true;
      this.flushTts();
    });
    tts.on('message', (raw) => {
      if (this.tts !== tts) return;
      let m: { audio?: string; error_type?: string; terminated?: boolean; stream_id?: string };
      try { m = JSON.parse(raw.toString()); } catch { return this.fail(); }
      if (m.error_type) {
        this.logger.warn(`event=translation_provider_error provider=soniox-tts type=${m.error_type}`);
        return this.fail();
      }
      if (m.audio) {
        const audio = Buffer.from(m.audio, 'base64');
        this.emit('usage', { audioOutSeconds: pcm16Seconds(audio, TRANSLATION_OUTPUT_SAMPLE_RATE) });
        this.emit('audio', audio);
      }
      if (m.terminated && m.stream_id === this.ttsStreamId) this.endTtsStream();
    });
    tts.on('error', () => { if (this.tts === tts) this.fail(); });
    tts.on('close', () => {
      if (this.tts !== tts || this.closed) return;
      // An idle close between phrases is normal; mid-phrase the phrase is closed without audio.
      this.tts = null;
      this.ttsReady = false;
      if (this.ttsStreamId) this.endTtsStream();
    });
  }

  private endTtsStream() {
    this.ttsStreamId = null;
    this.ttsEnding = false;
    if (this.phraseDonePending) { this.phraseDonePending = false; this.emit('phraseDone'); }
    this.flushTts();
  }

  private sendTts(text: string, end: boolean) {
    this.ttsQueue.push({ text, end });
    this.flushTts();
  }

  /** One TTS stream per phrase: text chunks as they finalize, then `text_end`. */
  private flushTts() {
    if (this.closed || !this.ttsQueue.length) return;
    if (!this.tts) return this.openTts();
    if (!this.ttsReady || this.tts.readyState !== WebSocket.OPEN || this.ttsEnding) return;
    while (this.ttsQueue.length) {
      if (!this.ttsStreamId) {
        this.ttsStreamId = `${this.referenceId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.tts.send(JSON.stringify({ stream_id: this.ttsStreamId, model: process.env.SONIOX_TTS_MODEL?.trim() || SONIOX_TTS_MODEL, language: normalizeLanguage(this.config.targetLanguage), voice: process.env.SONIOX_TTS_VOICE?.trim() || 'Adrian', audio_format: 'pcm_s16le', sample_rate: TRANSLATION_OUTPUT_SAMPLE_RATE, client_reference_id: this.referenceId }));
      }
      const chunk = this.ttsQueue.shift()!;
      this.tts.send(JSON.stringify({ stream_id: this.ttsStreamId, text: chunk.text, text_end: chunk.end }));
      // The next phrase waits until this stream is terminated.
      if (chunk.end) { this.ttsEnding = true; return; }
    }
  }

  private fail() {
    if (this.closed) return;
    this.emit('error', 'TRANSLATION_PROVIDER_UNAVAILABLE');
  }
}
