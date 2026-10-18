/** Extra lead time when playback (re)starts, so network jitter doesn't gap audio. */
export const PLAYBACK_JITTER_SECONDS = 0.08;

/**
 * Jitter-buffered playback of agent PCM. Each chunk becomes an
 * AudioBufferSourceNode scheduled back to back at the provider's output rate
 * (the browser resamples to the context rate). `flush()` stops everything
 * queued, which is how barge-in (`interrupted`) cuts the agent off at once.
 */
export class PlaybackQueue {
  private nextTime = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly ctx: AudioContext,
    private sampleRate: number,
  ) {}

  setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }

  /** Number of chunks scheduled and not yet finished. */
  get pending(): number {
    return this.sources.size;
  }

  enqueue(samples: Float32Array): void {
    if (samples.length === 0) return;
    const buffer = this.ctx.createBuffer(1, samples.length, this.sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    // After an underrun (or at the start) leave a little headroom.
    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + PLAYBACK_JITTER_SECONDS;
    source.start(this.nextTime);
    this.nextTime += buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
  }

  flush(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
  }
}
