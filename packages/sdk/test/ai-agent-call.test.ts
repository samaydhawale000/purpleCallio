import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { Server, Socket } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PurpleCallioAgentCall } from '../src/ai/agent-call';
import { floatToPcm16 } from '../src/ai/pcm';
import type { AgentCallError } from '../src/ai/types';

const TOKEN = 'bj_ai_valid';
const READY = { inputSampleRate: 16_000, outputSampleRate: 24_000 };

// ── Web Audio / media fakes ──────────────────────────────

class FakeTrack {
  enabled = true;
  stopped = 0;
  stop() {
    this.stopped++;
  }
}

class FakeBufferSource {
  static started = 0;
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  stopped = 0;
  connect() {}
  disconnect() {}
  start() {
    FakeBufferSource.started++;
  }
  stop() {
    this.stopped++;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  sampleRate = 48_000;
  currentTime = 0;
  state: 'running' | 'closed' = 'running';
  closeCalls = 0;
  readonly destination = {};
  readonly sources: FakeBufferSource[] = [];
  readonly audioWorklet = { addModule: vi.fn(async () => {}) };

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
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  createBufferSource() {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
}

class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  readonly port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
  constructor(
    readonly ctx: unknown,
    readonly name: string,
    readonly options: unknown,
  ) {
    FakeAudioWorkletNode.instances.push(this);
  }
  disconnect() {}
}

// ── Fake /ai relay ───────────────────────────────────────

/** Minimal AiRelayGateway mirror: handshake token, then `ready`. */
class FakeRelay {
  readonly io: Server;
  url = '';
  readonly log: string[] = [];
  readonly audioFrames: Buffer[] = [];
  socket: Socket | null = null;
  connections = 0;
  private readonly http = createServer();

  constructor() {
    this.io = new Server(this.http);
    this.io.of('/ai').on('connection', (socket) => {
      this.connections++;
      socket.onAny((event: string) => this.log.push(event));
      socket.on('audio', (frame: Buffer) => this.audioFrames.push(frame));
      const token = (socket.handshake.auth as { token?: unknown }).token;
      if (token !== TOKEN) {
        socket.emit('error', { code: 'AI_SESSION_EXPIRED' });
        socket.disconnect(true);
        return;
      }
      this.socket = socket;
      socket.on('end', () => {
        socket.emit('ended', { reason: 'participant' });
        socket.disconnect(true);
      });
      socket.emit('ready', READY);
    });
  }

  async start() {
    await new Promise<void>((r) => this.http.listen(0, r));
    this.url = `http://localhost:${(this.http.address() as AddressInfo).port}`;
  }

  async stop() {
    await new Promise<void>((r) => this.io.close(() => r()));
  }

  count(event: string) {
    return this.log.filter((e) => e === event).length;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('PurpleCallioAgentCall', () => {
  let relay: FakeRelay;
  let track: FakeTrack;
  let getUserMedia: ReturnType<typeof vi.fn>;
  const calls: PurpleCallioAgentCall[] = [];

  const newCall = (token = TOKEN) => {
    const call = new PurpleCallioAgentCall({ token, apiUrl: relay.url, connectTimeoutMs: 2000 });
    calls.push(call);
    return call;
  };
  const ctx = () => FakeAudioContext.instances.at(-1)!;
  const worklet = () => FakeAudioWorkletNode.instances.at(-1)!;

  beforeEach(async () => {
    FakeAudioContext.instances = [];
    FakeAudioWorkletNode.instances = [];
    FakeBufferSource.started = 0;
    track = new FakeTrack();
    getUserMedia = vi.fn(async () => ({
      getTracks: () => [track],
      getAudioTracks: () => [track],
    }));
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    relay = new FakeRelay();
    await relay.start();
  });

  afterEach(async () => {
    calls.splice(0).forEach((c) => c.end());
    vi.unstubAllGlobals();
    await relay.stop();
  });

  it('start → ready → connected, then streams resampled PCM16 frames', async () => {
    const call = newCall();
    const connected = vi.fn();
    const states: string[] = [];
    call.on('connected', connected);
    call.on('connectionState', (s) => states.push(s));

    expect(call.connectionState).toBe('idle');
    await call.start();

    expect(call.connectionState).toBe('connected');
    expect(call.agentState).toBe('listening');
    expect(states).toEqual(['connecting', 'connected']);
    expect(connected).toHaveBeenCalledWith(READY);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
    });
    expect(ctx().audioWorklet.addModule).toHaveBeenCalledWith(expect.stringMatching(/^blob:/));
    expect(worklet().name).toBe('purplecallio-ai-capture');

    // 20 ms at 48 kHz → 320 samples at 16 kHz → one 640-byte frame.
    worklet().port.onmessage!({ data: new Float32Array(960).fill(0.25) });
    await waitFor(() => relay.audioFrames.length === 1);
    expect(relay.audioFrames[0].byteLength).toBe(640);
    expect(relay.audioFrames[0].readInt16LE(0)).toBe(Math.round(0.25 * 0x7fff));
  });

  it('accepts the connectUrl from createSession as apiUrl', async () => {
    const call = new PurpleCallioAgentCall({ token: TOKEN, apiUrl: `${relay.url}/ai/` });
    calls.push(call);
    await call.start();
    expect(call.connectionState).toBe('connected');
  });

  it('follows agent state events', async () => {
    const call = newCall();
    const events: string[] = [];
    call.on('speaking', () => events.push('speaking'));
    call.on('listening', () => events.push('listening'));
    call.on('thinking', () => events.push('thinking'));
    await call.start();

    relay.socket!.emit('state', { state: 'thinking' });
    relay.socket!.emit('state', { state: 'speaking' });
    relay.socket!.emit('state', { state: 'speaking' }); // duplicate: no event
    relay.socket!.emit('state', { state: 'bogus' }); // unknown: ignored
    relay.socket!.emit('state', { state: 'listening' });
    await waitFor(() => events.length === 3);
    await tick();

    expect(events).toEqual(['thinking', 'speaking', 'listening']);
    expect(call.agentState).toBe('listening');
  });

  it('forwards transcripts', async () => {
    const call = newCall();
    const transcripts: unknown[] = [];
    call.on('transcript', (t) => transcripts.push(t));
    await call.start();

    relay.socket!.emit('transcript', { role: 'user', text: 'Hi', final: false });
    relay.socket!.emit('transcript', { role: 'agent', text: 'Hello!', final: true });
    await waitFor(() => transcripts.length === 2);

    expect(transcripts).toEqual([
      { role: 'user', text: 'Hi', final: false },
      { role: 'agent', text: 'Hello!', final: true },
    ]);
  });

  it('plays agent audio and flushes the queue on interrupted', async () => {
    const call = newCall();
    const interrupted = vi.fn();
    call.on('interrupted', interrupted);
    await call.start();

    const chunk = Buffer.from(floatToPcm16(new Float32Array(480).fill(0.1)).buffer);
    relay.socket!.emit('audio', chunk);
    relay.socket!.emit('audio', chunk);
    await waitFor(() => FakeBufferSource.started === 2);
    const playback = (call as any).playback;
    expect(playback.pending).toBe(2);
    // 480 samples at 24 kHz = 20 ms each, scheduled back to back.
    expect(ctx().sources[0].buffer!.duration).toBeCloseTo(0.02);

    relay.socket!.emit('interrupted');
    await waitFor(() => interrupted.mock.calls.length === 1);

    expect(playback.pending).toBe(0);
    expect(ctx().sources.every((s) => s.stopped === 1)).toBe(true);
  });

  it('rejects start() with the relay error code and ends', async () => {
    const call = newCall('bj_ai_expired');
    const errors: AgentCallError[] = [];
    const ended = vi.fn();
    call.on('error', (e) => errors.push(e));
    call.on('ended', ended);

    await expect(call.start()).rejects.toMatchObject({ code: 'AI_SESSION_EXPIRED' });

    expect(errors.map((e) => e.code)).toEqual(['AI_SESSION_EXPIRED']);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(ended).toHaveBeenCalledWith({ reason: 'error' });
    expect(call.connectionState).toBe('ended');
    expect(track.stopped).toBe(1);
    expect(ctx().closeCalls).toBe(1);
  });

  it('reports a mid-call error code, then the server ended reason', async () => {
    const call = newCall();
    const order: string[] = [];
    call.on('error', (e) => order.push(`error:${e.code}`));
    call.on('ended', (e) => order.push(`ended:${e.reason}`));
    await call.start();

    relay.socket!.emit('error', { code: 'AI_MAX_DURATION_REACHED' });
    relay.socket!.emit('ended', { reason: 'max_duration' });
    relay.socket!.disconnect(true);
    await waitFor(() => call.connectionState === 'ended');
    await tick();

    expect(order).toEqual(['error:AI_MAX_DURATION_REACHED', 'ended:max_duration']);
    expect(track.stopped).toBe(1);
    expect(ctx().closeCalls).toBe(1);
  });

  it('ends when the server ends the session', async () => {
    const call = newCall();
    const ended = vi.fn();
    call.on('ended', ended);
    await call.start();

    relay.socket!.emit('ended', { reason: 'api' });
    await waitFor(() => ended.mock.calls.length === 1);

    expect(ended).toHaveBeenCalledWith({ reason: 'api' });
    expect(call.connectionState).toBe('ended');
  });

  it('treats a server kick without ended as disconnected', async () => {
    const call = newCall();
    const ended = vi.fn();
    call.on('ended', ended);
    await call.start();

    relay.socket!.disconnect(true);
    await waitFor(() => ended.mock.calls.length === 1);
    expect(ended).toHaveBeenCalledWith({ reason: 'disconnected' });
  });

  it('end() twice is harmless: one end event to the server, one ended event, cleanup once', async () => {
    const call = newCall();
    const ended = vi.fn();
    call.on('ended', ended);
    await call.start();

    call.end();
    call.end();
    await waitFor(() => relay.count('end') === 1);
    await tick();

    expect(relay.count('end')).toBe(1);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith({ reason: 'participant' });
    expect(call.connectionState).toBe('ended');
    expect(track.stopped).toBe(1);
    expect(ctx().closeCalls).toBe(1);
    await expect(call.start()).rejects.toMatchObject({ code: 'AI_CALL_ALREADY_STARTED' });
  });

  it('mute() disables the mic track and unmute() re-enables it', async () => {
    const call = newCall();
    await call.start();
    call.mute();
    expect(track.enabled).toBe(false);
    expect(call.isMuted).toBe(true);
    call.unmute();
    expect(track.enabled).toBe(true);
  });

  it('confirmTool sends the confirmation and forwards tool events', async () => {
    const call = newCall();
    const toolCalls: unknown[] = [];
    const confirmations: unknown[] = [];
    call.on('tool_call', (t) => toolCalls.push(t));
    call.on('tool.confirmation_required', (t) => confirmations.push(t));
    await call.start();

    const confirmed = new Promise((r) => relay.socket!.on('tool.confirm', r));
    call.confirmTool('tc_1', true);
    expect(await confirmed).toEqual({ id: 'tc_1', approve: true });

    relay.socket!.emit('tool_call', { id: 'tc_2', name: 'lookup' });
    relay.socket!.emit('tool.confirmation_required', { id: 'tc_3', name: 'refund' });
    await waitFor(() => toolCalls.length === 1 && confirmations.length === 1);
  });

  it('fails with AI_MICROPHONE_DENIED without spending the token', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const call = newCall();
    const errors: string[] = [];
    call.on('error', (e) => errors.push(e.code));

    await expect(call.start()).rejects.toMatchObject({ code: 'AI_MICROPHONE_DENIED' });
    await tick();

    expect(errors).toEqual(['AI_MICROPHONE_DENIED']);
    expect(relay.connections).toBe(0);
    expect(call.connectionState).toBe('ended');
  });

  it('end() while starting rejects start() and never connects', async () => {
    let release!: () => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r({ getTracks: () => [track], getAudioTracks: () => [track] });
        }),
    );
    const call = newCall();
    const starting = call.start();
    await waitFor(() => typeof release === 'function');
    call.end();
    release();

    await expect(starting).rejects.toMatchObject({ code: 'AI_SESSION_ENDED' });
    await tick();
    expect(relay.connections).toBe(0);
    // The stream that arrived after end() is released, so the mic turns off.
    expect(track.stopped).toBe(1);
  });
});
