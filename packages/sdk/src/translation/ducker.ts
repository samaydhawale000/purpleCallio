/**
 * Smoothly lowers the original remote audio while translated speech plays
 * and restores it afterwards. Each element's own volume before ducking is
 * remembered and restored exactly.
 */
export class Ducker {
  private readonly baseline = new Map<HTMLMediaElement, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private _ducked = false;
  private level = 1;

  constructor(
    private getElements: () => HTMLMediaElement[],
    private readonly rampMs = 150,
    private readonly stepMs = 20,
  ) {}

  get ducked(): boolean {
    return this._ducked;
  }

  setElements(getElements: () => HTMLMediaElement[]): void {
    const wasDucked = this._ducked;
    if (wasDucked) this.restore(true);
    this.getElements = getElements;
    if (wasDucked) this.duck(this.level);
  }

  /** Ramp every element to `min(its own volume, level)`. */
  duck(level: number): void {
    this.level = clamp01(level);
    this._ducked = true;
    for (const el of this.getElements()) {
      if (!this.baseline.has(el)) this.baseline.set(el, clamp01(el.volume ?? 1));
    }
    this.ramp((el) => Math.min(this.baseline.get(el) ?? 1, this.level));
  }

  /** Ramp back to each element's own volume; `immediate` skips the ramp. */
  restore(immediate = false): void {
    if (!this._ducked && this.baseline.size === 0) return;
    this._ducked = false;
    const targets = new Map(this.baseline);
    const done = () => this.baseline.clear();
    if (immediate) {
      this.stop();
      for (const [el, v] of targets) setVolume(el, v);
      done();
      return;
    }
    this.ramp((el) => targets.get(el) ?? el.volume, [...targets.keys()], done);
  }

  dispose(): void {
    this.restore(true);
  }

  private ramp(
    target: (el: HTMLMediaElement) => number,
    elements: HTMLMediaElement[] = this.getElements(),
    onDone?: () => void,
  ): void {
    this.stop();
    const from = new Map(elements.map((el) => [el, clamp01(el.volume ?? 1)] as const));
    const steps = Math.max(1, Math.round(this.rampMs / this.stepMs));
    let i = 0;
    const tick = () => {
      i++;
      const t = Math.min(1, i / steps);
      for (const [el, start] of from) setVolume(el, start + (target(el) - start) * t);
      if (t >= 1) {
        this.stop();
        onDone?.();
      }
    };
    this.timer = setInterval(tick, this.stepMs);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

function setVolume(el: HTMLMediaElement, v: number): void {
  try {
    el.volume = clamp01(v);
  } catch {
    // Detached / unsupported element.
  }
}
