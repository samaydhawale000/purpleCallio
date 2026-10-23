import { Injectable } from '@nestjs/common';

import { translationConfig } from '../../translation.config';
import {
  TRANSLATION_INPUT_SAMPLE_RATE,
  TRANSLATION_OUTPUT_SAMPLE_RATE,
  TranslationConnectConfig,
  TranslationProvider,
  TranslationProviderMode,
  TranslationProviderSession,
} from '../translation-provider.interface';

/**
 * Phrase bank: same meaning (and the same numbers) per language. Languages
 * not listed fall back to English text.
 */
const PHRASES: Record<string, string>[] = [
  {
    en: 'The fee is ₹2,500 for 3 visits.',
    hi: '3 विज़िट के लिए फीस ₹2,500 है।',
    mr: '3 भेटींसाठी शुल्क ₹2,500 आहे.',
  },
  {
    en: 'Please take one tablet twice a day.',
    hi: 'कृपया दिन में दो बार एक गोली लें।',
    mr: 'कृपया दिवसातून दोनदा एक गोळी घ्या.',
  },
  {
    en: 'Your appointment is on 12 November at 4 pm.',
    hi: 'आपकी अपॉइंटमेंट 12 नवंबर को शाम 4 बजे है।',
    mr: 'तुमची भेट 12 नोव्हेंबरला दुपारी 4 वाजता आहे.',
  },
  {
    en: 'Can you hear me clearly?',
    hi: 'क्या आप मुझे साफ़ सुन पा रहे हैं?',
    mr: 'तुम्हाला मी स्पष्ट ऐकू येत आहे का?',
  },
  {
    en: 'I will send the invoice of ₹1,200 today.',
    hi: 'मैं आज ₹1,200 का बिल भेज दूँगा।',
    mr: 'मी आज ₹1,200 चे बिल पाठवीन.',
  },
  {
    en: 'Thank you, that is all for today.',
    hi: 'धन्यवाद, आज के लिए बस इतना ही।',
    mr: 'धन्यवाद, आजसाठी इतकेच.',
  },
];

/** Every Nth phrase of a session has its amount changed (MeaningGuard E2E). */
export const MOCK_ALTERED_EVERY = 5;
export const MOCK_TONE_SECONDS = 0.6;
const CHUNK_MS = 100;
const CHUNK_DELAY_MS = 20;
const PARTIAL_EVERY_SECONDS = 0.2;

function base(lang: string): string {
  return (lang || 'en').toLowerCase().split('-')[0];
}

function phraseText(index: number, lang: string): string {
  const entry = PHRASES[index % PHRASES.length];
  return entry[base(lang)] ?? entry.en;
}

/** Multiplies the first number by 10 ("₹2,500" → "₹25,000"). */
export function alterAmount(text: string): string {
  return text.replace(/\d[\d,]*/, (token) => {
    const value = Number(token.replace(/,/g, ''));
    return Number.isFinite(value)
      ? (value * 10).toLocaleString('en-IN')
      : token;
  });
}

/**
 * Deterministic phrase for the n-th (1-based) phrase of a session with
 * `seconds` of speech: index = round(seconds × 10) mod bank size. Every
 * MOCK_ALTERED_EVERY-th phrase uses the fee phrase with its amount changed
 * in the translation.
 */
export function mockPhrase(
  seconds: number,
  n: number,
  source: string,
  target: string,
): { original: string; translated: string; altered: boolean } {
  const altered = n % MOCK_ALTERED_EVERY === 0;
  const index = altered ? 0 : Math.round(seconds * 10) % PHRASES.length;
  const src = source === 'auto' ? 'en' : source;
  const original = phraseText(index, src);
  const body = phraseText(index, target);
  const translated = `[${base(src)}→${base(target)}] ${altered ? alterAmount(body) : body}`;
  return { original, translated, altered };
}

/** 24 kHz PCM16 440 Hz tone burst. */
export function mockTone(seconds = MOCK_TONE_SECONDS): Buffer {
  const samples = Math.round(seconds * TRANSLATION_OUTPUT_SAMPLE_RATE);
  const out = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / TRANSLATION_OUTPUT_SAMPLE_RATE);
    out.writeInt16LE(Math.round(v * 6000), i * 2);
  }
  return out;
}

export class MockTranslationSession extends TranslationProviderSession {
  private bytes = 0;
  private lastPartialSeconds = 0;
  private phrases = 0;
  private closed = false;
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly config: TranslationConnectConfig,
    private readonly latencyMs: number,
  ) {
    super();
  }

  sendAudio(pcm16: Buffer): void {
    if (this.closed) return;
    this.bytes += pcm16.length;
    const seconds = this.bytes / 2 / TRANSLATION_INPUT_SAMPLE_RATE;
    if (seconds - this.lastPartialSeconds >= PARTIAL_EVERY_SECONDS) {
      this.lastPartialSeconds = seconds;
      this.emit('transcript', {
        text: `[speech ${seconds.toFixed(1)}s]`,
        final: false,
      });
    }
  }

  endOfSpeech(): void {
    if (this.closed) return;
    const seconds = this.bytes / 2 / TRANSLATION_INPUT_SAMPLE_RATE;
    this.bytes = 0;
    this.lastPartialSeconds = 0;
    if (seconds <= 0) {
      // Nothing was said: an empty final, so the relay can flag it.
      this.emit('transcript', { text: '', final: true });
      this.later(0, () => this.emit('phraseDone'));
      return;
    }
    this.phrases++;
    const { config } = this;
    const source = config.sourceLanguage === 'auto' ? 'en' : config.sourceLanguage;
    const phrase = mockPhrase(seconds, this.phrases, source, config.targetLanguage);
    this.emit('transcript', {
      text: phrase.original,
      final: true,
      language: base(source),
      confidence: 0.95,
    });
    this.later(this.latencyMs, () => {
      this.emit('translation', { text: phrase.translated, final: true });
      const voice = config.mode === 'voice';
      this.emit('usage', {
        audioInSeconds: seconds,
        audioOutSeconds: voice ? MOCK_TONE_SECONDS : 0,
        characters: phrase.translated.length,
      });
      if (!voice) {
        this.emit('phraseDone');
        return;
      }
      const tone = mockTone();
      const chunkBytes = (TRANSLATION_OUTPUT_SAMPLE_RATE * CHUNK_MS) / 1000 * 2;
      const chunks: Buffer[] = [];
      for (let o = 0; o < tone.length; o += chunkBytes) {
        chunks.push(tone.subarray(o, Math.min(tone.length, o + chunkBytes)));
      }
      chunks.forEach((chunk, i) =>
        this.later(i * CHUNK_DELAY_MS, () => this.emit('audio', chunk)),
      );
      this.later(chunks.length * CHUNK_DELAY_MS, () => this.emit('phraseDone'));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.emit('closed');
  }

  private later(ms: number, fn: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.closed) fn();
    }, ms);
    timer.unref?.();
    this.timers.add(timer);
  }
}

/**
 * Offline, deterministic provider (route `mock`) for local development,
 * E2E tests and CI. Never used in production unless forced by
 * TRANSLATION_MOCK_PROVIDER=true.
 */
@Injectable()
export class MockTranslationProvider implements TranslationProvider {
  readonly name = 'mock';

  isConfigured(): boolean {
    return true;
  }

  supports(_s: string, _t: string, _m: TranslationProviderMode): boolean {
    return true;
  }

  async connect(config: TranslationConnectConfig): Promise<MockTranslationSession> {
    return new MockTranslationSession(config, translationConfig().mockLatencyMs);
  }
}
