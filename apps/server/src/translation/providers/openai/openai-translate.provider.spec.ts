import { Logger } from '@nestjs/common';
import { AddressInfo } from 'net';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer, Server } from 'http';

import {
  OpenAiTranslateProvider,
  OPENAI_TRANSLATE_DEFAULT_MODEL,
} from './openai-translate.provider';
import { TranslationProviderSession } from '../translation-provider.interface';

const KEY = 'sk-test-secret-key-123';

interface FakeServer {
  url: string;
  wss: WebSocketServer;
  http: Server;
  /** Messages received from the client (parsed JSON). */
  received: any[];
  sockets: WebSocket[];
  requests: { url: string; auth?: string }[];
  close(): Promise<void>;
}

type OnConnect = (ws: WebSocket) => void;

async function startServer(
  onConnect: OnConnect,
  refuseStatus?: number,
): Promise<FakeServer> {
  const http = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  const received: any[] = [];
  const sockets: WebSocket[] = [];
  const requests: { url: string; auth?: string }[] = [];
  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    requests.push({ url: req.url ?? '', auth: req.headers.authorization });
    if (refuseStatus) {
      socket.write(
        `HTTP/1.1 ${refuseStatus} Unauthorized\r\nContent-Length: 0\r\n\r\n`,
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.push(ws);
      ws.on('message', (data) => received.push(JSON.parse(data.toString())));
      onConnect(ws);
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const port = (http.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${port}/v1/realtime/translations`,
    wss,
    http,
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

/** Accepts the session like the real service. */
const accept: OnConnect = (ws) => {
  ws.send(JSON.stringify({ type: 'session.created', session: {} }));
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'session.update')
      ws.send(JSON.stringify({ type: 'session.updated', session: {} }));
  });
};

const CONFIG = {
  sourceLanguage: 'en',
  targetLanguage: 'es-ES',
  mode: 'voice' as const,
  lexicon: [{ term: 'PurpleCallio', kind: 'DO_NOT_TRANSLATE' as const }],
};

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

describe('OpenAiTranslateProvider', () => {
  const saved = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_TRANSLATE_MODEL,
  };
  let server: FakeServer | null = null;
  let logs: string[];

  beforeEach(() => {
    process.env.OPENAI_API_KEY = KEY;
    delete process.env.OPENAI_TRANSLATE_MODEL;
    logs = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((msg: any) => {
        logs.push(String(msg));
      });
    }
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.close();
    server = null;
    // No log line may ever contain the key.
    expect(logs.join('\n')).not.toContain(KEY);
  });

  afterAll(() => {
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.key;
    if (saved.model === undefined) delete process.env.OPENAI_TRANSLATE_MODEL;
    else process.env.OPENAI_TRANSLATE_MODEL = saved.model;
  });

  function provider(extra: Record<string, number> = {}) {
    return new OpenAiTranslateProvider({
      baseUrl: server!.url,
      connectTimeoutMs: 500,
      phraseIdleMs: 60,
      maxPhraseWaitMs: 1000,
      trailingSilenceMs: 400,
      ...extra,
    });
  }

  describe('configuration and support', () => {
    it('reads OPENAI_API_KEY on every call', () => {
      const p = new OpenAiTranslateProvider();
      expect(p.name).toBe('openai-translate');
      expect(p.isConfigured()).toBe(true);
      delete process.env.OPENAI_API_KEY;
      expect(p.isConfigured()).toBe(false);
    });

    it('limits targets to the 13 output languages, any listed input', () => {
      const p = new OpenAiTranslateProvider();
      expect(p.supports('en', 'es', 'voice')).toBe(true);
      expect(p.supports('auto', 'hi-IN', 'voice')).toBe(true);
      expect(p.supports('ar', 'en', 'captions')).toBe(true);
      expect(p.supports('en', 'ar', 'captions')).toBe(false);
      expect(p.supports('en', 'mr', 'voice')).toBe(false);
      expect(p.supports('en', 'auto', 'voice')).toBe(false);
      expect(p.supports('xx', 'en', 'voice')).toBe(false);
    });
  });

  describe('connect', () => {
    it('authenticates with a header, uses the model, sends the session config', async () => {
      server = await startServer(accept);
      const session = await provider().connect(CONFIG);

      expect(server.requests[0].url).toBe(
        `/v1/realtime/translations?model=${OPENAI_TRANSLATE_DEFAULT_MODEL}`,
      );
      expect(server.requests[0].url).not.toContain(KEY);
      expect(server.requests[0].auth).toBe(`Bearer ${KEY}`);
      expect(server.received[0]).toEqual({
        type: 'session.update',
        session: {
          audio: {
            input: {
              transcription: { model: 'gpt-realtime-whisper' },
              noise_reduction: { type: 'near_field' },
            },
            output: { language: 'es' },
          },
        },
      });
      expect(session.inputSampleRate).toBe(16_000);
      expect(session.outputSampleRate).toBe(24_000);
      session.close();
    });

    it('uses OPENAI_TRANSLATE_MODEL', async () => {
      process.env.OPENAI_TRANSLATE_MODEL = 'gpt-realtime-translate-2026';
      server = await startServer(accept);
      const session = await provider().connect(CONFIG);
      expect(server.requests[0].url).toContain(
        'model=gpt-realtime-translate-2026',
      );
      session.close();
    });

    it('accepts a session that only sends session.created', async () => {
      server = await startServer((ws) =>
        ws.send(JSON.stringify({ type: 'session.created' })),
      );
      const session = await provider({ connectTimeoutMs: 2500 }).connect(
        CONFIG,
      );
      expect(session).toBeDefined();
      session.close();
    }, 5000);

    it('rejects TRANSLATION_PROVIDER_UNAVAILABLE without a key', async () => {
      delete process.env.OPENAI_API_KEY;
      await expect(
        new OpenAiTranslateProvider().connect(CONFIG),
      ).rejects.toMatchObject({
        code: 'TRANSLATION_PROVIDER_UNAVAILABLE',
      });
    });

    it('rejects TRANSLATION_PROVIDER_UNAVAILABLE when the upgrade is refused (401)', async () => {
      server = await startServer(accept, 401);
      await expect(provider().connect(CONFIG)).rejects.toMatchObject({
        code: 'TRANSLATION_PROVIDER_UNAVAILABLE',
      });
    });

    it('rejects TRANSLATION_CONNECTION_FAILED when nothing listens', async () => {
      const p = new OpenAiTranslateProvider({
        baseUrl: 'ws://127.0.0.1:1/x',
        connectTimeoutMs: 500,
      });
      await expect(p.connect(CONFIG)).rejects.toMatchObject({
        code: 'TRANSLATION_CONNECTION_FAILED',
      });
    });

    it('rejects on a provider error, never leaking its message', async () => {
      server = await startServer((ws) => {
        ws.on('message', () =>
          ws.send(
            JSON.stringify({
              type: 'error',
              error: {
                type: 'invalid_request_error',
                code: 'bad',
                message: `secret ${KEY}`,
              },
            }),
          ),
        );
      });
      const err = await provider()
        .connect(CONFIG)
        .catch((e) => e);
      expect(err.code).toBe('TRANSLATION_PROVIDER_UNAVAILABLE');
      expect(err.message).toBe('TRANSLATION_PROVIDER_UNAVAILABLE');
      expect(logs.join('\n')).not.toContain('secret');
    });

    it('rejects on setup timeout', async () => {
      server = await startServer(() => undefined);
      await expect(
        provider({ connectTimeoutMs: 100 }).connect(CONFIG),
      ).rejects.toMatchObject({
        code: 'TRANSLATION_PROVIDER_UNAVAILABLE',
      });
    });
  });

  describe('session', () => {
    it('resamples 16 kHz input to 24 kHz', async () => {
      server = await startServer(accept);
      const session = await provider().connect(CONFIG);
      session.sendAudio(Buffer.alloc(640)); // 20 ms @ 16 kHz
      await waitFor(() => server!.received.length >= 2);
      const append = server.received[1];
      expect(append.type).toBe('session.input_audio_buffer.append');
      expect(Buffer.from(append.audio, 'base64').length).toBe(960); // 20 ms @ 24 kHz
      session.close();
    });

    it('maps deltas to transcript/translation/audio and finishes the phrase after endOfSpeech', async () => {
      server = await startServer(accept);
      const session = await provider().connect(CONFIG);
      const events = collect(session);
      const ws = server.sockets[0];

      session.sendAudio(Buffer.alloc(3200));
      ws.send(
        JSON.stringify({
          type: 'session.input_transcript.delta',
          delta: 'Hello ',
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'session.input_transcript.delta',
          delta: 'there',
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'session.output_transcript.delta',
          delta: 'Hola',
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'session.output_audio.delta',
          delta: Buffer.alloc(4800).toString('base64'),
        }),
      );
      await waitFor(() => events.some(([n]) => n === 'audio'));
      session.endOfSpeech();

      // Trailing silence (400 ms in 200 ms chunks) is appended as the "commit".
      await waitFor(
        () =>
          server!.received.filter(
            (m) => m.type === 'session.input_audio_buffer.append',
          ).length >= 3,
      );
      ws.send(
        JSON.stringify({
          type: 'session.output_transcript.delta',
          delta: ' allí',
        }),
      );
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));

      const names = events.map(([n]) => n);
      expect(events).toContainEqual([
        'transcript',
        { text: 'Hello there', final: false },
      ]);
      expect(events).toContainEqual([
        'translation',
        { text: 'Hola', final: false },
      ]);
      expect(events).toContainEqual([
        'transcript',
        { text: 'Hello there', final: true },
      ]);
      expect(events).toContainEqual([
        'translation',
        { text: 'Hola allí', final: true },
      ]);
      const audio = events.find(([n]) => n === 'audio')![1] as Buffer;
      expect(audio.length).toBe(4800);
      const usage = events.find(([n]) => n === 'usage')![1];
      expect(usage.audioInSeconds).toBeCloseTo(0.1 + 0.4, 3);
      expect(usage.audioOutSeconds).toBeCloseTo(0.1, 3);
      expect(names.indexOf('phraseDone')).toBeGreaterThan(
        names.lastIndexOf('translation'),
      );
      expect(names.filter((n) => n === 'phraseDone')).toHaveLength(1);
      session.close();
    });

    it('endOfSpeech without audio does nothing', async () => {
      server = await startServer(accept);
      const session = await provider().connect(CONFIG);
      const events = collect(session);
      session.endOfSpeech();
      await new Promise((r) => setTimeout(r, 120));
      expect(events).toEqual([]);
      expect(server.received).toHaveLength(1);
      session.close();
    });

    it('captions mode emits no audio', async () => {
      server = await startServer(accept);
      const session = await provider().connect({ ...CONFIG, mode: 'captions' });
      const events = collect(session);
      const ws = server.sockets[0];
      session.sendAudio(Buffer.alloc(640));
      ws.send(
        JSON.stringify({
          type: 'session.output_audio.delta',
          delta: Buffer.alloc(480).toString('base64'),
        }),
      );
      ws.send(
        JSON.stringify({
          type: 'session.output_transcript.delta',
          delta: 'Hola',
        }),
      );
      await waitFor(() => events.some(([n]) => n === 'translation'));
      session.endOfSpeech();
      await waitFor(() => events.some(([n]) => n === 'phraseDone'));
      expect(events.some(([n]) => n === 'audio')).toBe(false);
      session.close();
    });

    it('a provider drop emits TRANSLATION_CONNECTION_FAILED then closed once', async () => {
      server = await startServer(accept);
      const session = await provider().connect(CONFIG);
      const events = collect(session);
      server.sockets[0].close(1011);
      await waitFor(() => events.some(([n]) => n === 'closed'));
      expect(events).toEqual([
        ['error', 'TRANSLATION_CONNECTION_FAILED'],
        ['closed', undefined],
      ]);
    });

    it('close() emits closed once and sends session.close', async () => {
      server = await startServer(accept);
      const session = await provider().connect(CONFIG);
      const events = collect(session);
      session.close();
      session.close();
      expect(events).toEqual([['closed', undefined]]);
      await waitFor(() =>
        server!.received.some((m) => m.type === 'session.close'),
      );
    });
  });
});
