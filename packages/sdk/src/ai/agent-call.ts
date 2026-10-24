import { io, Socket } from 'socket.io-client';

import { CAPTURE_PROCESSOR_NAME, loadCaptureWorklet } from './capture-worklet';
import {
  LinearResampler,
  Pcm16Framer,
  floatToPcm16,
  frameSamplesFor,
  pcm16ToFloat,
} from './pcm';
import { PlaybackQueue } from './playback';
import type {
  AgentCallConfig,
  AgentCallError,
  AgentCallEvent,
  AgentCallEventMap,
  AgentConnectionState,
  AgentReady,
  AgentState,
  AgentToolCall,
  AgentTranscript,
} from './types';

/** Mic frames sent to the relay are this long. */
const FRAME_MS = 20;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const AGENT_STATES: readonly AgentState[] = ['listening', 'thinking', 'speaking'];

type Listener<K extends AgentCallEvent> = (payload: AgentCallEventMap[K]) => void;

interface PendingConnect {
  resolve: (ready: AgentReady) => void;
  reject: (err: AgentCallError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function agentCallError(code: string, message?: string): AgentCallError {
  const err = new Error(message ?? code) as AgentCallError;
  err.code = code;
  return err;
}

/**
 * Browser voice call with a PurpleCallio AI agent.
 *
 * Mic audio is captured by an AudioWorklet, resampled to the relay's input
 * rate, sent as PCM16 frames over Socket.IO namespace `/ai`, and agent audio
 * is played back through a jitter-buffered queue. Your backend creates the
 * session with `client.ai.createSession()` and gives the browser the token.
 *
 * ```ts
 * const call = new PurpleCallioAgentCall({ token, apiUrl });
 * call.on('transcript', (t) => render(t));
 * call.on('ended', ({ reason }) => done(reason));
 * await call.start(); // from a click handler, so audio can play
 * ```
 */
export class PurpleCallioAgentCall {
  private _connectionState: AgentConnectionState = 'idle';
  private _agentState: AgentState = 'listening';
  private _muted = false;

  private readonly token: string;
  private readonly url: string;
  private readonly socketPath?: string;
  private readonly connectTimeoutMs: number;
  private readonly listeners = new Map<AgentCallEvent, Set<Listener<any>>>();

  private socket: Socket | null = null;
  private pending: PendingConnect | null = null;
  private lastError: AgentCallError | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private playback: PlaybackQueue | null = null;
  private resampler: LinearResampler | null = null;
  private framer: Pcm16Framer | null = null;

  constructor(config: AgentCallConfig) {
    if (!config?.token) throw new Error('PurpleCallio: token is required');
    if (!config.apiUrl) throw new Error('PurpleCallio: apiUrl is required');
    this.token = config.token;
    const base = config.apiUrl.replace(/\/+$/, '').replace(/\/ai$/, '');
    this.url = `${base}/ai`;
    this.socketPath = config.socketPath;
    this.connectTimeoutMs = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  get connectionState(): AgentConnectionState {
    return this._connectionState;
  }

  get agentState(): AgentState {
    return this._agentState;
  }

  get isMuted(): boolean {
    return this._muted;
  }

  on<K extends AgentCallEvent>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => this.off(event, listener);
  }

  off<K extends AgentCallEvent>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Opens the mic, connects to the relay and resolves once the agent is
   * ready. Call it from a user gesture so the AudioContext may play. Rejects
   * with an `Error` carrying `.code`; the call is then `ended`.
   */
  async start(): Promise<void> {
    if (this._connectionState !== 'idle') {
      throw agentCallError('AI_CALL_ALREADY_STARTED', 'This agent call was already started');
    }
    this.setConnectionState('connecting');

    try {
      // Created before any await so it counts as started by the gesture.
      const ctx = this.createAudioContext();
      this.ctx = ctx;
      void ctx.resume?.().catch(() => undefined);

      // Mic first: the token is single-use, so don't spend it on a call
      // that can't capture audio.
      const stream = await this.openMicrophone();
      // end() during the permission prompt already tore down: release this
      // late stream ourselves, or the mic stays on.
      if (this.connectionState !== 'connecting') {
        stream.getTracks().forEach((t) => t.stop());
      } else {
        this.stream = stream;
      }
      this.applyMute();
      this.assertStillStarting();

      await loadCaptureWorklet(ctx);
      this.assertStillStarting();

      const ready = await this.connect();
      this.setConnectionState('connected');
      this.emit('connected', ready);
    } catch (e) {
      const err = toAgentCallError(e);
      // Read through the getter: TS still narrows the field to 'idle' here.
      if (this.connectionState !== 'ended') {
        if (err !== this.lastError) this.emitError(err);
        this.finish('error', false);
      }
      throw err;
    }
  }

  /** Ends the call: tells the relay, stops the mic, closes audio. Idempotent. */
  end(): void {
    this.finish('participant', true);
  }

  mute(): void {
    this._muted = true;
    this.applyMute();
  }

  unmute(): void {
    this._muted = false;
    this.applyMute();
  }

  /** Answers a `tool.confirmation_required` event. */
  confirmTool(id: string, approve: boolean): void {
    this.socket?.emit('tool.confirm', { id, approve });
  }

  // ── Connection ─────────────────────────────────────────
  private connect(): Promise<AgentReady> {
    return new Promise<AgentReady>((resolve, reject) => {
      const socket = io(this.url, {
        autoConnect: false,
        transports: ['websocket'],
        auth: { token: this.token },
        reconnectionAttempts: 5,
        ...(this.socketPath ? { path: this.socketPath } : {}),
      });
      this.socket = socket;
      const timer = setTimeout(
        () => this.rejectPending(agentCallError('AI_CONNECTION_FAILED', 'Timed out connecting to the agent')),
        this.connectTimeoutMs,
      );
      this.pending = { resolve, reject, timer };
      this.attach(socket);
      socket.connect();
    });
  }

  private attach(socket: Socket): void {
    const s = socket as unknown as { on: (e: string, h: (...args: any[]) => void) => void };

    s.on('ready', (payload: AgentReady) => this.onReady(payload));
    s.on('audio', (data: ArrayBuffer | ArrayBufferView) => {
      this.playback?.enqueue(pcm16ToFloat(data));
    });
    s.on('state', (payload: { state?: AgentState }) => this.setAgentState(payload?.state));
    s.on('transcript', (payload: AgentTranscript) => {
      if (payload && typeof payload.text === 'string') this.emit('transcript', payload);
    });
    s.on('interrupted', () => {
      this.playback?.flush();
      this.emit('interrupted', undefined);
    });
    s.on('tool_call', (payload: AgentToolCall) => this.emit('tool_call', payload));
    s.on('tool.confirmation_required', (payload: AgentToolCall) =>
      this.emit('tool.confirmation_required', payload),
    );
    s.on('error', (payload: { code?: unknown }) => {
      const code = typeof payload?.code === 'string' ? payload.code : 'AI_CONNECTION_FAILED';
      const err = agentCallError(code);
      this.emitError(err);
      this.rejectPending(err);
    });
    s.on('ended', (payload: { reason?: unknown }) => {
      const reason = typeof payload?.reason === 'string' ? payload.reason : 'ended';
      if (this.pending) {
        this.rejectPending(this.lastError ?? agentCallError('AI_SESSION_ENDED'));
      }
      this.finish(reason, false);
    });
    s.on('connect_error', () => {
      this.rejectPending(agentCallError('AI_CONNECTION_FAILED', 'Could not reach the agent relay'));
    });
    s.on('disconnect', (reason: string) => {
      // Transport drops reconnect on their own (the relay keeps a grace
      // window); only a server-side kick without `ended` ends the call here.
      if (reason !== 'io server disconnect') return;
      // While starting, start() ends the call itself (reason `error`).
      if (this._connectionState === 'connecting') {
        this.rejectPending(this.lastError ?? agentCallError('AI_CONNECTION_FAILED'));
      } else {
        this.finish('disconnected', false);
      }
    });
    socket.io.on('reconnect_failed', () => {
      if (this._connectionState !== 'connected') return;
      this.emitError(agentCallError('AI_CONNECTION_FAILED', 'Lost connection to the agent'));
      this.finish('disconnected', false);
    });
  }

  private rejectPending(err: AgentCallError): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(err);
  }

  /** Also sent again after a reconnect; rates may then differ. */
  private onReady(payload: AgentReady): void {
    const ctx = this.ctx;
    const input = Number(payload?.inputSampleRate);
    const output = Number(payload?.outputSampleRate);
    if (!ctx || !this.stream || !(input > 0) || !(output > 0)) return;

    if (this.playback) this.playback.setSampleRate(output);
    else this.playback = new PlaybackQueue(ctx, output);

    if (!this.resampler || this.resampler.toRate !== input) {
      this.resampler = new LinearResampler(ctx.sampleRate, input);
      this.framer = new Pcm16Framer(frameSamplesFor(input, FRAME_MS));
    }

    if (!this.capture) {
      this.micSource = ctx.createMediaStreamSource(this.stream);
      this.capture = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      this.capture.port.onmessage = (e: MessageEvent<Float32Array>) => this.onCapture(e.data);
      this.micSource.connect(this.capture);
    }

    const pending = this.pending;
    if (pending) {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve({ inputSampleRate: input, outputSampleRate: output });
    }
  }

  private onCapture(chunk: Float32Array): void {
    const socket = this.socket;
    if (!socket?.connected || this._connectionState !== 'connected') return;
    if (!this.resampler || !this.framer) return;
    const pcm = floatToPcm16(this.resampler.process(chunk));
    for (const frame of this.framer.push(pcm)) socket.emit('audio', frame.buffer);
  }

  // ── State ──────────────────────────────────────────────
  private setConnectionState(state: AgentConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this.emit('connectionState', state);
  }

  private setAgentState(state: unknown): void {
    if (!AGENT_STATES.includes(state as AgentState) || state === this._agentState) return;
    this._agentState = state as AgentState;
    this.emit('agentState', this._agentState);
    this.emit(this._agentState, undefined);
  }

  private assertStillStarting(): void {
    if (this._connectionState !== 'connecting') {
      throw agentCallError('AI_SESSION_ENDED', 'The call was ended while starting');
    }
  }

  private finish(reason: string, notifyServer: boolean): void {
    if (this._connectionState === 'ended') return;
    if (notifyServer && this.socket?.connected) this.socket.emit('end');
    this.rejectPending(agentCallError('AI_SESSION_ENDED', 'The call was ended while starting'));
    this.teardown();
    this.setConnectionState('ended');
    this.emit('ended', { reason });
  }

  private teardown(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.io.removeAllListeners('reconnect_failed');
      socket.disconnect();
    }
    if (this.capture) {
      this.capture.port.onmessage = null;
      this.capture.disconnect();
      this.capture = null;
    }
    this.micSource?.disconnect();
    this.micSource = null;
    this.playback?.flush();
    this.playback = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    this.resampler = null;
    this.framer = null;
  }

  // ── Media ──────────────────────────────────────────────
  private createAudioContext(): AudioContext {
    const Ctor =
      (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!Ctor || typeof AudioWorkletNode === 'undefined') {
      throw agentCallError('AI_AUDIO_UNSUPPORTED', 'This browser does not support AudioWorklet');
    }
    return new Ctor() as AudioContext;
  }

  private async openMicrophone(): Promise<MediaStream> {
    const media = (globalThis as any).navigator?.mediaDevices as MediaDevices | undefined;
    if (!media?.getUserMedia) {
      throw agentCallError('AI_MICROPHONE_UNAVAILABLE', 'Microphone access is not available');
    }
    try {
      return await media.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      throw name === 'NotAllowedError' || name === 'SecurityError'
        ? agentCallError('AI_MICROPHONE_DENIED', 'Microphone permission was denied')
        : agentCallError('AI_MICROPHONE_UNAVAILABLE', 'Could not open the microphone');
    }
  }

  /** A disabled track yields silence, so frames keep flowing (the relay's idle timer stays happy). */
  private applyMute(): void {
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = !this._muted;
    });
  }

  private emitError(err: AgentCallError): void {
    this.lastError = err;
    this.emit('error', err);
  }

  private emit<K extends AgentCallEvent>(event: K, payload: AgentCallEventMap[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener(payload);
      } catch {
        // A throwing listener must not break the call.
      }
    }
  }
}

function toAgentCallError(e: unknown): AgentCallError {
  if (e instanceof Error && typeof (e as AgentCallError).code === 'string') {
    return e as AgentCallError;
  }
  return agentCallError('AI_CONNECTION_FAILED', 'Could not start the agent call');
}
