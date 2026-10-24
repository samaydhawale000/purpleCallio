/**
 * In-memory rolling buffer of recent speaker audio, per phrase, for the
 * listener's "replay original" feature. Never persisted.
 *
 * Keeps at most `maxMs` of audio overall: whole oldest phrases are evicted
 * first; a single phrase longer than `maxMs` keeps only its newest audio.
 */

interface PhraseAudio {
  chunks: Buffer[];
  bytes: number;
}

export interface ReplayBufferOptions {
  /** Default 30 000 ms. */
  maxMs?: number;
  /** PCM16 mono sample rate. Default 16 000. */
  sampleRate?: number;
}

export class ReplayBuffer {
  private readonly maxBytes: number;
  private readonly sampleRate: number;
  /** Insertion order = age (Map preserves it). */
  private readonly phrases = new Map<string, PhraseAudio>();
  private current: string | null = null;
  private bytes = 0;

  constructor(opts: ReplayBufferOptions = {}) {
    const maxMs = Math.max(0, opts.maxMs ?? 30_000);
    this.sampleRate = Math.max(1, opts.sampleRate ?? 16_000);
    // Whole samples only.
    this.maxBytes = Math.floor((maxMs * this.sampleRate) / 1000) * 2;
  }

  startPhrase(phraseId: string): void {
    this.remove(phraseId);
    this.phrases.set(phraseId, { chunks: [], bytes: 0 });
    this.current = phraseId;
  }

  /** Appends to the current phrase; ignored when no phrase is open. */
  append(pcm: Buffer): void {
    if (this.current === null || !pcm?.length) return;
    const phrase = this.phrases.get(this.current);
    if (!phrase) return;
    phrase.chunks.push(Buffer.from(pcm));
    phrase.bytes += pcm.length;
    this.bytes += pcm.length;
    this.evict();
  }

  endPhrase(): void {
    this.current = null;
  }

  get(phraseId: string): Buffer | null {
    const phrase = this.phrases.get(phraseId);
    if (!phrase) return null;
    if (phrase.chunks.length > 1)
      phrase.chunks = [Buffer.concat(phrase.chunks)];
    return phrase.chunks[0] ?? Buffer.alloc(0);
  }

  has(phraseId: string): boolean {
    return this.phrases.has(phraseId);
  }

  clear(): void {
    this.phrases.clear();
    this.current = null;
    this.bytes = 0;
  }

  get totalMs(): number {
    return (this.bytes / 2 / this.sampleRate) * 1000;
  }

  private remove(phraseId: string): void {
    const phrase = this.phrases.get(phraseId);
    if (!phrase) return;
    this.bytes -= phrase.bytes;
    this.phrases.delete(phraseId);
    if (this.current === phraseId) this.current = null;
  }

  private evict(): void {
    while (this.bytes > this.maxBytes && this.phrases.size > 0) {
      const oldest = this.phrases.keys().next().value as string;
      if (this.phrases.size > 1 || oldest !== this.current) {
        this.remove(oldest);
        continue;
      }
      // Only the open phrase is left and it alone exceeds the cap: keep its tail.
      const phrase = this.phrases.get(oldest)!;
      const all = Buffer.concat(phrase.chunks);
      const tail = Buffer.from(all.subarray(all.length - this.maxBytes));
      this.bytes -= phrase.bytes - tail.length;
      phrase.chunks = [tail];
      phrase.bytes = tail.length;
    }
  }
}
