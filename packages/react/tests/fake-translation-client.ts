import { vi } from 'vitest';

/** In-memory stand-in for the SDK's `TranslationClient`. Drive it with `setState` / `setPhrases` / `emit`. */
export class FakeTranslationClient {
  static instances: FakeTranslationClient[] = [];
  readonly config: Record<string, unknown>;
  state: any = {
    status: 'idle', mode: 'off', role: null, you: { speak: '', hear: '' }, peer: null,
    replayEnabled: false, guard: null, limits: null, trial: false, speaking: false,
    playingPhraseId: null, originalVolume: 0.2, limit: null, error: null,
  };
  phrases: any[] = [];
  private listeners = new Map<string, Set<(p: any) => void>>();

  readonly enable = vi.fn(async (opts?: any) => {
    this.setState({ status: 'ready', mode: opts?.mode ?? 'voice' });
    return { role: 'caller' };
  });
  readonly disable = vi.fn(() => this.setState({ status: 'ended' }));
  readonly setMode = vi.fn((mode: string) => this.setState({ mode }));
  readonly setLanguages = vi.fn();
  readonly setOriginalVolume = vi.fn((v: number) => this.setState({ originalVolume: v }));
  readonly replay = vi.fn(() => true);
  readonly requestRepeat = vi.fn(() => true);

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
    FakeTranslationClient.instances.push(this);
  }
  getState() {
    return { ...this.state };
  }
  on(event: string, fn: (p: any) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }
  emit(event: string, payload: any) {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(payload);
  }
  setState(patch: any) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.getState());
  }
  setPhrases(list: any[]) {
    this.phrases = list;
    this.emit('phrases', list);
  }
}

export function phrase(over: Record<string, unknown> = {}) {
  return {
    phraseId: 'receiver-1', speaker: 'receiver', sourceLanguage: 'mr', targetLanguage: 'en',
    original: 'माझं नाव राहुल आहे', translated: 'My name is Rahul', final: true, startedAt: 1,
    flagged: false, playing: false, mine: false, ...over,
  };
}
