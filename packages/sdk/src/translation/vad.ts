import type { VadOptions } from './types';

export const DEFAULT_VAD_OPTIONS: VadOptions = {
  frameMs: 20,
  threshold: 0.012,
  onsetMs: 60,
  hangoverMs: 600,
  prerollMs: 200,
  maxPhraseMs: 30_000,
};

/** What to do with one mic frame. */
export type VadResult =
  | { type: 'idle' }
  /** Speech began: emit `speech.start`, then send `frames` (pre-roll incl. this frame). */
  | { type: 'start'; frames: Int16Array[] }
  /** Still speaking: send this frame. */
  | { type: 'frame'; frame: Int16Array }
  /** Speech ended after this frame (which is still sent): emit `speech.end`. */
  | { type: 'end'; frame: Int16Array };

/** RMS level (0..1) of PCM16 samples. */
export function pcm16Rms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] / 0x8000;
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

/**
 * Energy VAD with onset, hangover and pre-roll. Pure: feed fixed-length
 * frames, act on the result. The threshold adapts upward to a slowly
 * tracked noise floor so a noisy room does not read as constant speech.
 */
export class EnergyVad {
  readonly options: VadOptions;
  private speaking = false;
  private aboveMs = 0;
  private silenceMs = 0;
  private phraseMs = 0;
  private noiseFloor = 0;
  private preroll: Int16Array[] = [];

  constructor(options: Partial<VadOptions> = {}) {
    this.options = { ...DEFAULT_VAD_OPTIONS, ...options };
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Current effective threshold. */
  get threshold(): number {
    return Math.max(this.options.threshold, this.noiseFloor * 3);
  }

  process(frame: Int16Array): VadResult {
    const { frameMs, onsetMs, hangoverMs, prerollMs, maxPhraseMs } = this.options;
    const level = pcm16Rms(frame);
    const loud = level >= this.threshold;

    if (!this.speaking) {
      if (!loud) {
        // Slow noise-floor tracking on non-speech frames only.
        this.noiseFloor = this.noiseFloor === 0 ? level : this.noiseFloor * 0.95 + level * 0.05;
      }
      this.preroll.push(frame);
      const keep = Math.max(1, Math.ceil(prerollMs / frameMs));
      if (this.preroll.length > keep) this.preroll.splice(0, this.preroll.length - keep);
      this.aboveMs = loud ? this.aboveMs + frameMs : 0;
      if (this.aboveMs >= onsetMs) {
        this.speaking = true;
        this.silenceMs = 0;
        this.phraseMs = this.preroll.length * frameMs;
        const frames = this.preroll;
        this.preroll = [];
        return { type: 'start', frames };
      }
      return { type: 'idle' };
    }

    this.phraseMs += frameMs;
    this.silenceMs = loud ? 0 : this.silenceMs + frameMs;
    if (this.silenceMs >= hangoverMs || this.phraseMs >= maxPhraseMs) {
      this.speaking = false;
      this.aboveMs = 0;
      this.silenceMs = 0;
      return { type: 'end', frame };
    }
    return { type: 'frame', frame };
  }

  /** Forget everything (e.g. after the mic changed). Returns whether speech was open. */
  reset(): boolean {
    const was = this.speaking;
    this.speaking = false;
    this.aboveMs = 0;
    this.silenceMs = 0;
    this.phraseMs = 0;
    this.preroll = [];
    return was;
  }
}
