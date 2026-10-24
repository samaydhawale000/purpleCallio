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

class SonioxSession extends TranslationProviderSession {
  private closed = false;
  private ready = false;
  private phraseStarted = false;
  private original = '';
  private translation = '';
  private sentSeconds = 0;
  private tts: WebSocket | null = null;
  private ttsReady = false;
  private readonly referenceId = `translation-${Math.random().toString(36).slice(2)}`;
  private ttsStreamId: string | null = null;
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
        if (!settled) { settled = true; clearTimeout(timeout); resolve(this); }
        if (this.config.mode === 'voice') this.openTts();
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
    this.phraseStarted = true;
    this.sentSeconds += pcm16Seconds(pcm16, TRANSLATION_INPUT_SAMPLE_RATE);
    this.stt.send(pcm16);
  }

  /** Endpoint detection finalizes the phrase; no synthetic audio or duplicate flush is sent. */
  endOfSpeech(): void {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { if (this.stt.readyState === WebSocket.OPEN) this.stt.send(''); } catch {}
    try { this.stt.close(); } catch {}
    try { this.tts?.close(); } catch {}
    this.emit('closed');
  }

  private onSttMessage(raw: WebSocket.RawData) {
    let message: { tokens?: Token[]; finished?: boolean; error_type?: string; total_audio_proc_ms?: number };
    try { message = JSON.parse(raw.toString()); } catch { return this.fail(); }
    if (message.error_type) return this.fail();
    if (typeof message.total_audio_proc_ms === 'number')
      this.emit('usage', { audioInSeconds: message.total_audio_proc_ms / 1000 });
    for (const token of message.tokens ?? []) {
      const text = token.text ?? '';
      const final = token.is_final === true;
      if (token.translation_status === 'translation') {
        this.translation += text;
        this.emit('translation', { text: this.translation, final });
        if (this.config.mode === 'voice' && text) this.sendTts(text, final);
      } else {
        this.original += text;
        this.emit('transcript', { text: this.original, final, language: token.language, confidence: token.confidence });
      }
      if (final && token.translation_status === 'translation') this.finishPhrase();
    }
  }

  private finishPhrase() {
    if (!this.phraseStarted) return;
    this.phraseStarted = false;
    this.original = '';
    this.translation = '';
    if (this.config.mode === 'voice' && this.ttsStreamId) this.phraseDonePending = true;
    else this.emitPhraseDone();
  }

  private emitPhraseDone() {
    this.emit('phraseDone');
  }

  private openTts() {
    this.tts = new WebSocket(process.env.SONIOX_TTS_URL?.trim() || SONIOX_TTS_URL, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.tts.on('open', () => {
      this.ttsReady = true;
      this.flushTts();
    });
    this.tts.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString()) as { audio?: string; error_type?: string; terminated?: boolean; stream_id?: string };
        if (m.error_type) return this.fail();
        if (m.audio) { const audio = Buffer.from(m.audio, 'base64'); this.emit('usage', { audioOutSeconds: pcm16Seconds(audio, TRANSLATION_OUTPUT_SAMPLE_RATE) }); this.emit('audio', audio); }
        if (m.terminated && m.stream_id === this.ttsStreamId) {
          this.ttsStreamId = null;
          if (this.phraseDonePending) { this.phraseDonePending = false; this.emitPhraseDone(); }
          this.flushTts();
        }
      } catch { this.fail(); }
    });
    this.tts.on('error', () => this.fail());
  }

  private sendTts(text: string, end: boolean) {
    this.ttsQueue.push({ text, end });
    this.flushTts();
  }

  private flushTts() {
    if (!this.ttsReady || this.tts?.readyState !== WebSocket.OPEN || !this.ttsQueue.length) return;
    if (!this.ttsStreamId) {
      this.ttsStreamId = `${this.referenceId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.tts.send(JSON.stringify({ stream_id: this.ttsStreamId, model: process.env.SONIOX_TTS_MODEL?.trim() || SONIOX_TTS_MODEL, language: normalizeLanguage(this.config.targetLanguage), voice: process.env.SONIOX_TTS_VOICE?.trim() || 'Adrian', audio_format: 'pcm_s16le', sample_rate: TRANSLATION_OUTPUT_SAMPLE_RATE, client_reference_id: this.referenceId }));
    }
    const streamId = this.ttsStreamId;
    const chunks = this.ttsQueue;
    this.ttsQueue = [];
    for (const chunk of chunks) this.tts.send(JSON.stringify({ stream_id: streamId, text: chunk.text, text_end: chunk.end }));
  }

  private fail() {
    if (this.closed) return;
    this.emit('error', 'TRANSLATION_PROVIDER_UNAVAILABLE');
  }
}
