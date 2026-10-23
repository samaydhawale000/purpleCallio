import { vi } from 'vitest';

import type { TranslationSocketFactory, TranslationSocketLike } from '../src/translation/types';

export class FakeTrack {
  enabled = true;
  stopped = 0;
  stop() {
    this.stopped++;
  }
}

export class FakeStream {
  readonly track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
  getAudioTracks() {
    return [this.track];
  }
}

export class FakeBufferSource {
  buffer: { duration: number; sampleRate: number } | null = null;
  onended: (() => void) | null = null;
  playbackRate = { value: 1 };
  startedAt: number | null = null;
  stopped = 0;
  connectedTo: unknown = null;
  connect(node: unknown) {
    this.connectedTo = node;
  }
  disconnect() {}
  start(t: number) {
    this.startedAt = t;
  }
  stop() {
    this.stopped++;
  }
  /** Simulate the chunk finishing. */
  end() {
    this.onended?.();
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  sampleRate = 16_000;
  currentTime = 0;
  state: 'running' | 'closed' = 'running';
  closeCalls = 0;
  readonly destination = { kind: 'speakers' };
  readonly sources: FakeBufferSource[] = [];
  readonly audioWorklet = { addModule: vi.fn(async () => {}) };
  readonly mediaDestination = { kind: 'stream-dest', stream: { id: 'translated' }, disconnect: vi.fn() };

  constructor() {
    FakeAudioContext.instances.push(this);
  }
  async resume() {}
  async close() {
    this.closeCalls++;
    this.state = 'closed';
  }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createMediaStreamDestination() {
    return this.mediaDestination;
  }
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, sampleRate: rate, getChannelData: () => data };
  }
  createBufferSource() {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
}

export class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  readonly port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
  disconnected = 0;
  constructor() {
    FakeAudioWorkletNode.instances.push(this);
  }
  disconnect() {
    this.disconnected++;
  }
}

/** In-memory `/translate` socket: tests play the server with `server(event, ...)`. */
export class FakeSocket implements TranslationSocketLike {
  static instances: FakeSocket[] = [];
  connected = false;
  disconnected = 0;
  readonly sent: { event: string; args: any[] }[] = [];
  private handlers = new Map<string, ((...args: any[]) => void)[]>();

  constructor(
    readonly url: string,
    readonly options: any,
  ) {
    FakeSocket.instances.push(this);
  }
  on(event: string, handler: (...args: any[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }
  emit(event: string, ...args: any[]) {
    this.sent.push({ event, args });
    return this;
  }
  connect() {
    this.connected = true;
    return this;
  }
  disconnect() {
    this.connected = false;
    this.disconnected++;
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    return this;
  }
  /** Deliver a server → client event. */
  server(event: string, ...args: any[]) {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(...args);
  }
  events(name?: string) {
    return this.sent.filter((s) => !name || s.event === name);
  }
  names() {
    return this.sent.map((s) => s.event);
  }
}

export const fakeSocketFactory: TranslationSocketFactory = (url, options) => new FakeSocket(url, options);

export function installAudioFakes() {
  FakeAudioContext.instances.length = 0;
  FakeAudioWorkletNode.instances.length = 0;
  FakeSocket.instances.length = 0;
  const stream = new FakeStream();
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  return { stream, getUserMedia };
}

/** 20 ms at 16 kHz with a constant amplitude (0 = silence). */
export function chunk(amplitude: number, samples = 320): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = i % 2 ? amplitude : -amplitude;
  return out;
}

export function pcmBytes(samples = 480, value = 1000): ArrayBuffer {
  const a = new Int16Array(samples);
  a.fill(value);
  return a.buffer;
}

export const READY = {
  role: 'caller',
  inputSampleRate: 16_000,
  outputSampleRate: 24_000,
  mode: 'voice',
  you: { speak: 'en', hear: 'mr' },
  peer: { speak: 'mr', hear: 'en' },
  replayEnabled: false,
  guard: { enabled: true, sensitivity: 'standard' },
  limits: { maxMinutes: 30, usedSeconds: 0 },
  trial: false,
};
