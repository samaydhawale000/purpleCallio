import { analyzePcm16, isPoorAudio, PhraseAudioStats } from './audio-analysis';

function pcm(samples: number[]): Buffer {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
}

const tone = (n: number, amp: number) =>
  Array.from({ length: n }, (_, i) => Math.round(amp * Math.sin(i / 3)));

describe('analyzePcm16', () => {
  it('returns zeros for empty / odd buffers', () => {
    expect(analyzePcm16(Buffer.alloc(0))).toEqual({
      rms: 0,
      peak: 0,
      clippedRatio: 0,
    });
    expect(analyzePcm16(Buffer.from([1]))).toEqual({
      rms: 0,
      peak: 0,
      clippedRatio: 0,
    });
  });

  it('normalises rms, peak and clipping to 0..1', () => {
    const s = analyzePcm16(pcm([16384, -16384, 16384, -16384]));
    expect(s.rms).toBeCloseTo(0.5, 5);
    expect(s.peak).toBeCloseTo(0.5, 5);
    expect(s.clippedRatio).toBe(0);
    const c = analyzePcm16(pcm([32767, -32768, 0, 0]));
    expect(c.peak).toBe(1);
    expect(c.clippedRatio).toBe(0.5);
  });
});

describe('isPoorAudio', () => {
  it('flags very quiet or clipped audio', () => {
    expect(isPoorAudio(analyzePcm16(pcm(tone(1600, 100))))).toBe(true);
    expect(isPoorAudio(analyzePcm16(pcm(tone(1600, 8000))))).toBe(false);
    const clipped = tone(1600, 8000).map((v, i) => (i % 10 === 0 ? 32767 : v));
    expect(isPoorAudio(analyzePcm16(pcm(clipped)))).toBe(true);
  });

  it('honours options and does not judge an empty phrase', () => {
    expect(
      isPoorAudio({ rms: 0.02, peak: 0.1, clippedRatio: 0 }, { minRms: 0.05 }),
    ).toBe(true);
    expect(
      isPoorAudio(
        { rms: 0.2, peak: 1, clippedRatio: 0.05 },
        { maxClippedRatio: 0.1 },
      ),
    ).toBe(false);
    expect(isPoorAudio({ rms: 0, peak: 0, clippedRatio: 0, seconds: 0 })).toBe(
      false,
    );
  });
});

describe('PhraseAudioStats', () => {
  it('accumulates over chunks (including odd splits) like a single analysis', () => {
    const samples = tone(16000, 6000);
    const whole = pcm(samples);
    const acc = new PhraseAudioStats();
    acc.add(whole.subarray(0, 1001));
    acc.add(whole.subarray(1001, 20001));
    acc.add(whole.subarray(20001));
    const r = acc.result();
    const ref = analyzePcm16(whole);
    expect(r.seconds).toBeCloseTo(1, 5);
    expect(r.rms).toBeCloseTo(ref.rms, 6);
    expect(r.peak).toBeCloseTo(ref.peak, 6);
    expect(r.clippedRatio).toBe(ref.clippedRatio);
  });

  it('starts empty and resets', () => {
    const acc = new PhraseAudioStats();
    expect(acc.result()).toEqual({
      rms: 0,
      peak: 0,
      clippedRatio: 0,
      seconds: 0,
    });
    acc.add(pcm([1000, 2000]));
    acc.reset();
    expect(acc.result().seconds).toBe(0);
  });
});
