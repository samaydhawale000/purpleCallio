import { describe, expect, it, vi } from 'vitest';
import { ParticipantStore } from '../src/state/participant-store';

describe('ParticipantStore snapshots', () => {
  it('replaces participant state atomically from the initial call snapshot', () => {
    const store = new ParticipantStore();
    store.upsert({ participantId: 'stale', role: 'CALLER' });
    const listener = vi.fn();
    store.onChange(listener);

    store.replace([
      { participantId: 'self', role: 'CALLER', media: { camera: false, microphone: true, screenShare: false } },
      { participantId: 'remote', role: 'RECEIVER', media: { camera: true, microphone: true, screenShare: false } },
    ]);

    expect(store.list().map(({ participantId }) => participantId)).toEqual(['self', 'remote']);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
