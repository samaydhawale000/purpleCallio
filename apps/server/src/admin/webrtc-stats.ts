/**
 * Aggregates client-reported WebRTC telemetry (CallEvent rows written by
 * CallService.recordWebrtcTransport / recordWebrtcIceOutcome) into
 * per-period connectivity metrics. Pure, so it can be unit-tested.
 *
 * Media path per call:
 *  - TURN if ANY report says TURN or saw a remote relay candidate: media
 *    went through the relay for at least one leg ("sticky": a later P2P
 *    report never downgrades it).
 *  - P2P only when confirmed on both ends: both participants reported a
 *    non-relay local candidate, or one report saw the remote side's
 *    candidate as host/srflx. A remote `prflx` can hide the other side's
 *    relay, so a single report without that confirmation is UNKNOWN.
 *
 * ICE outcome per call: SUCCESS wins over FAILED (a call that failed and
 * recovered via ICE restart "eventually connected"). Failure reasons come
 * from calls whose final outcome is FAILED.
 */

export type WebrtcEvent = {
  callId: string;
  event: string;
  participantId?: string | null;
  metadata: unknown;
};

type TransportMeta = {
  transport?: unknown;
  role?: unknown;
  remoteCandidateType?: unknown;
  setupMs?: unknown;
  firstMediaMs?: unknown;
  mediaVerified?: unknown;
  iceRestarts?: unknown;
};

type IceMeta = { reason?: unknown; cause?: unknown; iceRestarts?: unknown };

const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : null;

/** Nearest-rank percentile of an unsorted list; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarizeWebrtcEvents(events: WebrtcEvent[]) {
  type CallAgg = {
    turn: boolean;
    p2pParticipants: Set<string>;
    p2pReports: number;
    remoteConfirmedDirect: boolean;
    setupMs: number | null;
    firstMediaMs: number | null;
    mediaVerified: boolean | null;
    restarts: number;
    ice: 'SUCCESS' | 'FAILED' | null;
    failureReason: string | null;
  };
  const calls = new Map<string, CallAgg>();
  const callOf = (id: string) => {
    let c = calls.get(id);
    if (!c) {
      c = {
        turn: false,
        p2pParticipants: new Set(),
        p2pReports: 0,
        remoteConfirmedDirect: false,
        setupMs: null,
        firstMediaMs: null,
        mediaVerified: null,
        restarts: 0,
        ice: null,
        failureReason: null,
      };
      calls.set(id, c);
    }
    return c;
  };

  let transportReported = false;
  for (const e of events) {
    if (e.event === 'WEBRTC_TRANSPORT') {
      const m = (e.metadata ?? {}) as TransportMeta;
      if (m.transport !== 'P2P' && m.transport !== 'TURN') continue;
      transportReported = true;
      const c = callOf(e.callId);
      if (m.transport === 'TURN' || m.remoteCandidateType === 'relay') {
        c.turn = true;
      } else {
        c.p2pReports++;
        const side =
          typeof m.role === 'string' ? m.role : (e.participantId ?? null);
        if (side) c.p2pParticipants.add(side);
        if (
          m.remoteCandidateType === 'host' ||
          m.remoteCandidateType === 'srflx'
        )
          c.remoteConfirmedDirect = true;
      }
      // The call is set up when the slower side is.
      const setup = num(m.setupMs);
      if (setup !== null) c.setupMs = Math.max(c.setupMs ?? 0, setup);
      const firstMedia = num(m.firstMediaMs);
      if (firstMedia !== null)
        c.firstMediaMs = Math.max(c.firstMediaMs ?? 0, firstMedia);
      if (typeof m.mediaVerified === 'boolean')
        c.mediaVerified = (c.mediaVerified ?? true) && m.mediaVerified;
      c.restarts = Math.max(c.restarts, num(m.iceRestarts) ?? 0);
    } else if (
      e.event === 'WEBRTC_ICE_SUCCESS' ||
      e.event === 'WEBRTC_ICE_FAILED'
    ) {
      const m = (e.metadata ?? {}) as IceMeta;
      const c = callOf(e.callId);
      c.restarts = Math.max(c.restarts, num(m.iceRestarts) ?? 0);
      if (e.event === 'WEBRTC_ICE_SUCCESS') {
        c.ice = 'SUCCESS';
      } else {
        if (c.ice !== 'SUCCESS') c.ice = 'FAILED';
        // Prefer the cause of a final give-up over the first ICE failure.
        const reason =
          m.reason === 'RECOVERY_EXHAUSTED' && typeof m.cause === 'string'
            ? m.cause
            : typeof m.reason === 'string'
              ? m.reason
              : null;
        if (reason && (m.reason === 'RECOVERY_EXHAUSTED' || !c.failureReason))
          c.failureReason = reason;
      }
    }
  }

  let p2pCalls = 0;
  let turnCalls = 0;
  let unknownCalls = 0;
  let iceSuccessful = 0;
  let iceFailed = 0;
  let restartedCalls = 0;
  let recoveredCalls = 0;
  let verifiedCalls = 0;
  let verifiableCalls = 0;
  const setupTimes: number[] = [];
  const firstMediaTimes: number[] = [];
  const failureReasons: Record<string, number> = {};

  for (const c of calls.values()) {
    const hasTransport = c.turn || c.p2pReports > 0;
    if (c.turn) turnCalls++;
    else if (c.p2pParticipants.size >= 2 || c.remoteConfirmedDirect) p2pCalls++;
    else if (hasTransport) unknownCalls++;

    if (c.ice === 'SUCCESS') iceSuccessful++;
    else if (c.ice === 'FAILED') {
      iceFailed++;
      const reason = c.failureReason ?? 'UNSPECIFIED';
      failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
    }
    if (c.restarts > 0) {
      restartedCalls++;
      if (c.ice === 'SUCCESS') recoveredCalls++;
    }
    if (c.setupMs !== null) setupTimes.push(c.setupMs);
    if (c.firstMediaMs !== null) firstMediaTimes.push(c.firstMediaMs);
    if (c.mediaVerified !== null) {
      verifiableCalls++;
      if (c.mediaVerified) verifiedCalls++;
    }
  }

  const knownTransport = p2pCalls + turnCalls;
  const totalIce = iceSuccessful + iceFailed;

  return {
    available: transportReported || totalIce > 0,
    p2pCalls,
    turnCalls,
    /** Path reported by only one side without remote confirmation. */
    unknownCalls,
    p2pPercent: pct(p2pCalls, knownTransport),
    turnPercent: pct(turnCalls, knownTransport),
    iceSuccessRate: pct(iceSuccessful, totalIce),
    iceFailureRate: pct(iceFailed, totalIce),
    failureReasons,
    setupMsP50: percentile(setupTimes, 50),
    setupMsP95: percentile(setupTimes, 95),
    firstMediaMsP50: percentile(firstMediaTimes, 50),
    firstMediaMsP95: percentile(firstMediaTimes, 95),
    mediaVerifiedPercent: pct(verifiedCalls, verifiableCalls),
    iceRestartCalls: restartedCalls,
    iceRestartRecoveryRate: pct(recoveredCalls, restartedCalls),
  };
}
