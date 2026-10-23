import { Logger } from '@nestjs/common';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import WebSocket, { WebSocketServer } from 'ws';

import { pcm16ToWav } from '../../audio/pcm';
import { TranslationProviderSession } from '../translation-provider.interface';
import {
  applyPronunciations,
  SarvamProvider,
  splitText,
} from './sarvam.provider';

const KEY = 'sarvam-secret-key-xyz';

interface FakeStt {
  url: string;
  received: any[];
  sockets: WebSocket[];
  requests: { url: string; key?: string }[];
  close(): Promise<void>;
}

async function startStt(
  onMessage?: (ws: WebSocket, msg: any) => void,
  refuse?: number,
): Promise<FakeStt> {
  const http: Server = createServer((_q, r) => r.end());
  const wss = new WebSocketServer({ noServer: true });
  const received: any[] = [];
  const sockets: WebSocket[] = [];
  const requests: { url: string; key?: string }[] = [];
  http.on('upgrade', (req, socket, head) => {
    requests.push({
      url: req.url ?? '',
      key: req.headers['api-subscription-key'] as string,
    });
    if (refuse) {
      socket.write(`HTTP/1.1 ${refuse} Forbidden\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.push(ws);
      ws.on('message', (d) => {
        const msg = JSON.parse(d.toString());
        received.push(msg);
        onMessage?.(ws, msg);
      });
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const port = (http.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${port}`,
    received,
    sockets,
    requests,
    close: async () => {
      for (const s of sockets) s.terminate();
      wss.close();
      http.closeAllConnections?.();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

function wavBase64(samples: number, rate: number): string {
  return pcm16ToWav(Buffer.alloc(samples * 2, 1), rate).toString('base64');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Route = (body: any, init: RequestInit) => Response | Promise<Response>;

function mockFetch(routes: Record<string, Route>) {
  const calls: { path: string; body: any; headers: Record<string, string> }[] =
    [];
  const fn = jest.fn(async (url: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    const body =
      typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ path, body, headers: init.headers as Record<string, string> });
    const route = routes[path];
    if (!route) return json({ error: { message: 'nope' } }, 404);
    return route(body, init);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const defaultRoutes = (): Record<string, Route> => ({
  '/speech-to-text': () =>
    json({
      transcript: 'नमस्ते दुनिया',
      language_code: 'hi-IN',
      language_probability: 0.9,
    }),
  '/translate': (b) =>
    json({
      translated_text: `EN(${b.input})`,
      source_language_code: b.source_language_code,
    }),
  '/text-to-speech': () =>
    json({ request_id: 'r', audios: [wavBase64(2400 * 3, 24_000)] }), // 300 ms
});

const CONFIG = {
  sourceLanguage: 'hi',
  targetLanguage: 'en',
  mode: 'voice' as const,
  lexicon: [
    { term: 'PurpleCallio', kind: 'DO_NOT_TRANSLATE' as const },
    { term: 'EN', kind: 'PRONOUNCE_AS' as const, pronunciation: 'ee-en' },
  ],
};

function collect(session: TranslationProviderSession) {
  const events: Array<[string, any]> = [];
  for (const name of [
    'transcript',
    'translation',
    'audio',
    'phraseDone',
    'usage',
    'error',
    'closed',
  ] as const) {
    session.on(name as any, (arg?: unknown) => events.push([name, arg]));
  }
  return events;
}

function waitFor(cond: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('SarvamProvider', () => {
  const savedKey = process.env.SARVAM_API_KEY;
  let logs: string[];
  let stt: FakeStt | null = null;

  beforeEach(() => {
    process.env.SARVAM_API_KEY = KEY;
    logs = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((m: any) => {
        logs.push(String(m));
      });
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await stt?.close();
    stt = null;
    expect(logs.join('\n')).not.toContain(KEY);
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY = savedKey;
  });

  describe('configuration and support', () => {
    it('reads SARVAM_API_KEY on every call', () => {
      const p = new SarvamProvider();
      expect(p.name).toBe('sarvam');
      expect(p.isConfigured()).toBe(true);
      delete process.env.SARVAM_API_KEY;
      expect(p.isConfigured()).toBe(false);
    });

    it('supports Indian↔Indian and Indian↔English, voice only where Bulbul speaks', () => {
      const p = new SarvamProvider();
      expect(p.supports('hi', 'mr', 'voice')).toBe(true);
      expect(p.supports('mr-IN', 'en', 'voice')).toBe(true);
      expect(p.supports('en', 'ta', 'voice')).toBe(true);
      expect(p.supports('auto', 'or', 'voice')).toBe(true);
      expect(p.supports('hi', 'ur', 'captions')).toBe(true);
      expect(p.supports('hi', 'ur', 'voice')).toBe(false);
      expect(p.supports('en', 'es', 'captions')).toBe(false);
      expect(p.supports('es', 'hi', 'captions')).toBe(false);
      expect(p.supports('en', 'en', 'captions')).toBe(false);
    });

    it('rejects TRANSLATION_PROVIDER_UNAVAILABLE without a key', async () => {
      delete process.env.SARVAM_API_KEY;
      await expect(new SarvamProvider().connect(CONFIG)).rejects.toMatchObject({
        code: 'TRANSLATION_PROVIDER_UNAVAILABLE',
      });
    });
  });

  describe('REST cascade (no streaming)', () => {
    function provider(routes = defaultRoutes()) {
      const f = mockFetch(routes);
      const p = new SarvamProvider({
        baseUrl: 'https://sarvam.test',
        streamingStt: false,
        fetch: f.fn,
      });
      return { p, f };
    }

    it('transcribes, translates and speaks a phrase at 24 kHz in 100 ms chunks', async () => {
      const { p, f } = provider();
      const session = await p.connect(CONFIG);
      const events = collect(session);
      session.sendAudio(Buffer.alloc(3200)); // 100 ms @ 16 kHz
      session.sendAudio(Buffer.alloc(3200));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));

      expect(events.filter(([n]) => n !== 'audio')).toEqual([
        ['transcript', { text: 'नमस्ते दुनिया', final: true, language: 'hi' }],
        ['translation', { text: 'EN(नमस्ते दुनिया)', final: true }],
        [
          'usage',
          {
            audioInSeconds: 0.2,
            audioOutSeconds: 0.3,
            characters: 'नमस्ते दुनिया'.length + 'ee-en(नमस्ते दुनिया)'.length,
          },
        ],
        ['phraseDone', undefined],
      ]);
      const audio = events
        .filter(([n]) => n === 'audio')
        .map(([, b]) => b as Buffer);
      expect(audio).toHaveLength(3);
      expect(audio.every((b) => b.length === 4800)).toBe(true);

      const [sttCall, trCall, ttsCall] = f.calls;
      expect(sttCall.path).toBe('/speech-to-text');
      expect(sttCall.headers['api-subscription-key']).toBe(KEY);
      const form = sttCall.body as FormData;
      expect(form.get('model')).toBe('saaras:v4');
      expect(form.get('language_code')).toBe('hi-IN');
      expect(JSON.parse(form.get('keyterms') as string)).toEqual([
        'PurpleCallio',
        'EN',
      ]);
      expect((form.get('file') as Blob).size).toBe(44 + 6400);
      expect(trCall.body).toEqual({
        input: 'नमस्ते दुनिया',
        source_language_code: 'hi-IN',
        target_language_code: 'en-IN',
        model: 'sarvam-translate:v1',
        numerals_format: 'international',
      });
      expect(ttsCall.body).toMatchObject({
        text: 'ee-en(नमस्ते दुनिया)',
        language_code: 'en-IN',
        speaker: 'shubh',
        model: 'bulbul:v3',
        speech_sample_rate: 24_000,
        output_audio_codec: 'wav',
      });
      session.close();
    });

    it('resamples TTS output that is not 24 kHz', async () => {
      const routes = defaultRoutes();
      routes['/text-to-speech'] = () =>
        json({ audios: [wavBase64(2205, 22_050)] }); // 100 ms
      const { p } = provider(routes);
      const session = await p.connect(CONFIG);
      const events = collect(session);
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      const bytes = events
        .filter(([n]) => n === 'audio')
        .reduce((s, [, b]) => s + b.length, 0);
      expect(bytes).toBe(4800);
      session.close();
    });

    it('captions mode never calls TTS or emits audio', async () => {
      const { p, f } = provider();
      const session = await p.connect({ ...CONFIG, mode: 'captions' });
      const events = collect(session);
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      expect(events.some(([n]) => n === 'audio')).toBe(false);
      expect(f.calls.map((c) => c.path)).toEqual([
        '/speech-to-text',
        '/translate',
      ]);
      session.close();
    });

    it('auto source: uses the detected language; same language skips translate', async () => {
      const routes = defaultRoutes();
      routes['/speech-to-text'] = () =>
        json({ transcript: 'hello', language_code: 'en-IN' });
      const { p, f } = provider(routes);
      const session = await p.connect({
        ...CONFIG,
        sourceLanguage: 'auto',
        mode: 'captions',
      });
      const events = collect(session);
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      expect((f.calls[0].body as FormData).get('language_code')).toBe(
        'unknown',
      );
      expect(events[0]).toEqual([
        'transcript',
        { text: 'hello', final: true, language: 'en' },
      ]);
      expect(events[1]).toEqual([
        'translation',
        { text: 'hello', final: true },
      ]);
      expect(f.calls.map((c) => c.path)).toEqual(['/speech-to-text']);
      session.close();
    });

    it('keeps overlapping phrases in order even when the first is slower', async () => {
      let n = 0;
      const routes = defaultRoutes();
      routes['/speech-to-text'] = async () => {
        const i = ++n;
        if (i === 1) await new Promise((r) => setTimeout(r, 80));
        return json({ transcript: `phrase ${i}`, language_code: 'hi-IN' });
      };
      const { p } = provider(routes);
      const session = await p.connect(CONFIG);
      const events = collect(session);
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      await waitFor(
        () => events.filter(([n]) => n === 'phraseDone').length === 2,
      );
      const order = events
        .filter(
          ([n]) =>
            n === 'transcript' || n === 'translation' || n === 'phraseDone',
        )
        .map(([n, e]) => (n === 'phraseDone' ? 'done' : `${n}:${e.text}`));
      expect(order).toEqual([
        'transcript:phrase 1',
        'translation:EN(phrase 1)',
        'done',
        'transcript:phrase 2',
        'translation:EN(phrase 2)',
        'done',
      ]);
      session.close();
    });

    it('an HTTP failure emits a stable code (no provider text) and still finishes the phrase', async () => {
      const routes = defaultRoutes();
      routes['/translate'] = () =>
        json({ error: { message: `bad key ${KEY}` } }, 403);
      const { p } = provider(routes);
      const session = await p.connect(CONFIG);
      const events = collect(session);
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      expect(events.map(([n]) => n)).toEqual([
        'transcript',
        'error',
        'usage',
        'phraseDone',
      ]);
      expect(events[1][1]).toBe('TRANSLATION_PROVIDER_UNAVAILABLE');
      expect(logs.join('\n')).toContain('status=403');
      session.close();
    });

    it('a network failure maps to TRANSLATION_CONNECTION_FAILED', async () => {
      const routes = defaultRoutes();
      routes['/speech-to-text'] = () => {
        throw new TypeError(`fetch failed ${KEY}`);
      };
      const { p } = provider(routes);
      const session = await p.connect(CONFIG);
      const events = collect(session);
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      expect(events[0]).toEqual(['error', 'TRANSLATION_CONNECTION_FAILED']);
      session.close();
    });

    it('close emits closed once and drops pending output', async () => {
      const routes = defaultRoutes();
      routes['/speech-to-text'] = async () => {
        await new Promise((r) => setTimeout(r, 50));
        return json({ transcript: 'x', language_code: 'hi-IN' });
      };
      const { p } = provider(routes);
      const session = await p.connect(CONFIG);
      const events = collect(session);
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      session.close();
      session.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(events).toEqual([['closed', undefined]]);
    });
  });

  describe('streaming STT', () => {
    function provider(
      routes = defaultRoutes(),
      extra: Record<string, unknown> = {},
    ) {
      const f = mockFetch(routes);
      const p = new SarvamProvider({
        baseUrl: 'https://sarvam.test',
        wsBaseUrl: stt!.url,
        fetch: f.fn,
        flushTimeoutMs: 300,
        flushSettleMs: 30,
        connectTimeoutMs: 1000,
        ...extra,
      });
      return { p, f };
    }

    it('connects with the key header and query config, streams audio, emits partials and the flushed final', async () => {
      stt = await startStt((ws, msg) => {
        if (msg.audio && stt!.received.filter((m) => m.audio).length === 1) {
          ws.send(
            JSON.stringify({
              type: 'data',
              data: {
                transcript: 'नमस्ते',
                language_code: 'hi-IN',
                metrics: {},
              },
            }),
          );
        }
        if (msg.type === 'flush') {
          ws.send(
            JSON.stringify({
              type: 'data',
              data: {
                transcript: 'दुनिया',
                language_code: 'hi-IN',
                metrics: {},
              },
            }),
          );
        }
      });
      const { p, f } = provider();
      const session = await p.connect({ ...CONFIG, mode: 'captions' });
      const events = collect(session);

      const q = new URL(stt.requests[0].url, 'ws://x').searchParams;
      expect(stt.requests[0].key).toBe(KEY);
      expect(stt.requests[0].url).not.toContain(KEY);
      expect(q.get('model')).toBe('saaras:v4');
      expect(q.get('language-code')).toBe('hi-IN');
      expect(q.get('sample_rate')).toBe('16000');
      expect(q.get('input_audio_codec')).toBe('pcm_s16le');
      expect(q.get('flush_signal')).toBe('true');

      session.sendAudio(Buffer.alloc(640));
      await waitFor(() => events.some(([n]) => n === 'transcript'));
      expect(events[0]).toEqual([
        'transcript',
        { text: 'नमस्ते', final: false, language: 'hi' },
      ]);
      expect(stt.received[0].audio).toEqual({
        data: Buffer.alloc(640).toString('base64'),
        sample_rate: '16000',
        encoding: 'audio/wav',
      });

      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      expect(stt.received.at(-1)).toEqual({ type: 'flush' });
      expect(events).toContainEqual([
        'transcript',
        { text: 'नमस्ते दुनिया', final: true, language: 'hi' },
      ]);
      expect(events).toContainEqual([
        'translation',
        { text: 'EN(नमस्ते दुनिया)', final: true },
      ]);
      expect(f.calls.map((c) => c.path)).toEqual(['/translate']);
      session.close();
    });

    it('falls back to REST STT when the flush is never answered', async () => {
      stt = await startStt();
      const { p, f } = provider();
      const session = await p.connect({ ...CONFIG, mode: 'captions' });
      const events = collect(session);
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      expect(f.calls.map((c) => c.path)).toEqual([
        '/speech-to-text',
        '/translate',
      ]);
      session.close();
    });

    it('rejects TRANSLATION_PROVIDER_UNAVAILABLE when the stream refuses the key', async () => {
      stt = await startStt(undefined, 403);
      const { p } = provider();
      await expect(p.connect(CONFIG)).rejects.toMatchObject({
        code: 'TRANSLATION_PROVIDER_UNAVAILABLE',
      });
    });

    it('rejects TRANSLATION_CONNECTION_FAILED when the stream is unreachable', async () => {
      const f = mockFetch(defaultRoutes());
      const p = new SarvamProvider({
        baseUrl: 'https://sarvam.test',
        wsBaseUrl: 'ws://127.0.0.1:1',
        fetch: f.fn,
      });
      await expect(p.connect(CONFIG)).rejects.toMatchObject({
        code: 'TRANSLATION_CONNECTION_FAILED',
      });
    });

    it('a dropped stream switches later phrases to REST without an error', async () => {
      stt = await startStt();
      const { p, f } = provider();
      const session = await p.connect({ ...CONFIG, mode: 'captions' });
      const events = collect(session);
      stt.sockets[0].close(1011);
      await new Promise((r) => setTimeout(r, 50));
      session.sendAudio(Buffer.alloc(640));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      expect(events.some(([n]) => n === 'error')).toBe(false);
      expect(f.calls[0].path).toBe('/speech-to-text');
      session.close();
    });
  });

  describe('helpers', () => {
    it('applyPronunciations rewrites PRONOUNCE_AS terms only', () => {
      expect(
        applyPronunciations('Call PurpleCallio now', [
          {
            term: 'purplecallio',
            kind: 'PRONOUNCE_AS',
            pronunciation: 'purple calli-o',
          },
          { term: 'now', kind: 'DO_NOT_TRANSLATE' },
        ]),
      ).toBe('Call purple calli-o now');
    });

    it('splitText keeps parts under the limit', () => {
      const text = 'One two three. Four five six. '.repeat(20);
      const parts = splitText(text, 50);
      expect(parts.every((x) => x.length <= 50)).toBe(true);
      expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(
        text.trim().replace(/\s+/g, ' '),
      );
      expect(splitText('short', 50)).toEqual(['short']);
    });
  });
});
