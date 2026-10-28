import { vi } from 'vitest';

export class FakeTranslationClient {
  static instances: FakeTranslationClient[] = [];
  state: any = { status: 'idle', mode: 'off', replayEnabled: false, playingPhraseId: null, originalVolume: 0.2, you: { speak: '', hear: '' } };
  phrases: any[] = [];
  private listeners = new Map<string, Set<(p: any) => void>>();
  readonly enable = vi.fn(async () => ({ role: 'caller' }));
  readonly disable = vi.fn();
  readonly setMode = vi.fn();
  readonly setLanguages = vi.fn();
  readonly setOriginalVolume = vi.fn();
  readonly replay = vi.fn(() => true);
  readonly requestRepeat = vi.fn(() => true);
  readonly resumeAudio = vi.fn(async () => true);
  constructor(readonly config: Record<string, unknown> = {}) {
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
  listenerCount() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
  emit(event: string, payload: any) {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(payload);
  }
}

export function phrase(over: Record<string, unknown> = {}) {
  return {
    phraseId: 'receiver-1', speaker: 'receiver', sourceLanguage: 'mr', targetLanguage: 'en',
    original: 'माझं नाव', translated: 'My name', final: true, startedAt: 1,
    flagged: false, playing: false, mine: false, ...over,
  };
}
