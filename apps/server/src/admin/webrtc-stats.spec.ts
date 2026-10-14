import { percentile, summarizeWebrtcEvents, WebrtcEvent } from './webrtc-stats';

const transport = (
  callId: string,
  role: 'CALLER' | 'RECEIVER',
  meta: Record<string, unknown>,
): WebrtcEvent => ({
  callId,
  event: 'WEBRTC_TRANSPORT',
  participantId: role === 'CALLER' ? 'alice' : 'bob',
  metadata: { role, ...meta },
});

const ice = (
  callId: string,
  outcome: 'SUCCESS' | 'FAILED',
  meta: Record<string, unknown> = {},
): WebrtcEvent => ({
  callId,
  event: outcome === 'SUCCESS' ? 'WEBRTC_ICE_SUCCESS' : 'WEBRTC_ICE_FAILED',
  participantId: 'alice',
  metadata: meta,
});

describe('summarizeWebrtcEvents', () => {
  it('counts a call as P2P only when both sides confirm a non-relay path', () => {
    const s = summarizeWebrtcEvents([
      // Both sides report P2P.
      transport('both', 'CALLER', { transport: 'P2P', candidateType: 'host' }),
      transport('both', 'RECEIVER', {
        transport: 'P2P',
        candidateType: 'srflx',
      }),
      // One side, but it saw the remote as srflx: confirmed.
      transport('confirmed', 'CALLER', {
        transport: 'P2P',
        candidateType: 'srflx',
        remoteCandidateType: 'srflx',
      }),
      // One side, remote prflx (could hide a relay): unknown, not P2P.
      transport('single', 'CALLER', {
        transport: 'P2P',
        candidateType: 'host',
        remoteCandidateType: 'prflx',
      }),
    ]);
    expect(s.p2pCalls).toBe(2);
    expect(s.unknownCalls).toBe(1);
    expect(s.turnCalls).toBe(0);
    expect(s.p2pPercent).toBe(100);
  });

  it('is sticky TURN: any relay on either side makes the call TURN', () => {
    const s = summarizeWebrtcEvents([
      transport('a', 'CALLER', { transport: 'P2P', candidateType: 'host' }),
      transport('a', 'RECEIVER', { transport: 'TURN', candidateType: 'relay' }),
      transport('b', 'CALLER', {
        transport: 'P2P',
        candidateType: 'srflx',
        remoteCandidateType: 'relay',
      }),
      transport('c', 'CALLER', {
        transport: 'P2P',
        remoteCandidateType: 'host',
      }),
    ]);
    expect(s.turnCalls).toBe(2);
    expect(s.p2pCalls).toBe(1);
    expect(s.turnPercent).toBe(66.7);
  });

  it('keys the two sides by role, so callerId === receiverId still confirms P2P', () => {
    const s = summarizeWebrtcEvents([
      {
        ...transport('same', 'CALLER', { transport: 'P2P' }),
        participantId: 'u',
      },
      {
        ...transport('same', 'RECEIVER', { transport: 'P2P' }),
        participantId: 'u',
      },
    ]);
    expect(s.p2pCalls).toBe(1);
  });

  it('reports ICE success (recovered counts as success), failure reasons and restart recovery', () => {
    const s = summarizeWebrtcEvents([
      ice('ok', 'SUCCESS'),
      ice('recovered', 'FAILED', { reason: 'ICE_FAILED' }),
      ice('recovered', 'SUCCESS', { iceRestarts: 1 }),
      ice('dead', 'FAILED', { reason: 'ICE_FAILED' }),
      ice('dead', 'FAILED', {
        reason: 'RECOVERY_EXHAUSTED',
        cause: 'SETUP_TIMEOUT',
        iceRestarts: 3,
      }),
      ice('legacy', 'FAILED'),
    ]);
    expect(s.iceSuccessRate).toBe(50);
    expect(s.iceFailureRate).toBe(50);
    expect(s.failureReasons).toEqual({ SETUP_TIMEOUT: 1, UNSPECIFIED: 1 });
    expect(s.iceRestartCalls).toBe(2);
    expect(s.iceRestartRecoveryRate).toBe(50);
  });

  it('computes setup and first-media percentiles from the slower side of each call', () => {
    const s = summarizeWebrtcEvents([
      transport('a', 'CALLER', {
        transport: 'P2P',
        setupMs: 400,
        firstMediaMs: 600,
        mediaVerified: true,
      }),
      transport('a', 'RECEIVER', {
        transport: 'P2P',
        setupMs: 900,
        firstMediaMs: 1000,
        mediaVerified: true,
      }),
      transport('b', 'CALLER', {
        transport: 'TURN',
        setupMs: 3000,
        mediaVerified: false,
      }),
    ]);
    expect(s.setupMsP50).toBe(900);
    expect(s.setupMsP95).toBe(3000);
    expect(s.firstMediaMsP50).toBe(1000);
    expect(s.mediaVerifiedPercent).toBe(50);
  });

  it('is not available, with null percentages, when nothing was reported', () => {
    const s = summarizeWebrtcEvents([]);
    expect(s.available).toBe(false);
    expect(s.p2pPercent).toBeNull();
    expect(s.iceSuccessRate).toBeNull();
    expect(s.setupMsP50).toBeNull();
  });

  it('ignores malformed metadata', () => {
    const s = summarizeWebrtcEvents([
      { callId: 'x', event: 'WEBRTC_TRANSPORT', metadata: null },
      {
        callId: 'y',
        event: 'WEBRTC_TRANSPORT',
        metadata: { transport: 'MAYBE' },
      },
    ]);
    expect(s.p2pCalls + s.turnCalls + s.unknownCalls).toBe(0);
  });
});

describe('percentile', () => {
  it('uses nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });
});
