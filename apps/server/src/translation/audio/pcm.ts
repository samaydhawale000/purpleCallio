/** PCM16 LE mono helpers shared by translation providers. */

/** Linear resample of PCM16 mono. Returns the input when rates match. */
export function resamplePcm16(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate || pcm.length < 2) return pcm;
  const inSamples = Math.floor(pcm.length / 2);
  const outSamples = Math.max(1, Math.round((inSamples * toRate) / fromRate));
  const out = Buffer.alloc(outSamples * 2);
  const ratio = (inSamples - 1) / Math.max(1, outSamples - 1);
  for (let i = 0; i < outSamples; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = pcm.readInt16LE(idx * 2);
    const b = idx + 1 < inSamples ? pcm.readInt16LE((idx + 1) * 2) : a;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * frac))), i * 2);
  }
  return out;
}

/** Seconds of audio in a PCM16 mono buffer. */
export function pcm16Seconds(pcm: Buffer, sampleRate: number): number {
  return pcm.length / 2 / sampleRate;
}

/** Wraps PCM16 mono in a WAV container (for REST speech APIs). */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Extracts PCM16 mono from a WAV buffer (first `data` chunk); returns null if not a PCM16 WAV. */
export function wavToPcm16(wav: Buffer): { pcm: Buffer; sampleRate: number } | null {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let sampleRate = 0;
  let bits = 0;
  let channels = 1;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(body + 2);
      sampleRate = wav.readUInt32LE(body + 4);
      bits = wav.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16 || !sampleRate) return null;
      let pcm = wav.subarray(body, Math.min(wav.length, body + size));
      if (channels > 1) {
        const frames = Math.floor(pcm.length / (2 * channels));
        const mono = Buffer.alloc(frames * 2);
        for (let i = 0; i < frames; i++) mono.writeInt16LE(pcm.readInt16LE(i * 2 * channels), i * 2);
        pcm = mono;
      }
      return { pcm: Buffer.from(pcm), sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}
