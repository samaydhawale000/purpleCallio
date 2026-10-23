import { PLAYBACK_JITTER_SECONDS } from '../ai/playback';

/** After the last chunk ends, wait this long before declaring playback idle (absorbs jitter). */
export const PLAYBACK_IDLE_HOLD_MS = 250;

interface Chunk {
  samples: Float32Array;
  sampleRate: number;
  rate: number;
}

interface PhraseQueue {
  phraseId: string;
  replay: boolean;
  chunks: Chunk[];
}

export type PlayingListener = (phraseId: string | null, replay: boolean) => void;

/**
 * Plays translated speech one phrase at a time. Output goes through a
 * MediaStreamAudioDestinationNode into a hidden `<audio>` element, so the
 * browser's echo canceller sees it like any other remote audio and the mic
 * doesn't send it back. Audio for a phrase that arrives while another one is
 * playing waits its turn. Nothing is flushed when the local user speaks.
 */
export class TranslatedAudioPlayer {
  private readonly output: AudioNode;
  private readonly element: HTMLAudioElement | null = null;
  private readonly destination: MediaStreamAudioDestinationNode | null = null;
  private current: PhraseQueue | null = null;
  private readonly waiting: PhraseQueue[] = [];
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private announced = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly onPlaying: PlayingListener,
  ) {
    const doc = typeof document !== 'undefined' ? document : null;
    if (doc && typeof ctx.createMediaStreamDestination === 'function') {
      const dest = ctx.createMediaStreamDestination();
      const el = doc.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('data-purplecallio-translation', '');
      el.style.display = 'none';
      el.srcObject = dest.stream;
      doc.body?.appendChild(el);
      void el.play?.()?.catch?.(() => undefined);
      this.destination = dest;
      this.element = el;
      this.output = dest;
    } else {
      this.output = ctx.destination;
    }
  }

  /** The hidden element translated audio plays through (for output-device switching). */
  get outputElement(): HTMLAudioElement | null {
    return this.element;
  }

  get playingPhraseId(): string | null {
    return this.announced ? this.current?.phraseId ?? null : null;
  }

  get pending(): number {
    return this.sources.size;
  }

  enqueue(phraseId: string, samples: Float32Array, sampleRate: number, opts: { rate?: number; replay?: boolean } = {}): void {
    if (samples.length === 0) return;
    const replay = Boolean(opts.replay);
    const chunk: Chunk = { samples, sampleRate, rate: opts.rate && opts.rate > 0 ? opts.rate : 1 };

    if (this.current && this.current.phraseId === phraseId && this.current.replay === replay) {
      this.cancelIdle();
      this.schedule(chunk);
      return;
    }
    if (!this.current) {
      this.current = { phraseId, replay, chunks: [] };
      this.schedule(chunk);
      return;
    }
    let q = this.waiting.find((w) => w.phraseId === phraseId && w.replay === replay);
    if (!q) this.waiting.push((q = { phraseId, replay, chunks: [] }));
    q.chunks.push(chunk);
    // Current phrase already drained and is only holding: move on now.
    if (this.sources.size === 0) this.advance();
  }

  flush(): void {
    this.cancelIdle();
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // Already stopped.
      }
      s.disconnect();
    }
    this.sources.clear();
    this.waiting.length = 0;
    this.nextTime = 0;
    const was = this.announced;
    const replay = this.current?.replay ?? false;
    this.current = null;
    this.announced = false;
    if (was) this.onPlaying(null, replay);
  }

  dispose(): void {
    this.flush();
    try {
      this.destination?.disconnect();
    } catch {
      /* ignore */
    }
    if (this.element) {
      this.element.pause?.();
      this.element.srcObject = null;
      this.element.remove();
    }
  }

  private schedule(chunk: Chunk): void {
    const buffer = this.ctx.createBuffer(1, chunk.samples.length, chunk.sampleRate);
    buffer.getChannelData(0).set(chunk.samples);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    if (chunk.rate !== 1 && source.playbackRate) source.playbackRate.value = chunk.rate;
    source.connect(this.output);

    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + PLAYBACK_JITTER_SECONDS;
    source.start(this.nextTime);
    this.nextTime += buffer.duration / chunk.rate;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (this.sources.size === 0) this.onDrained();
    };

    if (!this.announced && this.current) {
      this.announced = true;
      this.onPlaying(this.current.phraseId, this.current.replay);
    }
  }

  private onDrained(): void {
    if (this.waiting.length > 0) {
      this.advance();
      return;
    }
    this.cancelIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.sources.size > 0) return;
      if (this.waiting.length > 0) return this.advance();
      const replay = this.current?.replay ?? false;
      const was = this.announced;
      this.current = null;
      this.announced = false;
      if (was) this.onPlaying(null, replay);
    }, PLAYBACK_IDLE_HOLD_MS);
  }

  /** Switch to the next waiting phrase. */
  private advance(): void {
    this.cancelIdle();
    const next = this.waiting.shift();
    if (!next) return;
    this.current = next;
    this.announced = false;
    const chunks = next.chunks;
    next.chunks = [];
    for (const c of chunks) this.schedule(c);
  }

  private cancelIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
