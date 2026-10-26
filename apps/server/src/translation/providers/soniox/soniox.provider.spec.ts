import { EventEmitter } from 'events';

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  constructor(public url: string) {
    super();
    FakeSocket.instances.push(this);
  }
  send(data: unknown) { this.sent.push(data); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.emit('open'); }
  push(message: unknown) { this.emit('message', Buffer.from(JSON.stringify(message))); }
  json() { return this.sent.filter((d) => typeof d === 'string' && d).map((d) => JSON.parse(d as string)); }
}

jest.mock('ws', () => ({ __esModule: true, default: FakeSocket }));

import { SonioxProvider } from './soniox.provider';
import { TranslationProviderSession } from '../translation-provider.interface';

const o = (text: string, is_final = false) => ({ text, is_final, translation_status: 'original' });
const t = (text: string, is_final = false) => ({ text, is_final, translation_status: 'translation' });

async function connect(mode: 'voice' | 'captions' = 'captions') {
  const pending = new SonioxProvider().connect({ sourceLanguage: 'hi', targetLanguage: 'en', mode, lexicon: [] });
  const stt = FakeSocket.instances[FakeSocket.instances.length - 1];
  stt.open();
  const session = await pending;
  const events: [string, unknown][] = [];
  for (const name of ['transcript', 'translation', 'phraseDone', 'audio', 'error'] as const)
    (session as TranslationProviderSession).on(name, (ev?: unknown) => events.push([name, ev]));
  return { session, stt, events };
}

describe('SonioxProvider', () => {
  beforeEach(() => {
    process.env.SONIOX_API_KEY = 'test';
    FakeSocket.instances = [];
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('starts a one-way translation stream', async () => {
    const { stt } = await connect();
    expect(stt.json()[0]).toMatchObject({ translation: { type: 'one_way', target_language: 'en' }, language_hints: ['hi', 'en'] });
  });

  it('replaces non-final tokens instead of appending them', async () => {
    const { stt, events } = await connect();
    stt.push({ tokens: [o('nam')] });
    stt.push({ tokens: [o('namaste')] });
    stt.push({ tokens: [o('namaste', true), o(' ji')] });
    const texts = events.filter(([n]) => n === 'transcript').map(([, e]) => (e as { text: string }).text);
    expect(texts).toEqual(['nam', 'namaste', 'namaste ji']);
  });

  it('completes the phrase at the endpoint marker', async () => {
    const { stt, events } = await connect();
    stt.push({ tokens: [o('namaste', true), t('hel')] });
    stt.push({ tokens: [t('hello', true), { text: '<end>', is_final: true }] });
    expect(events).toContainEqual(['translation', { text: 'hello', final: true }]);
    expect(events[events.length - 1][0]).toBe('phraseDone');
    stt.push({ tokens: [o('dhanyavaad', true)] });
    expect(events[events.length - 1]).toEqual(['transcript', expect.objectContaining({ text: 'dhanyavaad' })]);
  });

  it('waits for a translation that trails the marker, then settles', async () => {
    const { stt, events } = await connect();
    stt.push({ tokens: [o('namaste', true), { text: '<end>', is_final: true }] });
    expect(events.some(([n]) => n === 'phraseDone')).toBe(false);
    stt.push({ tokens: [t('hello', true)] });
    expect(events).toContainEqual(['translation', { text: 'hello', final: true }]);
    expect(events.filter(([n]) => n === 'phraseDone')).toHaveLength(1);
  });

  it('sends keepalives while idle and finalize at end of speech', async () => {
    const { session, stt } = await connect();
    jest.advanceTimersByTime(20_000);
    expect(stt.json().filter((m) => m.type === 'keepalive').length).toBeGreaterThan(0);
    session.endOfSpeech();
    expect(stt.json().some((m) => m.type === 'finalize')).toBe(false);
    session.sendAudio(Buffer.alloc(640));
    session.endOfSpeech();
    session.endOfSpeech();
    expect(stt.json().filter((m) => m.type === 'finalize')).toHaveLength(1);
  });

  it('voices each finished phrase in one TTS stream and ends the phrase when it terminates', async () => {
    const { stt, events } = await connect('voice');
    stt.push({ tokens: [o('namaste', true), t('hel')] });
    expect(FakeSocket.instances).toHaveLength(1); // no TTS until the phrase is final
    stt.push({ tokens: [t('hello', true), { text: '<end>', is_final: true }] });
    const tts = FakeSocket.instances[1];
    tts.open();
    const sent = tts.json();
    const streamId = sent[0].stream_id;
    expect(sent[0]).toMatchObject({ model: 'tts-rt-v2', voice: 'Adrian', audio_format: 'pcm_s16le', language: 'en' });
    expect(sent.slice(1)).toEqual([{ stream_id: streamId, text: 'hello', text_end: true }]);
    expect(events.some(([n]) => n === 'phraseDone')).toBe(false);
    tts.push({ stream_id: streamId, audio: Buffer.alloc(480).toString('base64') });
    tts.push({ stream_id: streamId, terminated: true });
    expect(events.map(([n]) => n)).toEqual(expect.arrayContaining(['audio', 'phraseDone']));
  });

  it('a TTS error drops only that phrase audio; captions and the next phrase carry on', async () => {
    const { stt, events } = await connect('voice');
    stt.push({ tokens: [o('ek', true), t('one', true), { text: '<end>', is_final: true }] });
    const tts = FakeSocket.instances[1];
    tts.open();
    tts.push({ stream_id: tts.json()[0].stream_id, error_type: 'request_timeout' });
    expect(events.some(([n]) => n === 'error')).toBe(false);
    expect(events.filter(([n]) => n === 'phraseDone')).toHaveLength(1);
    stt.push({ tokens: [o('do', true), t('two', true), { text: '<end>', is_final: true }] });
    expect(tts.json().filter((m) => m.text === 'two')).toHaveLength(1);
  });

  it('reopens TTS after Soniox closes an idle connection', async () => {
    const { stt, events } = await connect('voice');
    stt.push({ tokens: [o('ek', true), t('one', true), { text: '<end>', is_final: true }] });
    const first = FakeSocket.instances[1];
    first.open();
    first.push({ stream_id: first.json()[0].stream_id, terminated: true });
    first.emit('close');
    stt.push({ tokens: [o('do', true), t('two', true), { text: '<end>', is_final: true }] });
    const second = FakeSocket.instances[2];
    expect(second).toBeDefined();
    second.open();
    expect(second.json().some((m) => m.text === 'two')).toBe(true);
    expect(events.some(([n]) => n === 'error')).toBe(false);
  });

  it('releases a phrase whose TTS stream never terminates', async () => {
    const { stt, events } = await connect('voice');
    stt.push({ tokens: [o('ek', true), t('one', true), { text: '<end>', is_final: true }] });
    FakeSocket.instances[1].open();
    jest.advanceTimersByTime(20_000);
    expect(events.filter(([n]) => n === 'phraseDone')).toHaveLength(1);
  });
});
