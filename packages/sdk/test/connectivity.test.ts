import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IceRecovery,
  candidateMatchesRemote,
  readMediaBytes,
  readSelectedPath,
  type IceRecoveryOptions,
} from '../src/webrtc/connectivity';

const statsOf = (...reports: Array<Record<string, unknown>>) =>
  new Map(reports.map((r) => [r.id as string, r]));

const candidate = (id: string, candidateType: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: id.startsWith('L') ? 'local-candidate' : 'remote-candidate',
  candidateType,
  ...extra,
});

describe('readSelectedPath', () => {
  it('uses the transport selectedCandidatePairId (Chromium/Safari), not just any succeeded pair', () => {
    const stats = statsOf(
      { id: 'T', type: 'transport', selectedCandidatePairId: 'P2' },
      { id: 'P1', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'L1', remoteCandidateId: 'R1' },
      { id: 'P2', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'L2', remoteCandidateId: 'R2', currentRoundTripTime: 0.042 },
      candidate('L1', 'relay'),
      candidate('R1', 'host'),
      candidate('L2', 'srflx', { protocol: 'udp' }),
      candidate('R2', 'host'),
    );
    expect(readSelectedPath(stats)).toEqual(
      expect.objectContaining({ path: 'P2P', localCandidateType: 'srflx', remoteCandidateType: 'host', protocol: 'udp', rttMs: 42 }),
    );
  });

  it('uses the `selected` flag (Firefox)', () => {
    const stats = statsOf(
      { id: 'P1', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'L1', remoteCandidateId: 'R1' },
      { id: 'P2', type: 'candidate-pair', state: 'succeeded', selected: true, localCandidateId: 'L2', remoteCandidateId: 'R2' },
      candidate('L1', 'host'),
      candidate('R1', 'host'),
      candidate('L2', 'relay', { protocol: 'udp', relayProtocol: 'tls' }),
      candidate('R2', 'srflx'),
    );
    expect(readSelectedPath(stats)).toEqual(
      expect.objectContaining({ path: 'TURN', localCandidateType: 'relay', relayProtocol: 'tls' }),
    );
  });

  it('counts a remote relay candidate as TURN even when the local side is direct', () => {
    const stats = statsOf(
      { id: 'P', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'L', remoteCandidateId: 'R' },
      candidate('L', 'host'),
      candidate('R', 'relay'),
    );
    expect(readSelectedPath(stats).path).toBe('TURN');
  });

  it('is UNKNOWN, not P2P, when no pair is selected or the local type is missing', () => {
    expect(readSelectedPath(statsOf()).path).toBe('UNKNOWN');
    expect(
      readSelectedPath(
        statsOf({ id: 'P', type: 'candidate-pair', state: 'in-progress', localCandidateId: 'L', remoteCandidateId: 'R' }, candidate('L', 'host')),
      ).path,
    ).toBe('UNKNOWN');
    expect(
      readSelectedPath(statsOf({ id: 'P', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'L' })).path,
    ).toBe('UNKNOWN');
  });

  it('sums inbound and outbound RTP bytes', () => {
    const stats = statsOf(
      { id: 'a', type: 'inbound-rtp', bytesReceived: 100 },
      { id: 'b', type: 'inbound-rtp', bytesReceived: 50 },
      { id: 'c', type: 'outbound-rtp', bytesSent: 70 },
    );
    expect(readMediaBytes(stats)).toEqual({ inbound: 150, outbound: 70 });
  });
});

describe('candidateMatchesRemote', () => {
  const remote = { type: 'offer' as const, sdp: 'v=0\r\na=ice-ufrag:gen2\r\na=ice-pwd:x\r\n' };

  it('holds every candidate until a remote description exists', () => {
    expect(candidateMatchesRemote({ candidate: 'c' }, null)).toBe(false);
  });

  it('applies candidates of the current ICE generation, or without a ufrag', () => {
    expect(candidateMatchesRemote({ candidate: 'c', usernameFragment: 'gen2' }, remote)).toBe(true);
    expect(candidateMatchesRemote({ candidate: 'c' }, remote)).toBe(true);
  });

  it('holds candidates of a newer ICE generation (after an ICE restart)', () => {
    expect(candidateMatchesRemote({ candidate: 'c', usernameFragment: 'gen3' }, remote)).toBe(false);
    // Prefix of a ufrag is not a match.
    expect(candidateMatchesRemote({ candidate: 'c', usernameFragment: 'gen' }, remote)).toBe(false);
  });
});

describe('IceRecovery', () => {
  let restart: ReturnType<typeof vi.fn>;
  let onGiveUp: ReturnType<typeof vi.fn>;
  let statuses: string[];
  let canRestart: boolean;

  const make = (overrides: Partial<IceRecoveryOptions> = {}) =>
    new IceRecovery({
      canRestart: () => canRestart,
      restart,
      onGiveUp,
      onStatus: (status, reason) => statuses.push(reason ? `${status}:${reason}` : status),
      ...overrides,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    restart = vi.fn(async () => {});
    onGiveUp = vi.fn();
    statuses = [];
    canRestart = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never restarts a healthy connection', async () => {
    const r = make();
    r.start();
    r.onIceState('checking');
    r.onIceState('connected');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(restart).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('gives a transient `disconnected` a grace period to heal on its own', async () => {
    const r = make();
    r.onIceState('connected');
    r.onIceState('disconnected');
    await vi.advanceTimersByTimeAsync(2_000);
    r.onIceState('connected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(restart).not.toHaveBeenCalled();
  });

  it('restarts ICE after a persistent `disconnected`', async () => {
    const r = make();
    r.onIceState('connected');
    r.onIceState('disconnected');
    await vi.advanceTimersByTimeAsync(2_999);
    expect(restart).not.toHaveBeenCalled();
    // +1ms: fake timers run a 0ms timer scheduled mid-tick on the next ms.
    await vi.advanceTimersByTimeAsync(2);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(r.restartCount).toBe(1);
  });

  it('restarts immediately on `failed`, retries with backoff, then gives up once with a clear reason', async () => {
    const r = make();
    r.start();
    r.onIceState('failed');
    await vi.advanceTimersByTimeAsync(0);
    expect(restart).toHaveBeenCalledTimes(1);
    // check window (8s) + backoff (2s)
    await vi.advanceTimersByTimeAsync(10_000);
    expect(restart).toHaveBeenCalledTimes(2);
    // check window (8s) + backoff (5s)
    await vi.advanceTimersByTimeAsync(13_000);
    expect(restart).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(restart).toHaveBeenCalledTimes(3); // bounded
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith('ICE_FAILED');
    expect(statuses.at(-1)).toBe('failed:ICE_FAILED');
    expect(r.hasGivenUp).toBe(true);
  });

  it('a call stuck in `checking` hits the setup timeout and recovers instead of hanging', async () => {
    const r = make();
    r.start();
    r.onIceState('checking');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('recovering:SETUP_TIMEOUT');
    r.onIceState('connected');
    await vi.advanceTimersByTimeAsync(100_000);
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('connected');
  });

  it('the non-offering side never restarts but still fails clearly at the deadline', async () => {
    canRestart = false;
    const r = make();
    r.start();
    r.onIceState('failed');
    await vi.advanceTimersByTimeAsync(34_999);
    expect(onGiveUp).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(restart).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledWith('ICE_FAILED');
  });

  it('retries as soon as signaling is restored, but only during a recovery', async () => {
    canRestart = false; // signaling down
    const r = make();
    r.onIceState('connected');
    r.onSignalingRestored();
    expect(restart).not.toHaveBeenCalled();

    r.onIceState('failed');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restart).not.toHaveBeenCalled();

    canRestart = true;
    r.onSignalingRestored();
    await vi.advanceTimersByTimeAsync(0);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('a recovery after giving up returns the call to connected', async () => {
    const r = make({ maxRestarts: 1, failDeadlineMs: 1_000 });
    r.onIceState('failed');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    r.onIceState('connected');
    expect(r.hasGivenUp).toBe(false);
    expect(statuses.at(-1)).toBe('connected');
  });

  it('treats stalled media on a "connected" call as a failure to recover from', async () => {
    const r = make();
    r.onIceState('connected');
    r.onMediaStalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('recovering:MEDIA_STALLED');
  });

  it('does not overlap restarts while one is in flight', async () => {
    let finish!: () => void;
    restart.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    const r = make();
    r.onIceState('failed');
    await vi.advanceTimersByTimeAsync(0);
    r.onIceState('failed');
    r.onSignalingRestored();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restart).toHaveBeenCalledTimes(1);
    finish();
  });

  it('isRecovering is true only during a recovery episode', async () => {
    const r = make({ failDeadlineMs: 1_000 });
    expect(r.isRecovering).toBe(false);
    r.onIceState('connected');
    expect(r.isRecovering).toBe(false);
    r.onIceState('failed');
    expect(r.isRecovering).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.isRecovering).toBe(false); // gave up
  });

  it('dispose() cancels every pending timer', async () => {
    const r = make();
    r.start();
    r.onIceState('failed');
    r.dispose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(restart).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });
});
