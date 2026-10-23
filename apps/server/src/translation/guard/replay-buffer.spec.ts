import { ReplayBuffer } from './replay-buffer';

/** `ms` of 16 kHz PCM16 filled with `fill`. */
const audio = (ms: number, fill = 1) =>
  Buffer.alloc((ms * 16000 * 2) / 1000, fill);

describe('ReplayBuffer', () => {
  it('stores audio per phrase', () => {
    const b = new ReplayBuffer();
    b.startPhrase('caller-1');
    b.append(audio(100, 1));
    b.append(audio(100, 2));
    b.endPhrase();
    b.append(audio(100, 9)); // no open phrase → ignored
    expect(b.has('caller-1')).toBe(true);
    expect(b.get('caller-1')!.length).toBe(audio(200).length);
    expect(b.get('caller-1')![audio(100).length]).toBe(2);
    expect(b.totalMs).toBeCloseTo(200, 5);
    expect(b.get('nope')).toBeNull();
    expect(b.has('nope')).toBe(false);
  });

  it('copies appended buffers', () => {
    const b = new ReplayBuffer();
    b.startPhrase('p');
    const chunk = audio(20, 5);
    b.append(chunk);
    chunk.fill(0);
    expect(b.get('p')![0]).toBe(5);
  });

  it('evicts whole oldest phrases first', () => {
    const b = new ReplayBuffer({ maxMs: 1000 });
    for (const id of ['a', 'b', 'c']) {
      b.startPhrase(id);
      b.append(audio(400));
      b.endPhrase();
    }
    expect(b.has('a')).toBe(false);
    expect(b.has('b')).toBe(true);
    expect(b.has('c')).toBe(true);
    expect(b.totalMs).toBeLessThanOrEqual(1000);
  });

  it('keeps only the newest maxMs of a single oversized phrase', () => {
    const b = new ReplayBuffer({ maxMs: 500 });
    b.startPhrase('old');
    b.append(audio(200));
    b.endPhrase();
    b.startPhrase('long');
    b.append(audio(400, 1));
    b.append(audio(400, 2));
    expect(b.has('old')).toBe(false);
    expect(b.totalMs).toBeCloseTo(500, 5);
    const kept = b.get('long')!;
    expect(kept.length).toBe(audio(500).length);
    expect(kept[0]).toBe(1);
    expect(kept[kept.length - 1]).toBe(2);
    expect(kept[audio(100).length]).toBe(2);
  });

  it('restarting a phrase id replaces its audio', () => {
    const b = new ReplayBuffer();
    b.startPhrase('x');
    b.append(audio(100));
    b.startPhrase('x');
    expect(b.get('x')!.length).toBe(0);
    expect(b.totalMs).toBe(0);
  });

  it('clear() drops everything', () => {
    const b = new ReplayBuffer({ sampleRate: 8000 });
    b.startPhrase('a');
    b.append(Buffer.alloc(1600));
    expect(b.totalMs).toBeCloseTo(100, 5);
    b.clear();
    expect(b.totalMs).toBe(0);
    expect(b.has('a')).toBe(false);
    b.append(Buffer.alloc(10)); // phrase closed by clear
    expect(b.totalMs).toBe(0);
  });
});
