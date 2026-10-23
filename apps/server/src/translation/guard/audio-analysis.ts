/**
 * Cheap PCM16 level analysis for MeaningGuard's `poor_audio` signal.
 * All values are normalised to 0..1.
 */

export interface PcmStats {
  rms: number;
  peak: number;
  clippedRatio: number;
}

export interface PhraseStats extends PcmStats {
  seconds: number;
}

export interface PoorAudioOptions {
  /** RMS below this is too quiet for reliable speech recognition. Default 0.01. */
  minRms?: number;
  /** Share of clipped samples above this is distorted. Default 0.02. */
  maxClippedRatio?: number;
}

const FULL_SCALE = 32768;
/** |sample| at or above this counts as clipped. */
const CLIP_LEVEL = 32767;

export function analyzePcm16(pcm: Buffer): PcmStats {
  const samples = Math.floor((pcm?.length ?? 0) / 2);
  if (!samples) return { rms: 0, peak: 0, clippedRatio: 0 };
  let sumSq = 0;
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < samples; i++) {
    const v = pcm.readInt16LE(i * 2);
    const a = Math.abs(v);
    sumSq += v * v;
    if (a > peak) peak = a;
    if (a >= CLIP_LEVEL) clipped++;
  }
  return {
    rms: Math.min(1, Math.sqrt(sumSq / samples) / FULL_SCALE),
    peak: Math.min(1, peak / FULL_SCALE),
    clippedRatio: clipped / samples,
  };
}

/**
 * True when the phrase is too quiet or clipped. A phrase with no audio at all
 * (`seconds === 0`) is not judged.
 */
export function isPoorAudio(
  stats: PcmStats & { seconds?: number },
  opts: PoorAudioOptions = {},
): boolean {
  if (!stats) return false;
  if (stats.seconds === 0) return false;
  const minRms = opts.minRms ?? 0.01;
  const maxClipped = opts.maxClippedRatio ?? 0.02;
  return stats.rms < minRms || stats.clippedRatio > maxClipped;
}

/** Accumulates level statistics over one phrase of PCM16 mono audio. */
export class PhraseAudioStats {
  private sumSq = 0;
  private peak = 0;
  private clipped = 0;
  private samples = 0;
  /** Odd trailing byte carried over to the next chunk. */
  private carry: number | null = null;

  constructor(private readonly sampleRate = 16000) {}

  add(pcm: Buffer): void {
    if (!pcm?.length) return;
    let buf = pcm;
    if (this.carry !== null) {
      buf = Buffer.concat([Buffer.from([this.carry]), pcm]);
      this.carry = null;
    }
    const samples = Math.floor(buf.length / 2);
    for (let i = 0; i < samples; i++) {
      const v = buf.readInt16LE(i * 2);
      const a = Math.abs(v);
      this.sumSq += v * v;
      if (a > this.peak) this.peak = a;
      if (a >= CLIP_LEVEL) this.clipped++;
    }
    this.samples += samples;
    if (buf.length % 2) this.carry = buf[buf.length - 1];
  }

  result(): PhraseStats {
    if (!this.samples) return { rms: 0, peak: 0, clippedRatio: 0, seconds: 0 };
    return {
      rms: Math.min(1, Math.sqrt(this.sumSq / this.samples) / FULL_SCALE),
      peak: Math.min(1, this.peak / FULL_SCALE),
      clippedRatio: this.clipped / this.samples,
      seconds: this.samples / this.sampleRate,
    };
  }

  reset(): void {
    this.sumSq = 0;
    this.peak = 0;
    this.clipped = 0;
    this.samples = 0;
    this.carry = null;
  }
}
