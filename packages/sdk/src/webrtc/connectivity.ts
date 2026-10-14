/**
 * WebRTC connectivity helpers shared by the meeting engine: which media path
 * ICE actually selected, whether a trickled candidate belongs to the current
 * remote ICE generation, and the ICE recovery policy (P2P first, TURN kept
 * available, bounded ICE restarts, then a clear failure).
 *
 * No sockets and no RTCPeerConnection ownership here — callers pass stats,
 * descriptions and callbacks in, so everything is unit-testable.
 */

/** P2P = neither selected candidate is a TURN relay; TURN = at least one is. */
export type MediaPath = 'P2P' | 'TURN' | 'UNKNOWN';

export interface SelectedPathInfo {
  path: MediaPath;
  localCandidateType?: string;
  remoteCandidateType?: string;
  /** Transport between the peers (or to the TURN server): 'udp' | 'tcp'. */
  protocol?: string;
  /** Client → TURN server leg for a local relay candidate: 'udp' | 'tcp' | 'tls'. */
  relayProtocol?: string;
  rttMs?: number;
  availableOutgoingBitrate?: number;
}

type StatsLike = { forEach: (cb: (report: any) => void) => void };

/**
 * Finds the candidate pair ICE is actually using and classifies it.
 *
 * Selection order follows what each engine exposes: the transport's
 * `selectedCandidatePairId` (Chromium, Safari), then `selected` (Firefox),
 * then a nominated succeeded pair. Returns UNKNOWN rather than guessing when
 * no pair or no local candidate type is available yet.
 *
 * The local candidate type is authoritative for this side. A remote `prflx`
 * can hide the other side's relay, so the server combines both
 * participants' reports before counting a call as direct.
 */
export function readSelectedPath(stats: StatsLike): SelectedPathInfo {
  const byId = new Map<string, any>();
  const pairs: any[] = [];
  let selectedPairId: string | undefined;
  stats.forEach((report) => {
    if (!report || typeof report !== 'object') return;
    if (report.id) byId.set(report.id, report);
    if (report.type === 'candidate-pair') pairs.push(report);
    if (report.type === 'transport' && report.selectedCandidatePairId)
      selectedPairId = report.selectedCandidatePairId;
  });

  const pair =
    (selectedPairId && byId.get(selectedPairId)) ||
    pairs.find((p) => p.selected === true) ||
    pairs.find((p) => p.state === 'succeeded' && p.nominated) ||
    pairs.find((p) => p.state === 'succeeded');
  if (!pair) return { path: 'UNKNOWN' };

  const local = byId.get(pair.localCandidateId);
  const remote = byId.get(pair.remoteCandidateId);
  const localCandidateType: string | undefined = local?.candidateType;
  const remoteCandidateType: string | undefined = remote?.candidateType;

  let path: MediaPath = 'UNKNOWN';
  if (localCandidateType === 'relay' || remoteCandidateType === 'relay') path = 'TURN';
  else if (localCandidateType) path = 'P2P';

  return {
    path,
    localCandidateType,
    remoteCandidateType,
    protocol: local?.protocol,
    relayProtocol: localCandidateType === 'relay' ? local?.relayProtocol : undefined,
    rttMs:
      typeof pair.currentRoundTripTime === 'number'
        ? Math.round(pair.currentRoundTripTime * 1000)
        : undefined,
    availableOutgoingBitrate:
      typeof pair.availableOutgoingBitrate === 'number'
        ? Math.round(pair.availableOutgoingBitrate)
        : undefined,
  };
}

/** Sum of RTP payload bytes received / sent across all media streams. */
export function readMediaBytes(stats: StatsLike): { inbound: number; outbound: number } {
  let inbound = 0;
  let outbound = 0;
  stats.forEach((report) => {
    if (report?.type === 'inbound-rtp') inbound += report.bytesReceived ?? 0;
    else if (report?.type === 'outbound-rtp') outbound += report.bytesSent ?? 0;
  });
  return { inbound, outbound };
}

/**
 * Whether a trickled candidate can be applied to the current remote
 * description. After an ICE restart, candidates for the new generation can
 * outrun the new offer/answer; adding them to the old description fails
 * ("unknown ufrag") and loses them, so they must wait for the description
 * that carries their ufrag. Candidates without a ufrag are applied as-is.
 */
export function candidateMatchesRemote(
  candidate: RTCIceCandidateInit,
  remote: RTCSessionDescriptionInit | null | undefined,
): boolean {
  if (!remote?.sdp) return false;
  const ufrag = candidate.usernameFragment;
  if (!ufrag) return true;
  return remote.sdp
    .split(/\r?\n/)
    .some((line) => line === `a=ice-ufrag:${ufrag}`);
}

export type ConnectivityStatus = 'connecting' | 'connected' | 'recovering' | 'failed';

export type ConnectivityFailureReason =
  | 'SETUP_TIMEOUT'
  | 'ICE_FAILED'
  | 'ICE_DISCONNECTED'
  | 'MEDIA_STALLED'
  | 'SIGNALING_LOST';

export interface IceRecoveryOptions {
  /** Whether this side may send an ICE-restart offer right now (e.g. it is the offerer and signaling is up). */
  canRestart: () => boolean;
  /** Creates and sends an ICE-restart offer. */
  restart: () => Promise<void> | void;
  /** Recovery gave up: neither a direct nor a relay path could be (re)established. */
  onGiveUp: (reason: ConnectivityFailureReason) => void;
  onStatus?: (status: ConnectivityStatus, reason?: ConnectivityFailureReason) => void;
  /** No connection this long after negotiation started → treat as a failure and recover. */
  setupTimeoutMs?: number;
  /** `disconnected` often heals by itself; wait this long before restarting. */
  disconnectGraceMs?: number;
  /** Delay before each restart attempt (index = attempt number). */
  restartBackoffMs?: number[];
  /** After a restart, wait this long for a connection before trying again. */
  restartCheckMs?: number;
  maxRestarts?: number;
  /** From the first sign of trouble, give up after this long without a connection. */
  failDeadlineMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const ICE_RECOVERY_DEFAULTS = {
  setupTimeoutMs: 15_000,
  disconnectGraceMs: 3_000,
  restartBackoffMs: [0, 2_000, 5_000],
  restartCheckMs: 8_000,
  maxRestarts: 3,
  failDeadlineMs: 35_000,
} as const;

/**
 * ICE recovery policy for one peer connection.
 *
 * TURN stays in the ICE configuration the whole time (iceTransportPolicy
 * 'all'), so a restart re-gathers host, srflx and relay candidates and lets
 * ICE pick a direct pair when one works and the relay when none does. A
 * healthy connection is never restarted; recovery is bounded by
 * `maxRestarts` and `failDeadlineMs`, after which `onGiveUp` fires once.
 */
export class IceRecovery {
  private readonly opts: Required<Omit<IceRecoveryOptions, 'onStatus'>> &
    Pick<IceRecoveryOptions, 'onStatus'>;
  private connected = false;
  private disposed = false;
  private gaveUp = false;
  private episodeReason: ConnectivityFailureReason | null = null;
  private lastStatus = '';
  private attempts = 0;
  private restartInFlight = false;
  private totalRestarts = 0;
  private setupTimer: unknown = null;
  private graceTimer: unknown = null;
  private restartTimer: unknown = null;
  private deadlineTimer: unknown = null;

  constructor(options: IceRecoveryOptions) {
    this.opts = {
      ...ICE_RECOVERY_DEFAULTS,
      restartBackoffMs: [...ICE_RECOVERY_DEFAULTS.restartBackoffMs],
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  /** ICE restarts sent so far for this connection. */
  get restartCount(): number {
    return this.totalRestarts;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get hasGivenUp(): boolean {
    return this.gaveUp;
  }

  /** A recovery episode is running (not connected, not yet given up). */
  get isRecovering(): boolean {
    return !this.disposed && !this.connected && !this.gaveUp && this.episodeReason !== null;
  }

  /** Negotiation has started (offer sent or received): arm the setup deadline. */
  start(): void {
    if (this.disposed || this.connected || this.setupTimer || this.episodeReason) return;
    this.status('connecting');
    this.setupTimer = this.opts.setTimer(() => {
      this.setupTimer = null;
      if (!this.connected) this.trouble('SETUP_TIMEOUT');
    }, this.opts.setupTimeoutMs);
  }

  onIceState(state: RTCIceConnectionState | string): void {
    if (this.disposed) return;
    switch (state) {
      case 'connected':
      case 'completed':
        this.onConnected();
        break;
      case 'disconnected':
        this.connected = false;
        if (this.episodeReason || this.graceTimer) return;
        this.status('recovering', 'ICE_DISCONNECTED');
        this.graceTimer = this.opts.setTimer(() => {
          this.graceTimer = null;
          if (!this.connected) this.trouble('ICE_DISCONNECTED');
        }, this.opts.disconnectGraceMs);
        break;
      case 'failed':
        this.connected = false;
        this.clear('graceTimer');
        this.trouble('ICE_FAILED');
        break;
      case 'closed':
        this.dispose();
        break;
    }
  }

  /** Media stopped arriving although ICE still reports a connection. */
  onMediaStalled(): void {
    if (this.disposed || !this.connected) return;
    this.connected = false;
    this.trouble('MEDIA_STALLED');
  }

  /**
   * Signaling came back (socket reconnected, or the peer rejoined the room).
   * Restart offers sent while it was down were dropped, so retry now if a
   * recovery is in progress — never for a healthy or not-yet-started call.
   */
  onSignalingRestored(): void {
    if (this.disposed || this.connected || !this.episodeReason || this.gaveUp) return;
    if (this.restartInFlight) return;
    this.clear('restartTimer');
    if (this.attempts >= this.opts.maxRestarts) this.attempts = this.opts.maxRestarts - 1;
    this.scheduleRestart(0);
  }

  dispose(): void {
    this.disposed = true;
    this.clear('setupTimer');
    this.clear('graceTimer');
    this.clear('restartTimer');
    this.clear('deadlineTimer');
  }

  private onConnected(): void {
    this.connected = true;
    this.episodeReason = null;
    this.attempts = 0;
    this.clear('setupTimer');
    this.clear('graceTimer');
    this.clear('restartTimer');
    this.clear('deadlineTimer');
    this.gaveUp = false;
    this.status('connected');
  }

  private trouble(reason: ConnectivityFailureReason): void {
    if (this.disposed || this.connected || this.gaveUp) return;
    this.clear('setupTimer');
    if (!this.episodeReason) {
      this.episodeReason = reason;
      this.status('recovering', reason);
      this.deadlineTimer = this.opts.setTimer(() => {
        this.deadlineTimer = null;
        if (this.connected) return;
        this.gaveUp = true;
        this.clear('restartTimer');
        this.status('failed', this.episodeReason ?? reason);
        this.opts.onGiveUp(this.episodeReason ?? reason);
      }, this.opts.failDeadlineMs);
    } else {
      this.episodeReason = reason;
    }
    if (!this.restartTimer && !this.restartInFlight) this.scheduleRestart();
  }

  private scheduleRestart(delayOverride?: number): void {
    if (this.attempts >= this.opts.maxRestarts) return;
    const backoff = this.opts.restartBackoffMs;
    const delay = delayOverride ?? backoff[Math.min(this.attempts, backoff.length - 1)] ?? 0;
    this.restartTimer = this.opts.setTimer(() => {
      this.restartTimer = null;
      void this.runRestart();
    }, delay);
  }

  private async runRestart(): Promise<void> {
    if (this.disposed || this.connected || this.gaveUp || this.restartInFlight) return;
    if (!this.opts.canRestart()) {
      // The other side drives the restart (or signaling is down and
      // onSignalingRestored will retry). The deadline still applies.
      return;
    }
    this.attempts++;
    this.totalRestarts++;
    this.restartInFlight = true;
    try {
      await this.opts.restart();
    } catch {
      /* counted as an attempt; the check below retries */
    } finally {
      this.restartInFlight = false;
    }
    if (this.disposed || this.connected || this.gaveUp) return;
    this.restartTimer = this.opts.setTimer(() => {
      this.restartTimer = null;
      if (!this.connected) this.scheduleRestart();
    }, this.opts.restartCheckMs);
  }

  /** Forwards status changes, dropping exact repeats. */
  private status(status: ConnectivityStatus, reason?: ConnectivityFailureReason): void {
    const key = `${status}:${reason ?? ''}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.opts.onStatus?.(status, reason);
  }

  private clear(key: 'setupTimer' | 'graceTimer' | 'restartTimer' | 'deadlineTimer'): void {
    if (this[key]) {
      this.opts.clearTimer(this[key]);
      this[key] = null;
    }
  }
}
