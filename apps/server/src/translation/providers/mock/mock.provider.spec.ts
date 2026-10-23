import { MockTranslationProvider, mockPhrase, alterAmount } from './mock.provider';

describe('MockTranslationProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.TRANSLATION_MOCK_LATENCY_MS = '50';
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.TRANSLATION_MOCK_LATENCY_MS;
  });

  it('is always configured and supports everything', () => {
    const p = new MockTranslationProvider();
    expect(p.name).toBe('mock');
    expect(p.isConfigured()).toBe(true);
    expect(p.supports('xx', 'yy', 'voice')).toBe(true);
  });

  it('is deterministic and keeps numbers except on every 5th phrase', () => {
    expect(mockPhrase(1, 1, 'hi', 'en')).toEqual(mockPhrase(1, 1, 'hi', 'en'));
    const fifth = mockPhrase(1, 5, 'hi', 'en');
    expect(fifth.altered).toBe(true);
    expect(fifth.original).toContain('₹2,500');
    expect(fifth.translated).toContain('₹25,000');
    const first = mockPhrase(0, 1, 'hi', 'en');
    expect(first.translated).toBe('[hi→en] The fee is ₹2,500 for 3 visits.');
    expect(alterAmount('₹1,200 today')).toBe('₹12,000 today');
  });

  it('voice: partials, finals, a 0.6 s 24 kHz tone in 100 ms chunks, then phraseDone', async () => {
    const session = await new MockTranslationProvider().connect({
      sourceLanguage: 'hi',
      targetLanguage: 'en',
      mode: 'voice',
      lexicon: [],
    });
    const events: string[] = [];
    const audio: Buffer[] = [];
    session.on('transcript', (e) => events.push(`t:${e.final}`));
    session.on('translation', (e) => events.push(`x:${e.final}:${e.text}`));
    session.on('audio', (pcm) => audio.push(pcm));
    session.on('phraseDone', () => events.push('done'));
    session.on('usage', () => events.push('usage'));
    for (let i = 0; i < 50; i++) session.sendAudio(Buffer.alloc(640)); // 1 s
    session.endOfSpeech();
    await jest.advanceTimersByTimeAsync(1000);
    expect(events.filter((e) => e === 't:false').length).toBeGreaterThan(0);
    expect(events).toContain('t:true');
    expect(events.find((e) => e.startsWith('x:true'))).toContain('[hi→en]');
    expect(audio).toHaveLength(6);
    expect(audio.every((a) => a.length === 4800)).toBe(true);
    expect(events.at(-1)).toBe('done');
  });

  it('captions: no audio', async () => {
    const session = await new MockTranslationProvider().connect({
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      mode: 'captions',
      lexicon: [],
    });
    const audio = jest.fn();
    const done = jest.fn();
    session.on('audio', audio);
    session.on('phraseDone', done);
    session.sendAudio(Buffer.alloc(16000));
    session.endOfSpeech();
    await jest.advanceTimersByTimeAsync(500);
    expect(audio).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('close stops pending events and emits closed once', async () => {
    const session = await new MockTranslationProvider().connect({
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      mode: 'voice',
      lexicon: [],
    });
    const closed = jest.fn();
    const translation = jest.fn();
    session.on('closed', closed);
    session.on('translation', translation);
    session.sendAudio(Buffer.alloc(16000));
    session.endOfSpeech();
    session.close();
    session.close();
    await jest.advanceTimersByTimeAsync(500);
    expect(translation).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
