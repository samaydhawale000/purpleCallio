/**
 * Pure audio helpers for the AI agent call: resampling, PCM16 conversion and
 * fixed-size framing. No Web Audio here, so these run (and are tested) in Node.
 */

/** Float samples in [-1, 1] → little-endian signed 16-bit PCM. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] || 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/**
 * Little-endian PCM16 bytes → float samples. Accepts any byte offset (Node
 * Buffers from a pool are often unaligned) and ignores a trailing odd byte.
 */
export function pcm16ToFloat(input: ArrayBuffer | ArrayBufferView): Float32Array {
  const view = ArrayBuffer.isView(input)
    ? new DataView(input.buffer, input.byteOffset, input.byteLength)
    : new DataView(input);
  const count = Math.floor(view.byteLength / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

/**
 * Streaming sample-rate converter. Keeps state between chunks, so feeding a
 * signal in arbitrary pieces gives the same output as feeding it at once.
 * Downsampling averages each output window (a cheap anti-alias filter);
 * upsampling interpolates linearly. Positions are derived from integer
 * sample counts, so float drift never shifts a window boundary.
 */
export class LinearResampler {
  private readonly ratio: number;
  private pending = new Float32Array(0);
  /** Output samples produced so far. */
  private produced = 0;
  /** Input samples dropped from the front of `pending` so far. */
  private consumed = 0;

  constructor(
    readonly fromRate: number,
    readonly toRate: number,
  ) {
    if (!(fromRate > 0) || !(toRate > 0)) {
      throw new Error('PurpleCallio: sample rates must be positive');
    }
    this.ratio = fromRate / toRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.fromRate === this.toRate) return input;

    const buf = new Float32Array(this.pending.length + input.length);
    buf.set(this.pending, 0);
    buf.set(input, this.pending.length);

    const out: number[] = [];
    let k = this.produced;
    for (;;) {
      const start = this.inputIndex(k) - this.consumed;
      if (this.ratio > 1) {
        const end = Math.max(start + 1, this.inputIndex(k + 1) - this.consumed);
        if (end > buf.length) break;
        let sum = 0;
        for (let i = start; i < end; i++) sum += buf[i];
        out.push(sum / (end - start));
      } else {
        if (start + 1 >= buf.length) break;
        const frac = ((k * this.fromRate) % this.toRate) / this.toRate;
        out.push(buf[start] + (buf[start + 1] - buf[start]) * frac);
      }
      k++;
    }
    this.produced = k;

    const drop = Math.min(Math.max(0, this.inputIndex(k) - this.consumed), buf.length);
    this.pending = buf.slice(drop);
    this.consumed += drop;
    return Float32Array.from(out);
  }

  reset(): void {
    this.pending = new Float32Array(0);
    this.produced = 0;
    this.consumed = 0;
  }

  /** Input sample under output sample `k`. */
  private inputIndex(k: number): number {
    return Math.floor((k * this.fromRate) / this.toRate);
  }
}

/** Collects PCM16 samples and hands out frames of exactly `frameSamples`. */
export class Pcm16Framer {
  private buf: Int16Array;
  private length = 0;

  constructor(readonly frameSamples: number) {
    if (!(frameSamples > 0)) throw new Error('PurpleCallio: frame size must be positive');
    this.buf = new Int16Array(frameSamples * 2);
  }

  push(samples: Int16Array): Int16Array[] {
    if (this.length + samples.length > this.buf.length) {
      const grown = new Int16Array((this.length + samples.length) * 2);
      grown.set(this.buf.subarray(0, this.length));
      this.buf = grown;
    }
    this.buf.set(samples, this.length);
    this.length += samples.length;

    const frames: Int16Array[] = [];
    let offset = 0;
    while (this.length - offset >= this.frameSamples) {
      frames.push(this.buf.slice(offset, offset + this.frameSamples));
      offset += this.frameSamples;
    }
    if (offset > 0) {
      this.buf.copyWithin(0, offset, this.length);
      this.length -= offset;
    }
    return frames;
  }

  reset(): void {
    this.length = 0;
  }
}

/** Samples in one frame of `ms` milliseconds at `sampleRate`. */
export function frameSamplesFor(sampleRate: number, ms = 20): number {
  return Math.max(1, Math.round((sampleRate * ms) / 1000));
}
