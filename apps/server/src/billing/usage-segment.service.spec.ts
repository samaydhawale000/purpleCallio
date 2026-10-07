import { UsageSegmentService } from './usage-segment.service';

describe('UsageSegmentService', () => {
  const service = new UsageSegmentService({} as never);
  const at = (seconds: number) => new Date(seconds * 1000);

  it('keeps a seven-second two-participant call at seven seconds of elapsed media time', () => {
    const segments = service.buildSegmentsFromEvents([
      {
        event: 'CALL_STARTED',
        participantId: 'caller',
        createdAt: at(0),
        metadata: { callType: 'AUDIO' },
      },
      {
        event: 'PARTICIPANT_JOINED',
        participantId: 'receiver',
        createdAt: at(0),
      },
      { event: 'CALL_ENDED', participantId: 'caller', createdAt: at(7) },
    ]);

    expect(segments).toHaveLength(1);
    expect(
      segments[0].endedAt.getTime() - segments[0].startedAt.getTime(),
    ).toBe(7000);
    expect(segments[0].participantCount).toBe(2);
  });

  it('does not classify video calls as audio usage', () => {
    const segments = service.buildSegmentsFromEvents([
      {
        event: 'PARTICIPANT_JOINED',
        participantId: 'receiver',
        createdAt: at(0),
      },
      {
        event: 'CALL_STARTED',
        participantId: 'caller',
        createdAt: at(0),
        metadata: { callType: 'VIDEO' },
      },
      { event: 'CAMERA_ENABLED', participantId: 'caller', createdAt: at(1) },
      { event: 'CALL_ENDED', participantId: 'caller', createdAt: at(7) },
    ]);

    expect(segments.some((segment) => segment.audio)).toBe(false);
    expect(segments.some((segment) => segment.video)).toBe(true);
  });

  it('defaults a video call to video-on from the start, with no camera toggle', () => {
    const segments = service.buildSegmentsFromEvents([
      {
        event: 'CALL_STARTED',
        participantId: 'caller',
        createdAt: at(0),
        metadata: { callType: 'VIDEO' },
      },
      {
        event: 'PARTICIPANT_JOINED',
        participantId: 'receiver',
        createdAt: at(0),
      },
      { event: 'CALL_ENDED', participantId: 'caller', createdAt: at(7) },
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].video).toBe(true);
    expect(segments[0].audio).toBe(false);
    for (const p of segments[0].participants) {
      expect(p.video).toBe(true);
      expect(p.audio).toBe(false);
    }
  });
});
