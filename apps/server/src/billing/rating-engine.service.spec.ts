import { RatingEngineService } from './rating-engine.service';
import { ParticipantMediaState } from './usage-segment.service';

/**
 * The billing basis is participant-minutes: each participant's own media
 * state over a segment's wall-clock duration. These tests pin that down so
 * a 10-minute call with N participants is never rated as 10 minutes.
 */
describe('RatingEngineService — participant-minute rating', () => {
  const RATES = {
    audioPaise: 20,
    videoPaise: 80,
    screenSharePaise: 10,
    freeAudioMins: 500,
    freeVideoMins: 200,
    taxPercent: 18,
  };
  const t0 = new Date('2026-09-01T10:00:00Z');
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  const p = (
    participantId: string,
    media: Partial<Omit<ParticipantMediaState, 'participantId'>>,
  ): ParticipantMediaState => ({
    participantId,
    audio: false,
    video: false,
    screenShare: false,
    ...media,
  });

  function makeEngine(
    segs: { from: number; to: number; participants: ParticipantMediaState[] }[],
  ) {
    const segmentService = {
      getSegmentsForCall: jest.fn().mockResolvedValue(
        segs.map((s) => ({
          startedAt: at(s.from),
          endedAt: at(s.to),
          participantCount: s.participants.length,
          audio: s.participants.some((x) => x.audio),
          video: s.participants.some((x) => x.video),
          screenShare: s.participants.some((x) => x.screenShare),
          participants: s.participants,
        })),
      ),
    };
    const usageBilling = { getRates: jest.fn().mockResolvedValue(RATES) };
    return new RatingEngineService(
      {} as never,
      segmentService as never,
      usageBilling as never,
    );
  }

  it.each([
    [1, 10],
    [2, 20],
    [3, 30],
  ])(
    '%i audio participant(s) × 10 minutes => %i audio participant-minutes',
    async (n, expected) => {
      const participants = Array.from({ length: n }, (_, i) =>
        p(`p${i}`, { audio: true }),
      );
      const engine = makeEngine([{ from: 0, to: 10, participants }]);
      const { totals } = await engine.rateCall('call-1');
      expect(totals.audioMins).toBeCloseTo(expected);
      expect(totals.videoMins).toBe(0);
      expect(totals.screenShareMins).toBe(0);
      expect(totals.costPaise).toBe(Math.round(expected * RATES.audioPaise));
    },
  );

  it('2 participants × 10 minutes, both cameras on => 20 video participant-minutes', async () => {
    const engine = makeEngine([
      {
        from: 0,
        to: 10,
        participants: [p('a', { video: true }), p('b', { video: true })],
      },
    ]);
    const { totals } = await engine.rateCall('call-1');
    expect(totals.videoMins).toBeCloseTo(20);
    expect(totals.audioMins).toBe(0);
  });

  it('2 participants × 10 minutes, only one camera on => 10 video participant-minutes', async () => {
    const engine = makeEngine([
      { from: 0, to: 10, participants: [p('a', { video: true }), p('b', {})] },
    ]);
    const { totals } = await engine.rateCall('call-1');
    expect(totals.videoMins).toBeCloseTo(10);
  });

  it('mixed media: A audio+video, B audio only => 20 audio, 10 video participant-minutes', async () => {
    const engine = makeEngine([
      {
        from: 0,
        to: 10,
        participants: [
          p('a', { audio: true, video: true }),
          p('b', { audio: true }),
        ],
      },
    ]);
    const { totals } = await engine.rateCall('call-1');
    expect(totals.audioMins).toBeCloseTo(20);
    expect(totals.videoMins).toBeCloseTo(10);
    expect(totals.screenShareMins).toBe(0);
  });

  it('1 participant sharing their screen for 5 minutes => 5 screen-share participant-minutes (not × all participants)', async () => {
    const engine = makeEngine([
      {
        from: 0,
        to: 5,
        participants: [
          p('a', { video: true, screenShare: true }),
          p('b', { video: true }),
          p('c', { video: true }),
        ],
      },
    ]);
    const { totals } = await engine.rateCall('call-1');
    expect(totals.screenShareMins).toBeCloseTo(5);
    expect(totals.videoMins).toBeCloseTo(15);
  });

  it('keeps fractional participant-minutes unrounded (33 sec × 2 = 1.1)', async () => {
    const engine = makeEngine([
      {
        from: 0,
        to: 33 / 60,
        participants: [p('a', { video: true }), p('b', { video: true })],
      },
    ]);
    const { totals, segments } = await engine.rateCall('call-1');
    expect(totals.videoMins).toBeCloseTo(1.1, 10);
    expect(segments[0].seconds).toBeCloseTo(33);
    expect(segments[0].videoMins).toBeCloseTo(1.1, 10);
  });

  it('sums participant-minutes across segments as participants join and leave', async () => {
    const engine = makeEngine([
      { from: 0, to: 4, participants: [p('a', { audio: true })] },
      {
        from: 4,
        to: 10,
        participants: [p('a', { audio: true }), p('b', { audio: true })],
      },
    ]);
    const { totals } = await engine.rateCall('call-1');
    // 4 × 1 + 6 × 2 = 16 participant-minutes over a 10-minute call.
    expect(totals.audioMins).toBeCloseTo(16);
  });
});
