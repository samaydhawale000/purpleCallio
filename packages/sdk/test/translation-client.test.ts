import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TranslationClient, translationSocketUrl } from '../src/translation/translation-client';
import { EnergyVad } from '../src/translation/vad';
import { PhraseStore } from '../src/translation/phrases';
import { describeGuardReasons } from '../src/translation/reasons';
import { floatToPcm16 } from '../src/ai/pcm';
import {
  FakeAudioContext,
  FakeAudioWorkletNode,
  FakeSocket,
  READY,
  chunk,
  fakeSocketFactory,
  installAudioFakes,
  pcmBytes,
} from './translation-fakes';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function makeClient(extra: Record<string, unknown> = {}) {
  const remote = { volume: 1 } as HTMLMediaElement;
  const client = new TranslationClient({
    serverUrl: 'https://api.example.com/api',
    token: 'bj_session_x',
    remoteAudio: remote,
    socketFactory: fakeSocketFactory,
    ...extra,
  });
  return { client, remote };
}

async function enabled(extra: Record<string, unknown> = {}, ready: Record<string, unknown> = {}, opts = {}) {
  const fakes = installAudioFakes();
  const { client, remote } = makeClient(extra);
  const p = client.enable(opts);
  await flush();
  const socket = FakeSocket.instances[0];
  socket.server('ready', { ...READY, ...ready });
  const r = await p;
  const ctx = FakeAudioContext.instances[0];
  const worklet = FakeAudioWorkletNode.instances[0];
  const mic = (amp: number, n = 1) => {
    for (let i = 0; i < n; i++) worklet.port.onmessage!({ data: chunk(amp) });
  };
  return { client, remote, socket, ctx, worklet, mic, ready: r, ...fakes };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EnergyVad', () => {
  const loud = floatToPcm16(chunk(0.3));
  const quiet = floatToPcm16(chunk(0));

  it('starts after ~60 ms of speech with 200 ms of pre-roll and ends after 600 ms of silence', () => {
    const vad = new EnergyVad();
    for (let i = 0; i < 20; i++) expect(vad.process(quiet).type).toBe('idle');
    expect(vad.process(loud).type).toBe('idle');
    expect(vad.process(loud).type).toBe('idle');
    const start = vad.process(loud);
    expect(start.type).toBe('start');
    if (start.type === 'start') expect(start.frames).toHaveLength(10); // 200 ms / 20 ms
    for (let i = 0; i < 29; i++) expect(vad.process(quiet).type).toBe('frame');
    expect(vad.process(quiet).type).toBe('end');
    expect(vad.process(quiet).type).toBe('idle');
  });

  it('a short click is not speech', () => {
    const vad = new EnergyVad();
    expect(vad.process(loud).type).toBe('idle');
    expect(vad.process(quiet).type).toBe('idle');
    expect(vad.process(loud).type).toBe('idle');
    expect(vad.isSpeaking).toBe(false);
  });
});

describe('PhraseStore + guard reasons', () => {
  it('merges partial captions, keeps timing and never un-finalises', () => {
    const store = new PhraseStore();
    store.setRole('caller');
    store.applyCaption({ phraseId: 'caller-1', speaker: 'caller', sourceLanguage: 'en', targetLanguage: 'mr', original: 'Hel', translated: '', final: false, startedAt: 100 });
    store.applyCaption({ phraseId: 'caller-1', speaker: 'caller', sourceLanguage: 'en', targetLanguage: 'mr', original: 'Hello there', translated: 'नमस्कार', final: true, startedAt: 100, endedAt: 900, translatedAudioAt: 950 });
    const p = store.applyCaption({ phraseId: 'caller-1', speaker: 'caller', sourceLanguage: 'en', targetLanguage: 'mr', original: 'Hello there', translated: '', final: false, startedAt: 100 })!;
    expect(p).toMatchObject({ original: 'Hello there', translated: 'नमस्कार', final: true, endedAt: 900, translatedAudioAt: 950, mine: true });
    expect(store.list()).toHaveLength(1);
  });

  it('applies a flag that arrives before its caption', () => {
    const store = new PhraseStore();
    expect(store.applyFlag('receiver-2', ['term_mismatch:amount'])).toBeNull();
    const p = store.applyCaption({ phraseId: 'receiver-2', speaker: 'receiver', sourceLanguage: 'mr', targetLanguage: 'en', original: 'x', translated: 'y', final: true, startedAt: 1, guard: { status: 'ok', reasons: [] } })!;
    expect(p.flagged).toBe(true);
    expect(p.guard).toEqual({ status: 'uncertain', reasons: ['term_mismatch:amount'] });
  });

  it('humanises reasons without percentages', () => {
    const text = describeGuardReasons(['term_mismatch:amount', 'low_asr_confidence', 'recognition_failed', 'weird']);
    expect(text).toEqual(['An amount may have changed', 'The speech was hard to make out', 'The translation may not match what was said']);
    expect(text.join(' ')).not.toMatch(/%|\d/);
  });
});

describe('TranslationClient', () => {
  it('connects to /translate with the session token over websocket', async () => {
    const { socket, ready, client } = await enabled();
    expect(translationSocketUrl('https://h.example.com/api/')).toBe('https://h.example.com/translate');
    expect(socket.url).toBe('https://api.example.com/translate');
    expect(socket.options).toMatchObject({ auth: { token: 'bj_session_x' }, transports: ['websocket'] });
    expect(ready.role).toBe('caller');
    expect(client.getState()).toMatchObject({ status: 'ready', mode: 'voice', role: 'caller', you: { speak: 'en', hear: 'mr' } });
  });

  it('sends settings once when the requested languages differ from ready', async () => {
    const { socket } = await enabled({}, {}, { speak: 'hi', hear: 'ta' });
    expect(socket.events('settings').map((e) => e.args[0])).toEqual([{ speak: 'hi', hear: 'ta' }]);
    // Relay re-plans and confirms → no loop.
    socket.server('ready', { ...READY, you: { speak: 'hi', hear: 'ta' } });
    expect(socket.events('settings')).toHaveLength(1);
  });

  it('VAD gates audio: nothing while silent, speech.start + pre-roll, speech.end after 600 ms', async () => {
    const { socket, mic, client } = await enabled();
    const speaking = vi.fn();
    client.on('speaking', speaking);
    mic(0, 20);
    expect(socket.events('audio')).toHaveLength(0);
    expect(socket.events('speech.start')).toHaveLength(0);

    mic(0.3, 3);
    expect(socket.events('speech.start')).toHaveLength(1);
    // speech.start comes before the first frame; 10 frames of pre-roll.
    const names = socket.names();
    expect(names.indexOf('speech.start')).toBeLessThan(names.indexOf('audio'));
    expect(socket.events('audio')).toHaveLength(10);
    expect(socket.events('audio')[0].args[0]).toBeInstanceOf(ArrayBuffer);
    expect(socket.events('audio')[0].args[0].byteLength).toBe(640);
    expect(speaking).toHaveBeenLastCalledWith(true);

    mic(0.3, 5);
    expect(socket.events('audio')).toHaveLength(15);
    mic(0, 30); // 600 ms of silence (still sent as hangover)
    expect(socket.events('speech.end')).toHaveLength(1);
    expect(socket.events('audio')).toHaveLength(45);
    mic(0, 20);
    expect(socket.events('audio')).toHaveLength(45);
    expect(client.getState().speaking).toBe(false);
  });

  it('does not send audio when mode is off and closes an open phrase', async () => {
    const { socket, mic, client } = await enabled();
    mic(0.3, 4);
    expect(socket.events('speech.start')).toHaveLength(1);
    client.setMode('off');
    expect(socket.events('speech.end')).toHaveLength(1);
    expect(socket.events('settings').at(-1)!.args[0]).toEqual({ mode: 'off' });
    const before = socket.events('audio').length;
    mic(0.3, 10);
    expect(socket.events('audio')).toHaveLength(before);
  });

  it('merges captions into the phrase store and updates flagged phrases', async () => {
    const { socket, client } = await enabled();
    const captions = vi.fn();
    const flagged = vi.fn();
    client.on('caption', captions);
    client.on('flagged', flagged);
    const base = { phraseId: 'receiver-1', speaker: 'receiver', sourceLanguage: 'mr', targetLanguage: 'en', startedAt: 10 };
    socket.server('caption', { ...base, original: 'माझं', translated: '', final: false });
    socket.server('caption', { ...base, original: 'माझं नाव', translated: 'My name', final: true, endedAt: 20, translatedAudioAt: 25 });
    expect(client.phrases).toHaveLength(1);
    expect(client.phrases[0]).toMatchObject({ original: 'माझं नाव', translated: 'My name', final: true, translatedAudioAt: 25, mine: false, flagged: false });
    socket.server('flagged', { phraseId: 'receiver-1', reasons: ['term_mismatch:number'] });
    expect(flagged).toHaveBeenCalledTimes(1);
    expect(client.phrases[0]).toMatchObject({ flagged: true, guard: { status: 'uncertain', reasons: ['term_mismatch:number'] } });
    expect(captions).toHaveBeenCalledTimes(2);
  });

  it('plays translated audio per phrase and ducks the original, then restores it', async () => {
    const { socket, ctx, remote, client } = await enabled({ originalVolume: 0.3 });
    const playback = vi.fn();
    client.on('playback', playback);
    socket.server('caption', { phraseId: 'receiver-1', speaker: 'receiver', sourceLanguage: 'mr', targetLanguage: 'en', original: 'a', translated: 'b', final: true, startedAt: 1 });
    socket.server('audio', pcmBytes(), { phraseId: 'receiver-1' });
    socket.server('audio', pcmBytes(), { phraseId: 'receiver-1' });
    expect(ctx.sources).toHaveLength(2);
    expect((ctx.sources[0].buffer as any).sampleRate).toBe(24_000);
    expect(playback).toHaveBeenCalledWith({ phraseId: 'receiver-1', replay: false });
    expect(client.phrases[0].playing).toBe(true);
    expect(client.phrases[0].playedAt).toBeTypeOf('number');

    vi.advanceTimersByTime(200);
    expect(remote.volume).toBeCloseTo(0.3);

    // A second phrase waits for the first; local speech doesn't flush anything.
    socket.server('audio', pcmBytes(), { phraseId: 'receiver-2' });
    expect(ctx.sources).toHaveLength(2);
    ctx.sources[0].end();
    ctx.sources[1].end();
    expect(ctx.sources).toHaveLength(3);
    expect(client.getState().playingPhraseId).toBe('receiver-2');
    expect(client.phrases[0].playing).toBe(false);
    ctx.sources[2].end();

    vi.advanceTimersByTime(250 + 200);
    expect(playback).toHaveBeenLastCalledWith({ phraseId: null, replay: false });
    expect(remote.volume).toBeCloseTo(1);
    expect(ctx.sources.every((s) => s.stopped === 0)).toBe(true);
  });

  it('routes translated audio through a MediaStream destination when a document exists', async () => {
    const appended: any[] = [];
    vi.stubGlobal('document', {
      createElement: () => ({ style: {}, setAttribute() {}, play: () => Promise.resolve(), pause() {}, remove() {}, srcObject: null }),
      body: { appendChild: (el: any) => appended.push(el) },
    });
    const { socket, ctx, client } = await enabled();
    socket.server('audio', pcmBytes(), { phraseId: 'receiver-1' });
    expect(ctx.sources[0].connectedTo).toBe(ctx.mediaDestination);
    expect(appended).toHaveLength(1);
    expect(appended[0].srcObject).toBe(ctx.mediaDestination.stream);
    expect(client.outputElement).toBe(appended[0]);
  });

  it('replays original audio at 16 kHz with an optional slower rate', async () => {
    const { socket, ctx, client } = await enabled({}, { replayEnabled: true });
    expect(client.replay('receiver-1', { rate: 0.85 })).toBe(true);
    expect(socket.events('replay').at(-1)!.args[0]).toEqual({ phraseId: 'receiver-1' });
    socket.server('replay.audio', pcmBytes(320), { phraseId: 'receiver-1', sampleRate: 16_000, done: false });
    socket.server('replay.audio', pcmBytes(320), { phraseId: 'receiver-1', sampleRate: 16_000, done: true });
    expect(ctx.sources).toHaveLength(2);
    expect((ctx.sources[0].buffer as any).sampleRate).toBe(16_000);
    expect(ctx.sources[0].playbackRate.value).toBe(0.85);
    expect(client.getState().playingPhraseId).toBe('receiver-1');
  });

  it('refuses replay when the relay did not enable it', async () => {
    const { socket, client } = await enabled();
    expect(client.replay('receiver-1')).toBe(false);
    expect(socket.events('replay')).toHaveLength(0);
  });

  it('requests a repeat and surfaces repeat requests for the speaker', async () => {
    const { socket, client } = await enabled();
    socket.server('caption', { phraseId: 'receiver-1', speaker: 'receiver', sourceLanguage: 'mr', targetLanguage: 'en', original: 'a', translated: 'b', final: true, startedAt: 1 });
    expect(client.requestRepeat('receiver-1')).toBe(true);
    expect(socket.events('repeat.request')[0].args[0]).toEqual({ phraseId: 'receiver-1' });
    expect(client.phrases[0].repeatRequestedAt).toBeTypeOf('number');
    const asked = vi.fn();
    client.on('repeat.requested', asked);
    socket.server('repeat.requested', { phraseId: 'caller-3', original: 'hi', prompt: 'Could you repeat that?' });
    expect(asked).toHaveBeenCalledWith({ phraseId: 'caller-3', original: 'hi', prompt: 'Could you repeat that?' });
  });

  it('handles limit and mode events (step down to captions flushes voice)', async () => {
    const { socket, ctx, client, remote } = await enabled();
    const limit = vi.fn();
    const mode = vi.fn();
    client.on('limit', limit);
    client.on('mode', mode);
    socket.server('limit', { kind: 'warning', scope: 'call', message: '2 minutes left', remainingSeconds: 120 });
    expect(limit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning' }));
    expect(client.getState().limit?.remainingSeconds).toBe(120);

    socket.server('audio', pcmBytes(), { phraseId: 'receiver-1' });
    vi.advanceTimersByTime(200);
    socket.server('limit', { kind: 'stepped_down', scope: 'call', message: 'Switched to captions' });
    socket.server('mode', { mode: 'captions', reason: 'limit' });
    expect(mode).toHaveBeenCalledWith({ mode: 'captions', reason: 'limit' });
    expect(client.getState().mode).toBe('captions');
    expect(ctx.sources[0].stopped).toBe(1);
    vi.advanceTimersByTime(200);
    expect(remote.volume).toBeCloseTo(1);
    // Captions mode ignores translated audio.
    socket.server('audio', pcmBytes(), { phraseId: 'receiver-2' });
    expect(ctx.sources).toHaveLength(1);
    // Server-chosen mode is not fought on the next ready.
    socket.server('ready', { ...READY, mode: 'captions' });
    expect(socket.events('settings')).toHaveLength(0);
  });

  it('tracks the peer', async () => {
    const { socket, client } = await enabled();
    socket.server('peer', { connected: false });
    expect(client.getState().peer).toMatchObject({ connected: false, speak: 'mr', hear: 'en' });
  });

  it('rejects enable() with the relay error code', async () => {
    installAudioFakes();
    const { client } = makeClient();
    const p = client.enable();
    await flush();
    FakeSocket.instances[0].server('error', { code: 'TRANSLATION_NOT_IN_PLAN' });
    await expect(p).rejects.toMatchObject({ code: 'TRANSLATION_NOT_IN_PLAN' });
    expect(client.getState().status).toBe('ended');
  });

  it('cleans up on disable(): end, socket, mic, audio, ducking', async () => {
    const { socket, ctx, client, remote, stream, worklet } = await enabled();
    const ended = vi.fn();
    client.on('ended', ended);
    socket.server('audio', pcmBytes(), { phraseId: 'receiver-1' });
    vi.advanceTimersByTime(200);
    expect(remote.volume).toBeCloseTo(0.2);
    client.disable();
    expect(socket.events('end')).toHaveLength(1);
    expect(socket.disconnected).toBe(1);
    expect(stream.track.stopped).toBe(1);
    expect(ctx.closeCalls).toBe(1);
    expect(worklet.port.onmessage).toBeNull();
    expect(ctx.sources[0].stopped).toBe(1);
    expect(remote.volume).toBe(1);
    expect(ended).toHaveBeenCalledWith({ reason: 'participant' });
    client.disable();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('never stops a stream it was given', async () => {
    const own = { track: { stop: vi.fn() }, getTracks() { return [this.track]; }, getAudioTracks() { return [this.track]; } };
    const { client, getUserMedia } = await enabled({ stream: () => own });
    expect(getUserMedia).not.toHaveBeenCalled();
    client.disable();
    expect(own.track.stop).not.toHaveBeenCalled();
  });

  it('ends on server `ended`', async () => {
    const { socket, client } = await enabled();
    const ended = vi.fn();
    client.on('ended', ended);
    socket.server('ended', { reason: 'call_ended' });
    expect(ended).toHaveBeenCalledWith({ reason: 'call_ended' });
    expect(client.getState().status).toBe('ended');
  });
});

describe('meeting.translation', () => {
  it('is one TranslationClient per meeting, using the call token', async () => {
    const { PurpleCallioMeeting } = await import('../src/meeting/meeting');
    const meeting = new PurpleCallioMeeting({ token: 'bj_session_m', callId: 'c1', signalUrl: 'https://signal.example.com' } as any);
    expect(meeting.translation).toBeInstanceOf(TranslationClient);
    expect(meeting.translation).toBe(meeting.translation);
    expect(meeting.translation.getState().status).toBe('idle');
  });
});
