import { describe, expect, it } from 'vitest';

import {
  LinearResampler,
  Pcm16Framer,
  floatToPcm16,
  frameSamplesFor,
  pcm16ToFloat,
} from '../src/ai/pcm';

const sine = (n: number, rate: number, hz: number, offset = 0) =>
  Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * (i + offset)) / rate));

describe('PCM16 conversion', () => {
  it('maps the float range onto int16 and clamps out-of-range samples', () => {
    expect(Array.from(floatToPcm16(Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -2, NaN])))).toEqual([
      0, 32767, -32768, 16384, -16384, 32767, -32768, 0,
    ]);
  });

  it('decodes little-endian bytes, including from an unaligned view', () => {
    const bytes = new Uint8Array([0xee, 0x00, 0x80, 0xff, 0x7f, 0x00]);
    // Skip the first byte so the samples start at an odd offset; the trailing
    // odd byte is ignored.
    const view = new Uint8Array(bytes.buffer, 1, 5);
    expect(pcm16ToFloat(new Uint8Array([0xff, 0xff]))[0]).toBe(-1 / 0x8000);
    const out = pcm16ToFloat(view);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(-1); // 0x8000
    expect(out[1]).toBe(1); // 0x7fff
  });

  it('round-trips within one int16 step', () => {
    const input = sine(480, 24_000, 440);
    const back = pcm16ToFloat(floatToPcm16(input).buffer);
    for (let i = 0; i < input.length; i++) expect(Math.abs(back[i] - input[i])).toBeLessThan(1 / 0x7fff);
  });
});

describe('LinearResampler', () => {
  it('passes audio through when rates match', () => {
    const input = sine(128, 16_000, 300);
    expect(new LinearResampler(16_000, 16_000).process(input)).toBe(input);
  });

  it('downsamples 48 kHz to 16 kHz at the right length and averages each window', () => {
    const r = new LinearResampler(48_000, 16_000);
    const out = r.process(Float32Array.from([1, 2, 3, 4, 5, 6]));
    expect(Array.from(out)).toEqual([2, 5]);
    expect(r.process(new Float32Array(960))).toHaveLength(320);
  });

  it('gives the same output whether fed whole or in odd-sized chunks', () => {
    const input = sine(4410, 44_100, 440);
    const whole = new LinearResampler(44_100, 16_000).process(input);

    const chunked = new LinearResampler(44_100, 16_000);
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 137) parts.push(...chunked.process(input.subarray(i, i + 137)));

    expect(parts.length).toBe(whole.length);
    parts.forEach((v, i) => expect(v).toBeCloseTo(whole[i], 6));
    // ~1600 samples for 100 ms at 16 kHz.
    expect(Math.abs(whole.length - 1600)).toBeLessThanOrEqual(1);
  });

  it('upsamples by linear interpolation', () => {
    const r = new LinearResampler(8_000, 16_000);
    const out = r.process(Float32Array.from([0, 1, 0, -1]));
    expect(Array.from(out)).toEqual([0, 0.5, 1, 0.5, 0, -0.5]);
    // The held-back last sample is used once more data arrives.
    expect(Array.from(r.process(Float32Array.from([1])))).toEqual([-1, 0]);
  });

  it('keeps a low tone intact after downsampling', () => {
    const out = new LinearResampler(48_000, 16_000).process(sine(4800, 48_000, 200));
    const expected = sine(out.length, 16_000, 200, 1 / 3);
    out.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThan(0.02));
  });

  it('rejects invalid rates', () => {
    expect(() => new LinearResampler(0, 16_000)).toThrow();
  });
});

describe('Pcm16Framer', () => {
  it('emits exact frames and carries the remainder over', () => {
    const framer = new Pcm16Framer(4);
    expect(framer.push(Int16Array.from([1, 2, 3]))).toEqual([]);
    const frames = framer.push(Int16Array.from([4, 5, 6, 7, 8, 9, 10]));
    expect(frames.map((f) => Array.from(f))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
    expect(framer.push(Int16Array.from([11, 12])).map((f) => Array.from(f))).toEqual([[9, 10, 11, 12]]);
  });

  it('handles a push much larger than one frame', () => {
    const framer = new Pcm16Framer(320);
    expect(framer.push(new Int16Array(1000))).toHaveLength(3);
    expect(framer.push(new Int16Array(280))).toHaveLength(1);
  });

  it('sizes 20 ms frames per rate', () => {
    expect(frameSamplesFor(16_000)).toBe(320);
    expect(frameSamplesFor(24_000, 40)).toBe(960);
  });
});
