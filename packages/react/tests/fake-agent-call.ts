import { vi } from 'vitest';

/**
 * In-memory stand-in for `@purplecallio/sdk`'s `PurpleCallioAgentCall`: the
 * public surface `usePurpleCallioAI` uses, with no socket or audio. Tests
 * drive it through `emit()` and `resolveStart()` / `rejectStart()`.
 */
export class FakeAgentCall {
  static instances: FakeAgentCall[] = [];

  readonly config: Record<string, unknown>;
  isMuted = false;
  endCalls = 0;

  private readonly listeners = new Map<string, Set<(payload?: any) => void>>();
  private startResolve: (() => void) | null = null;
  private startReject: ((e: Error) => void) | null = null;

  readonly confirmTool = vi.fn();

  constructor(config: Record<string, unknown>) {
    this.config = config;
    FakeAgentCall.instances.push(this);
  }

  start(): Promise<void> {
    this.emit('connectionState', 'connecting');
    return new Promise((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
  }

  end(): void {
    this.endCalls += 1;
    this.emit('connectionState', 'ended');
    this.emit('ended', { reason: 'participant' });
  }

  mute(): void {
    this.isMuted = true;
  }

  unmute(): void {
    this.isMuted = false;
  }

  on(event: string, listener: (payload?: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  off(event: string, listener: (payload?: any) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  // ── Test-only helpers ─────────────────────────────────

  emit(event: string, payload?: unknown): void {
    this.listeners.get(event)?.forEach((l) => l(payload));
  }

  resolveStart(): void {
    this.emit('connectionState', 'connected');
    this.emit('connected', { inputSampleRate: 16000, outputSampleRate: 24000 });
    this.startResolve?.();
  }

  rejectStart(code: string): void {
    const err = Object.assign(new Error(code), { code });
    this.emit('error', err);
    this.emit('connectionState', 'ended');
    this.emit('ended', { reason: 'error' });
    this.startReject?.(err);
  }
}
