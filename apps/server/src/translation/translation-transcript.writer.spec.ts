import { TranslationTranscriptWriter } from './translation-transcript.writer';

describe('TranslationTranscriptWriter', () => {
  it('redacts and sets expiresAt from the retention days', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-22T00:00:00Z') });
    const upsert = jest.fn(async () => ({}));
    const writer = new TranslationTranscriptWriter({ translationPhrase: { upsert } } as any);
    await writer.write(
      'call_1',
      {
        phraseId: 'caller-1',
        speaker: 'caller',
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        original: 'mail me at a@b.com, card 4111 1111 1111 1111',
        translated: 'ok',
        startedAt: Date.now(),
        guardStatus: 'uncertain',
        guardReasons: ['term_mismatch:amount'],
      },
      7,
    );
    await writer.flush('call_1');
    const arg = (upsert.mock.calls[0] as any)[0];
    expect(arg.where).toEqual({ callId_phraseId: { callId: 'call_1', phraseId: 'caller-1' } });
    expect(arg.create.original).toBe('mail me at [redacted email], card [redacted number]');
    expect(arg.create.expiresAt).toEqual(new Date('2026-10-29T00:00:00Z'));
    expect(arg.create.guardReasons).toEqual(['term_mismatch:amount']);
    jest.useRealTimers();
  });

  it('never throws on a write failure', async () => {
    const writer = new TranslationTranscriptWriter({
      translationPhrase: { upsert: jest.fn(async () => Promise.reject(new Error('db'))) },
    } as any);
    jest.spyOn((writer as any).logger, 'error').mockImplementation(() => undefined);
    await expect(
      writer.write('c', { phraseId: 'x', speaker: 'caller', sourceLanguage: 'en', targetLanguage: 'hi', original: 'a', translated: 'b', startedAt: 0 }, 1),
    ).resolves.toBeUndefined();
  });
});
