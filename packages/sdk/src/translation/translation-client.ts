import { io } from 'socket.io-client';

import { CAPTURE_PROCESSOR_NAME, loadCaptureWorklet } from '../ai/capture-worklet';
import { LinearResampler, Pcm16Framer, floatToPcm16, frameSamplesFor, pcm16ToFloat } from '../ai/pcm';
import { Ducker } from './ducker';
import { PhraseStore } from './phrases';
import { TranslatedAudioPlayer } from './player';
import { EnergyVad } from './vad';
import type {
  Caption,
  RemoteAudioTarget,
  TranslationClientConfig,
  TranslationError,
  TranslationEvent,
  TranslationEventMap,
  TranslationLimitEvent,
  TranslationMode,
  TranslationOptions,
  TranslationPhrase,
  TranslationReady,
  TranslationSocketFactory,
  TranslationSocketLike,
  TranslationState,
  TranslationSwitchChange,
} from './types';

const FRAME_MS = 20;
const DEFAULT_INPUT_RATE = 16_000;
const DEFAULT_OUTPUT_RATE = 24_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const MAX_SETTINGS_RETRIES = 3;
export const DEFAULT_ORIGINAL_VOLUME = 0;
export const SLOW_REPLAY_RATE = 0.85;
const MODES: readonly TranslationMode[] = ['off', 'captions', 'voice'];

type Listener<K extends TranslationEvent> = (payload: TranslationEventMap[K]) => void;

export function translationError(code: string, message?: string): TranslationError {
  const err = new Error(message ?? code) as TranslationError;
  err.code = code;
  return err;
}

const defaultSocketFactory: TranslationSocketFactory = (url, options) =>
  io(url, { ...options, reconnectionAttempts: 5 }) as unknown as TranslationSocketLike;

/** Socket.IO URL of the `/translate` namespace for a server origin. */
export function translationSocketUrl(serverUrl: string): string {
  const base = serverUrl.replace(/\/+$/, '').replace(/\/translate$/, '').replace(/\/api$/, '');
  return `${base}/translate`;
}

/**
 * PurpleCallio Live Translate for one participant of a 1:1 call.
 *
 * Captures the mic (AudioWorklet → 16 kHz PCM16, sent only while the local
 * VAD hears speech), receives DualView captions for both sides and plays the
 * translated voice for you (echo-safe, one phrase at a time). In voice mode
 * the other participant's original voice is held at `originalVolume`
 * (muted by default) for as long as their speech is translated for you.
 *
 * ```ts
 * const tr = new TranslationClient({ serverUrl, token, remoteAudio: audioEl });
 * tr.on('phrases', render);
 * await tr.enable({ speak: 'en', hear: 'mr', mode: 'voice' }); // from a click
 * ```
 */
export class TranslationClient {
  private readonly config: TranslationClientConfig;
  private readonly url: string;
  private readonly listeners = new Map<TranslationEvent, Set<Listener<any>>>();
  private readonly store: PhraseStore;
  private readonly ducker: Ducker;
  private remoteAudio: RemoteAudioTarget | undefined;

  private desired: { speak?: string; hear?: string; mode: TranslationMode };
  private peerLanguage: string | undefined;
  /** The relay translates our speech for the peer (see `TranslationReady.outbound`). */
  private outbound = false;
  /** `settings` sent and not yet answered by a `ready`. */
  private inFlightSettings = '';
  /** The same `settings` re-sent after the relay answered without applying them. */
  private settingsRetry = { key: '', count: 0 };
  /** What the relay last confirmed (ready / mode events). */
  private confirmed: { speak: string; hear: string; mode: TranslationMode } = { speak: '', hear: '', mode: 'off' };
  private state: TranslationState;

  private socket: TranslationSocketLike | null = null;
  private pending: {
    resolve: (r: TranslationReady) => void;
    reject: (e: TranslationError) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private enabling: Promise<TranslationReady> | null = null;
  private lastReady: TranslationReady | null = null;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private ownsStream = false;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private resampler: LinearResampler | null = null;
  private framer: Pcm16Framer | null = null;
  private vad: EnergyVad;
  private player: TranslatedAudioPlayer | null = null;
  private outputRate = DEFAULT_OUTPUT_RATE;
  private readonly replayRates = new Map<string, number>();

  constructor(config: TranslationClientConfig) {
    if (!config?.token) throw new Error('PurpleCallio: token is required');
    if (!config.serverUrl) throw new Error('PurpleCallio: serverUrl is required');
    this.config = config;
    this.url = translationSocketUrl(config.serverUrl);
    this.store = new PhraseStore(config.maxPhrases ?? 500);
    this.remoteAudio = config.remoteAudio;
    this.ducker = new Ducker(() => this.remoteElements());
    this.vad = new EnergyVad({ ...config.vad, frameMs: FRAME_MS });
    this.desired = { speak: config.speak, hear: config.hear, mode: validMode(config.mode) ?? 'voice' };
    this.peerLanguage = config.peerLanguage;
    this.state = {
      status: 'idle',
      mode: 'off',
      role: null,
      you: { speak: config.speak ?? '', hear: config.hear ?? '' },
      peer: null,
      replayEnabled: false,
      guard: null,
      limits: null,
      trial: false,
      speaking: false,
      playingPhraseId: null,
      originalVolume: clamp01(config.originalVolume ?? DEFAULT_ORIGINAL_VOLUME),
      audioBlocked: false,
      limit: null,
      error: null,
    };
  }

  // ── Public API ─────────────────────────────────────────

  /** DualView history, oldest first. */
  get phrases(): TranslationPhrase[] {
    return this.store.list();
  }

  getState(): TranslationState {
    return { ...this.state, you: { ...this.state.you }, peer: this.state.peer ? { ...this.state.peer } : null };
  }

  /** The hidden `<audio>` element translated speech plays through, once enabled. */
  get outputElement(): HTMLAudioElement | null {
    return this.player?.outputElement ?? null;
  }

  on<K extends TranslationEvent>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => this.off(event, listener);
  }

  off<K extends TranslationEvent>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Opens the mic, connects to `/translate` and resolves on `ready`. Call
   * from a user gesture so audio can play. While already enabled it just
   * applies the options (and retries blocked audio, so it also serves a
   * "Join translation" button). Turning translation on is shared with the
   * other participant when `shareSwitch` is set. Rejects with an `Error`
   * carrying `.code`.
   */
  enable(options: TranslationOptions = {}): Promise<TranslationReady> {
    const turningOn = !this.active;
    const ready = this.activate(options);
    if (turningOn) {
      void ready.then(
        () => this.shareSwitch(this.desired.mode),
        () => undefined,
      );
    } else {
      void this.resumeAudio();
    }
    return ready;
  }

  /**
   * Leaves translation (the call continues), for both participants when
   * shared. `{ share: false }` leaves only you, e.g. when you hang up.
   * Idempotent.
   */
  disable(options: { share?: boolean } = {}): void {
    if (!this.active) return;
    this.leave('participant');
    if (options.share !== false) void this.shareSwitch('off');
  }

  /**
   * Follows the call's translation switch, turned by the other participant
   * or your backend (`translation.changed`; `meeting.translation` wires it).
   * Never shared back. Starting without a user gesture may leave
   * `state.audioBlocked` set until `enable()` is called from a click.
   */
  followCall(mode: TranslationMode): void {
    if (!validMode(mode)) return;
    if (mode === 'off') {
      if (this.active) this.leave('switched_off');
      return;
    }
    if (!this.active) void this.activate({ mode }).catch(() => undefined);
  }

  /** Retries audio the browser blocked; call from a user gesture. */
  async resumeAudio(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    try {
      await ctx.resume?.();
    } catch {
      // Still blocked; reported through `audioBlocked`.
    }
    await this.player?.resumeOutput();
    this.syncAudioBlocked();
    return !this.state.audioBlocked;
  }

  setMode(mode: TranslationMode): void {
    if (!validMode(mode)) throw new Error(`PurpleCallio: invalid translation mode "${mode}"`);
    this.desired.mode = mode;
    this.applyLocalMode(mode);
    this.syncSettings();
  }

  setLanguages(languages: { speak?: string; hear?: string }): void {
    if (languages.speak) this.desired.speak = languages.speak;
    if (languages.hear) this.desired.hear = languages.hear;
    this.patchState({ you: { speak: this.desired.speak ?? this.state.you.speak, hear: this.desired.hear ?? this.state.you.hear } });
    this.updateHold();
    this.syncSettings();
  }

  /** Volume (0..1) of the other participant's original voice while it is translated for you. */
  setOriginalVolume(volume: number): void {
    const v = clamp01(volume);
    this.patchState({ originalVolume: v });
    this.updateHold();
  }

  /**
   * Change which element(s) carry the other participant's original audio.
   * Passing the current target again picks up elements added since.
   */
  setRemoteAudio(target: RemoteAudioTarget | undefined): void {
    if (target !== this.remoteAudio) {
      this.remoteAudio = target;
      this.ducker.setElements(() => this.remoteElements());
    }
    this.updateHold();
  }

  /**
   * Asks the relay to replay the speaker's original audio for a phrase
   * (only when `ready.replayEnabled`). `rate` < 1 plays it slower, e.g. 0.85.
   * Returns false when replay is off or translation is not connected.
   */
  replay(phraseId: string, options: { rate?: number } = {}): boolean {
    if (!this.state.replayEnabled || !this.socket?.connected || !phraseId) return false;
    this.replayRates.set(phraseId, options.rate && options.rate > 0 ? options.rate : 1);
    this.socket.emit('replay', { phraseId });
    return true;
  }

  /** Asks the speaker to repeat a phrase. */
  requestRepeat(phraseId: string): boolean {
    if (!this.socket?.connected || !phraseId) return false;
    this.socket.emit('repeat.request', { phraseId });
    if (this.store.patch(phraseId, { repeatRequestedAt: Date.now() })) this.emitPhrases();
    return true;
  }

  // ── Start / connect ───────────────────────────────────

  private get active(): boolean {
    return this.state.status === 'connecting' || this.state.status === 'ready';
  }

  private activate(options: TranslationOptions): Promise<TranslationReady> {
    this.applyOptions(options);
    if (this.state.status === 'ready' && this.lastReady) {
      this.syncSettings();
      return Promise.resolve(this.lastReady);
    }
    if (this.enabling) return this.enabling;
    this.enabling = this.start().finally(() => {
      this.enabling = null;
    });
    return this.enabling;
  }

  private leave(reason: string): void {
    if (this.socket?.connected) this.socket.emit('end', {});
    this.finish(reason);
  }

  private async shareSwitch(mode: TranslationMode): Promise<void> {
    const share = this.config.shareSwitch;
    if (!share) return;
    const change: TranslationSwitchChange = { mode, peerPresent: Boolean(this.state.peer?.connected) };
    if (mode !== 'off') {
      if (this.state.you.speak) change.speak = this.state.you.speak;
      if (this.state.you.hear) change.hear = this.state.you.hear;
      if (this.peerLanguage && !change.peerPresent) change.peerLanguage = this.peerLanguage;
    }
    try {
      await share(change);
    } catch (e) {
      this.emitError(toTranslationError(e));
    }
  }

  private applyOptions(o: TranslationOptions): void {
    if (o.speak) this.desired.speak = o.speak;
    if (o.hear) this.desired.hear = o.hear;
    if (o.peerLanguage) this.peerLanguage = o.peerLanguage;
    const mode = validMode(o.mode);
    if (mode) this.desired.mode = mode;
    if (o.originalVolume !== undefined) this.setOriginalVolume(o.originalVolume);
    this.state.you = { speak: this.desired.speak ?? this.state.you.speak, hear: this.desired.hear ?? this.state.you.hear };
  }

  private async start(): Promise<TranslationReady> {
    this.inFlightSettings = '';
    this.settingsRetry = { key: '', count: 0 };
    this.outbound = false;
    this.patchState({ status: 'connecting', error: null, limit: null });
    try {
      const ctx = this.createAudioContext();
      this.ctx = ctx;
      void ctx.resume?.()?.catch?.(() => undefined);

      const stream = await this.resolveStream();
      if (this.state.status !== 'connecting') {
        if (this.ownsStream) stream.getTracks().forEach((t) => t.stop());
        throw translationError('TRANSLATION_ENDED', 'Translation was turned off while starting');
      }
      this.stream = stream;

      await loadCaptureWorklet(ctx);
      if (this.state.status !== 'connecting') {
        throw translationError('TRANSLATION_ENDED', 'Translation was turned off while starting');
      }
      return await this.connect();
    } catch (e) {
      const err = toTranslationError(e);
      if (this.state.status === 'connecting') {
        if (this.state.error !== err) this.emitError(err);
        this.finish('error');
      }
      throw err;
    }
  }

  private connect(): Promise<TranslationReady> {
    return new Promise<TranslationReady>((resolve, reject) => {
      const factory = this.config.socketFactory ?? defaultSocketFactory;
      const socket = factory(this.url, {
        autoConnect: false,
        transports: ['websocket'],
        auth: { token: this.config.token },
        ...(this.config.socketPath ? { path: this.config.socketPath } : {}),
      });
      this.socket = socket;
      const timer = setTimeout(
        () => this.rejectPending(translationError('TRANSLATION_CONNECTION_FAILED', 'Timed out connecting to translation')),
        this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      );
      this.pending = { resolve, reject, timer };
      this.attach(socket);
      socket.connect();
    });
  }

  private attach(socket: TranslationSocketLike): void {
    socket.on('ready', (p: TranslationReady) => this.onReady(p));
    socket.on('caption', (c: Caption) => {
      const phrase = this.store.applyCaption(c);
      if (!phrase) return;
      this.updateHold();
      this.emit('caption', phrase);
      this.emitPhrases();
    });
    socket.on('audio', (pcm: ArrayBuffer | ArrayBufferView, meta?: { phraseId?: string }) => {
      if (this.state.mode !== 'voice' || !this.player) return;
      this.player.enqueue(meta?.phraseId ?? 'unknown', pcm16ToFloat(pcm), this.outputRate);
    });
    socket.on('replay.audio', (pcm: ArrayBuffer | ArrayBufferView, meta?: { phraseId?: string; sampleRate?: number; done?: boolean }) => {
      const phraseId = meta?.phraseId ?? 'unknown';
      const rate = this.replayRates.get(phraseId) ?? 1;
      const sampleRate = Number(meta?.sampleRate) > 0 ? Number(meta!.sampleRate) : DEFAULT_INPUT_RATE;
      if (pcm && this.player) this.player.enqueue(phraseId, pcm16ToFloat(pcm), sampleRate, { rate, replay: true });
      if (meta?.done) this.replayRates.delete(phraseId);
    });
    socket.on('flagged', (p: { phraseId?: string; reasons?: string[] }) => {
      if (!p?.phraseId) return;
      const phrase = this.store.applyFlag(p.phraseId, Array.isArray(p.reasons) ? p.reasons : []);
      if (!phrase) return;
      this.emit('flagged', phrase);
      this.emitPhrases();
    });
    socket.on('repeat.requested', (p) => {
      if (p?.phraseId) this.emit('repeat.requested', p);
    });
    socket.on('limit', (p: TranslationLimitEvent) => {
      if (!p?.kind) return;
      this.patchState({ limit: p });
      this.emit('limit', p);
    });
    socket.on('mode', (p: { mode?: TranslationMode; reason?: any }) => {
      const mode = validMode(p?.mode);
      if (!mode) return;
      // Server-side changes (limit / api) are authoritative.
      this.desired.mode = mode;
      this.confirmed.mode = mode;
      this.applyLocalMode(mode);
      this.emit('mode', { mode, reason: p.reason });
    });
    socket.on('outbound', (p: { active?: boolean }) => {
      this.outbound = Boolean(p?.active);
      if (!this.sendingMic()) this.endSpeech();
    });
    socket.on('peer', (p: { connected?: boolean; speak?: string; hear?: string }) => {
      const prev = this.state.peer;
      this.patchState({
        peer: {
          connected: Boolean(p?.connected),
          speak: p?.speak ?? prev?.speak ?? '',
          hear: p?.hear ?? prev?.hear ?? '',
        },
      });
      this.updateHold();
      this.emit('peer', { connected: Boolean(p?.connected), speak: p?.speak, hear: p?.hear });
    });
    socket.on('error', (p: { code?: unknown }) => {
      const err = translationError(typeof p?.code === 'string' ? p.code : 'TRANSLATION_CONNECTION_FAILED');
      this.emitError(err);
      this.rejectPending(err);
    });
    socket.on('ended', (p: { reason?: unknown }) => {
      const reason = typeof p?.reason === 'string' ? p.reason : 'ended';
      this.rejectPending(this.state.error ?? translationError('TRANSLATION_ENDED'));
      this.finish(reason);
    });
    socket.on('connect_error', () => {
      this.rejectPending(translationError('TRANSLATION_CONNECTION_FAILED', 'Could not reach the translation relay'));
    });
    socket.on('disconnect', (reason: string) => {
      this.endSpeech();
      if (reason !== 'io server disconnect') return;
      if (this.pending) this.rejectPending(this.state.error ?? translationError('TRANSLATION_CONNECTION_FAILED'));
      else this.finish('disconnected');
    });
  }

  /** Also sent again after a reconnect or a settings change. */
  private onReady(raw: TranslationReady): void {
    const ctx = this.ctx;
    if (!ctx || !this.stream || !raw) return;
    const ready: TranslationReady = {
      role: raw.role,
      inputSampleRate: Number(raw.inputSampleRate) > 0 ? Number(raw.inputSampleRate) : DEFAULT_INPUT_RATE,
      outputSampleRate: Number(raw.outputSampleRate) > 0 ? Number(raw.outputSampleRate) : DEFAULT_OUTPUT_RATE,
      mode: validMode(raw.mode) ?? 'off',
      you: { speak: raw.you?.speak ?? this.desired.speak ?? '', hear: raw.you?.hear ?? this.desired.hear ?? '' },
      peer: raw.peer ?? null,
      replayEnabled: Boolean(raw.replayEnabled),
      guard: raw.guard ?? { enabled: false, sensitivity: 'standard' },
      limits: raw.limits ?? { maxMinutes: null, usedSeconds: 0 },
      trial: Boolean(raw.trial),
      outbound: Boolean(raw.outbound),
    };
    this.lastReady = ready;
    this.outbound = Boolean(ready.outbound);
    this.confirmed = { speak: ready.you.speak, hear: ready.you.hear, mode: ready.mode };
    this.outputRate = ready.outputSampleRate;
    this.store.setRole(ready.role ?? null);

    if (!this.player) {
      this.player = new TranslatedAudioPlayer(
        ctx,
        (id, replay) => this.onPlaying(id, replay),
        () => this.syncAudioBlocked(),
      );
      ctx.onstatechange = () => this.syncAudioBlocked();
    }
    if (!this.resampler || this.resampler.toRate !== ready.inputSampleRate) {
      this.resampler = new LinearResampler(ctx.sampleRate, ready.inputSampleRate);
      this.framer = new Pcm16Framer(frameSamplesFor(ready.inputSampleRate, FRAME_MS));
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

    const prevPeer = this.state.peer;
    this.patchState({
      status: 'ready',
      role: ready.role ?? null,
      you: ready.you,
      peer: ready.peer ? { ...ready.peer, connected: prevPeer?.connected ?? true } : null,
      replayEnabled: ready.replayEnabled,
      guard: ready.guard,
      limits: ready.limits,
      trial: ready.trial,
      limit: null,
    });
    this.applyLocalMode(ready.mode);
    this.syncAudioBlocked();
    this.updateHold();

    const pending = this.pending;
    if (pending) {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(ready);
    }
    this.emit('ready', ready);
    this.emitPhrases();
    // Every `ready` answers what we sent; if it still disagrees (e.g. the
    // relay re-planned when the peer joined), send our choice again.
    this.inFlightSettings = '';
    this.syncSettings();
  }

  /**
   * Sends `settings` when what we want differs from what the relay last
   * confirmed. Not repeated while unanswered, and the same correction is
   * re-sent at most MAX_SETTINGS_RETRIES times so a relay that won't apply
   * it can't cause a loop.
   */
  private syncSettings(): void {
    const socket = this.socket;
    const ready = this.lastReady;
    if (!socket?.connected || !ready || this.state.status !== 'ready') return;
    const diff: { speak?: string; hear?: string; mode?: TranslationMode } = {};
    if (this.desired.speak && this.desired.speak !== this.confirmed.speak) diff.speak = this.desired.speak;
    if (this.desired.hear && this.desired.hear !== this.confirmed.hear) diff.hear = this.desired.hear;
    if (this.desired.mode !== this.confirmed.mode) diff.mode = this.desired.mode;
    if (Object.keys(diff).length === 0) {
      this.settingsRetry = { key: '', count: 0 };
      return;
    }
    const key = JSON.stringify(diff);
    if (key === this.inFlightSettings) return;
    if (key === this.settingsRetry.key) {
      if (this.settingsRetry.count >= MAX_SETTINGS_RETRIES) return;
      this.settingsRetry.count++;
    } else {
      this.settingsRetry = { key, count: 0 };
    }
    this.inFlightSettings = key;
    socket.emit('settings', diff);
  }

  // ── Mic / VAD ──────────────────────────────────────────

  private onCapture(chunk: Float32Array): void {
    if (!this.resampler || !this.framer) return;
    const frames = this.framer.push(floatToPcm16(this.resampler.process(chunk)));
    const socket = this.socket;
    const live = Boolean(socket?.connected) && this.state.status === 'ready' && this.sendingMic();
    for (const frame of frames) {
      if (!live) {
        this.endSpeech();
        continue;
      }
      const r = this.vad.process(frame);
      if (r.type === 'start') {
        socket!.emit('speech.start', {});
        this.setSpeaking(true);
        for (const f of r.frames) socket!.emit('audio', f.buffer);
      } else if (r.type === 'frame') {
        socket!.emit('audio', r.frame.buffer);
      } else if (r.type === 'end') {
        socket!.emit('audio', r.frame.buffer);
        socket!.emit('speech.end', {});
        this.setSpeaking(false);
      }
    }
  }

  /** Our speech is wanted: we use translation, or the peer needs ours translated. */
  private sendingMic(): boolean {
    return this.state.mode !== 'off' || this.outbound;
  }

  /** Close an open phrase (mic no longer needed, disconnect, disable). */
  private endSpeech(): void {
    if (!this.vad.reset()) return;
    if (this.socket?.connected) this.socket.emit('speech.end', {});
    this.setSpeaking(false);
  }

  private setSpeaking(speaking: boolean): void {
    if (this.state.speaking === speaking) return;
    this.patchState({ speaking });
    this.emit('speaking', speaking);
  }

  // ── Playback / ducking ─────────────────────────────────

  private onPlaying(phraseId: string | null, replay: boolean): void {
    const prev = this.state.playingPhraseId;
    const now = Date.now();
    if (prev && prev !== phraseId) this.store.patch(prev, { playing: false, playedUntil: now });
    if (phraseId) {
      const p = this.store.get(phraseId);
      this.store.patch(phraseId, { playing: true, ...(replay || p?.playedAt ? {} : { playedAt: now }) });
    }
    this.patchState({ playingPhraseId: phraseId });
    this.updateHold();
    this.emit('playback', { phraseId, replay });
    this.emitPhrases();
  }

  private applyLocalMode(mode: TranslationMode): void {
    if (mode !== 'voice') this.player?.flush();
    if (this.state.mode !== mode) this.patchState({ mode });
    if (!this.sendingMic()) this.endSpeech();
    this.updateHold();
  }

  /**
   * Holds the other participant's original voice at `originalVolume` while
   * their speech is translated for you (voice mode), not just while a phrase
   * plays: the translation lands after they finish a phrase, so ducking only
   * during playback let you hear them live first and then again translated.
   * A playing phrase or replay holds it too. Otherwise it stays untouched.
   */
  private updateHold(): void {
    const hold =
      this.state.status === 'ready' && (this.state.playingPhraseId !== null || this.peerTranslatedForYou());
    if (!hold) {
      if (this.ducker.ducked) this.ducker.restore();
      return;
    }
    const level = this.state.originalVolume;
    if (!this.ducker.ducked || this.ducker.duckLevel !== level || this.ducker.hasUntracked()) {
      this.ducker.duck(level);
    }
  }

  /** Same rule as the relay's: the peer is in translation and speaks something other than what you hear. */
  private peerTranslatedForYou(): boolean {
    const peer = this.state.peer;
    if (this.state.mode !== 'voice' || !peer?.connected || !peer.speak) return false;
    return peer.speak === 'auto' || baseLanguage(peer.speak) !== baseLanguage(this.state.you.hear);
  }

  private syncAudioBlocked(): void {
    const blocked = this.ctx?.state === 'suspended' || Boolean(this.player?.outputBlocked);
    if (blocked !== this.state.audioBlocked) this.patchState({ audioBlocked: blocked });
  }

  private remoteElements(): HTMLMediaElement[] {
    let t: any = this.remoteAudio;
    if (typeof t === 'function') t = t();
    if (!t) return [];
    if (typeof t[Symbol.iterator] === 'function' && !(typeof HTMLMediaElement !== 'undefined' && t instanceof HTMLMediaElement)) {
      return [...t].filter(Boolean) as HTMLMediaElement[];
    }
    return [t as HTMLMediaElement];
  }

  // ── Lifecycle ──────────────────────────────────────────

  private rejectPending(err: TranslationError): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(err);
  }

  private finish(reason: string): void {
    if (this.state.status === 'idle' || this.state.status === 'ended') return;
    this.rejectPending(translationError('TRANSLATION_ENDED', 'Translation was turned off while starting'));
    this.teardown();
    this.lastReady = null;
    this.patchState({ status: 'ended', speaking: false, playingPhraseId: null, audioBlocked: false });
    this.emit('ended', { reason });
  }

  private teardown(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    this.vad.reset();
    if (this.capture) {
      this.capture.port.onmessage = null;
      this.capture.disconnect();
      this.capture = null;
    }
    this.micSource?.disconnect();
    this.micSource = null;
    const playingId = this.state.playingPhraseId;
    if (playingId) this.store.patch(playingId, { playing: false, playedUntil: Date.now() });
    this.player?.dispose();
    this.player = null;
    this.ducker.dispose();
    if (this.ownsStream) this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ownsStream = false;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) ctx.onstatechange = null;
    if (ctx && ctx.state !== 'closed') void ctx.close?.()?.catch?.(() => undefined);
    this.resampler = null;
    this.framer = null;
    this.replayRates.clear();
  }

  private createAudioContext(): AudioContext {
    const Ctor = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!Ctor || typeof AudioWorkletNode === 'undefined') {
      throw translationError('TRANSLATION_AUDIO_UNSUPPORTED', 'This browser does not support AudioWorklet');
    }
    return new Ctor() as AudioContext;
  }

  private async resolveStream(): Promise<MediaStream> {
    const given = typeof this.config.stream === 'function' ? this.config.stream() : this.config.stream;
    if (given && given.getAudioTracks().length > 0) {
      this.ownsStream = false;
      return given;
    }
    const media = (globalThis as any).navigator?.mediaDevices as MediaDevices | undefined;
    if (!media?.getUserMedia) {
      throw translationError('TRANSLATION_MICROPHONE_UNAVAILABLE', 'Microphone access is not available');
    }
    try {
      const stream = await media.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this.ownsStream = true;
      return stream;
    } catch (e) {
      const name = (e as { name?: string })?.name;
      throw name === 'NotAllowedError' || name === 'SecurityError'
        ? translationError('TRANSLATION_MICROPHONE_DENIED', 'Microphone permission was denied')
        : translationError('TRANSLATION_MICROPHONE_UNAVAILABLE', 'Could not open the microphone');
    }
  }

  // ── Events ─────────────────────────────────────────────

  private patchState(patch: Partial<TranslationState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.getState());
  }

  private emitPhrases(): void {
    this.emit('phrases', this.store.list());
  }

  private emitError(err: TranslationError): void {
    this.patchState({ error: err });
    this.emit('error', err);
  }

  private emit<K extends TranslationEvent>(event: K, payload: TranslationEventMap[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener(payload);
      } catch {
        // A throwing listener must not break translation.
      }
    }
  }
}

function validMode(mode: unknown): TranslationMode | undefined {
  return MODES.includes(mode as TranslationMode) ? (mode as TranslationMode) : undefined;
}

function baseLanguage(lang: string): string {
  return lang.toLowerCase().split('-')[0];
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_ORIGINAL_VOLUME;
}

function toTranslationError(e: unknown): TranslationError {
  if (e instanceof Error && typeof (e as TranslationError).code === 'string') return e as TranslationError;
  return translationError('TRANSLATION_CONNECTION_FAILED', 'Could not start translation');
}
