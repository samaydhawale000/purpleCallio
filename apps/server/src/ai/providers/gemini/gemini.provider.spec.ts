import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';

import { AiProviderError } from '../ai-provider.interface';
import {
  GeminiProvider,
  GeminiSession,
  GEMINI_LIVE_URL,
} from './gemini.provider';

/** Stands in for a `ws` WebSocket: records sends, lets the spec push frames. */
class FakeWebSocket extends EventEmitter {
  readyState = 0;
  sent: any[] = [];
  closeCalls = 0;

  constructor(public url: string) {
    super();
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closeCalls++;
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', 1000);
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  /** Gemini sends JSON; often as binary frames, so use a Buffer. */
  push(message: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }

  /** The provider closing on us. */
  drop(code = 1011) {
    this.readyState = 3;
    this.emit('close', code);
  }
}

const CONFIG = {
  systemPrompt: 'You are a test agent.',
  voice: 'Puck',
  language: 'en',
  tools: [
    {
      name: 'lookup_order',
      description: 'Find an order',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
    },
  ],
  model: null,
};

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let socket: FakeWebSocket;
  const savedKey = process.env.GEMINI_API_KEY;
  const savedModel = process.env.AI_GEMINI_MODEL;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.AI_GEMINI_MODEL;
    provider = new GeminiProvider();
    provider.socketFactory = (url) => {
      socket = new FakeWebSocket(url);
      return socket;
    };
  });

  afterAll(() => {
    process.env.GEMINI_API_KEY = savedKey;
    if (savedModel === undefined) delete process.env.AI_GEMINI_MODEL;
    else process.env.AI_GEMINI_MODEL = savedModel;
  });

  async function connect(): Promise<GeminiSession> {
    const pending = provider.connect(CONFIG);
    socket.open();
    socket.push({ setupComplete: {} });
    return pending;
  }

  function collect(session: GeminiSession) {
    const events: Array<[string, unknown]> = [];
    for (const name of [
      'audio',
      'transcript',
      'userSpeechStarted',
      'toolCall',
      'toolCallCancelled',
      'usage',
      'turnComplete',
      'error',
      'closed',
    ] as const) {
      session.on(name as any, (arg?: unknown) => events.push([name, arg]));
    }
    return events;
  }

  describe('connect', () => {
    it('sends the setup message and resolves on setupComplete', async () => {
      const session = await connect();

      expect(socket.url).toBe(`${GEMINI_LIVE_URL}?key=test-key`);
      expect(socket.sent[0]).toEqual({
        setup: {
          model: 'models/gemini-3.8-live',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
            },
          },
          systemInstruction: { parts: [{ text: 'You are a test agent.' }] },
          tools: [{ functionDeclarations: CONFIG.tools }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
      expect(session.inputSampleRate).toBe(16_000);
      expect(session.outputSampleRate).toBe(24_000);
    });

    it('uses AI_GEMINI_MODEL when the agent has no model', async () => {
      process.env.AI_GEMINI_MODEL = 'gemini-3.8-live-extended-thinking';
      await connect();
      expect(socket.sent[0].setup.model).toBe(
        'models/gemini-3.8-live-extended-thinking',
      );
    });

    it('rejects with AI_PROVIDER_UNAVAILABLE without a key', async () => {
      delete process.env.GEMINI_API_KEY;
      await expect(provider.connect(CONFIG)).rejects.toEqual(
        new AiProviderError('AI_PROVIDER_UNAVAILABLE'),
      );
    });

    it('maps a setup rejection to a code, not the provider text', async () => {
      const pending = provider.connect(CONFIG);
      socket.open();
      socket.emit('error', new Error('API key not valid: secret details'));
      const error = await pending.catch((e) => e);
      expect(error).toBeInstanceOf(AiProviderError);
      expect(error.code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(error.message).toBe('AI_PROVIDER_UNAVAILABLE');
    });

    it('rejects when the socket closes before setupComplete', async () => {
      const pending = provider.connect(CONFIG);
      socket.open();
      socket.drop(1008);
      await expect(pending).rejects.toMatchObject({
        code: 'AI_PROVIDER_UNAVAILABLE',
      });
    });
  });

  describe('outbound', () => {
    it('sends mic audio as base64 PCM at 16 kHz', async () => {
      const session = await connect();
      session.sendAudio(Buffer.from([1, 2, 3, 4]));
      expect(socket.sent[1]).toEqual({
        realtimeInput: {
          audio: { data: 'AQIDBA==', mimeType: 'audio/pcm;rate=16000' },
        },
      });
    });

    it('answers a tool call with its id and name', async () => {
      const session = await connect();
      socket.push({
        toolCall: {
          functionCalls: [
            { id: 'fc_1', name: 'lookup_order', args: { id: '42' } },
          ],
        },
      });
      session.sendToolResult('fc_1', { error: 'tools not available yet' });
      session.sendToolResult('fc_1', { error: 'twice' });

      expect(socket.sent.slice(1)).toEqual([
        {
          toolResponse: {
            functionResponses: [
              {
                id: 'fc_1',
                name: 'lookup_order',
                response: { error: 'tools not available yet' },
              },
            ],
          },
        },
      ]);
    });

    it('sends the greeting as realtime text', async () => {
      const session = await connect();
      session.greet('Hi, I am Ava.');
      expect(socket.sent[1].realtimeInput.text).toContain('Hi, I am Ava.');
    });
  });

  describe('inbound mapping', () => {
    it('maps audio, transcripts, usage and turnComplete', async () => {
      const session = await connect();
      const events = collect(session);

      socket.push({
        serverContent: { inputTranscription: { text: 'Where is ' } },
      });
      socket.push({
        serverContent: { inputTranscription: { text: 'my order?' } },
      });
      socket.push({
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/pcm;rate=24000',
                  data: Buffer.from([9, 8]).toString('base64'),
                },
              },
            ],
          },
          outputTranscription: { text: 'Let me check.' },
        },
        usageMetadata: { promptTokenCount: 10, responseTokenCount: 3 },
      });
      // Repeated within the turn: only the latest counts.
      socket.push({
        usageMetadata: { promptTokenCount: 12, responseTokenCount: 7 },
      });
      socket.push({ serverContent: { turnComplete: true } });

      expect(events).toEqual([
        ['transcript', { role: 'user', text: 'Where is ', final: false }],
        [
          'transcript',
          { role: 'user', text: 'Where is my order?', final: false },
        ],
        [
          'transcript',
          { role: 'user', text: 'Where is my order?', final: true },
        ],
        ['transcript', { role: 'agent', text: 'Let me check.', final: false }],
        ['audio', Buffer.from([9, 8])],
        ['transcript', { role: 'agent', text: 'Let me check.', final: true }],
        ['usage', { inputTokens: 12, outputTokens: 7 }],
        ['turnComplete', undefined],
      ]);
    });

    it('maps interrupted to userSpeechStarted (barge-in)', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({
        serverContent: { outputTranscription: { text: 'Your order is' } },
      });
      socket.push({ serverContent: { interrupted: true } });

      expect(events).toEqual([
        ['transcript', { role: 'agent', text: 'Your order is', final: false }],
        ['transcript', { role: 'agent', text: 'Your order is', final: true }],
        ['userSpeechStarted', undefined],
      ]);
    });

    it('drops the rest of a turn after cancelResponse', async () => {
      const session = await connect();
      const events = collect(session);
      const audio = {
        serverContent: {
          modelTurn: {
            parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAA=' } }],
          },
        },
      };
      session.cancelResponse();
      socket.push(audio);
      socket.push({ serverContent: { turnComplete: true } });
      socket.push(audio);

      expect(events.filter(([name]) => name === 'audio')).toHaveLength(1);
    });

    it('maps tool calls', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({
        toolCall: { functionCalls: [{ id: 'fc_2', name: 'lookup_order' }] },
      });
      expect(events).toEqual([
        ['toolCall', { id: 'fc_2', name: 'lookup_order', args: {} }],
      ]);
    });

    it('maps tool call cancellations', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({ toolCallCancellation: { ids: ['fc_2'] } });
      expect(events).toEqual([['toolCallCancelled', ['fc_2']]]);
    });

    it('ignores malformed frames', async () => {
      const session = await connect();
      const events = collect(session);
      socket.emit('message', Buffer.from('not json'));
      expect(events).toEqual([]);
    });
  });

  describe('errors and close', () => {
    it('maps an unexpected close to AI_CONNECTION_FAILED, then closed', async () => {
      const session = await connect();
      const events = collect(session);
      socket.drop(1011);
      expect(events).toEqual([
        ['error', 'AI_CONNECTION_FAILED'],
        ['closed', undefined],
      ]);
    });

    it('close() emits closed once and no error', async () => {
      const session = await connect();
      const events = collect(session);
      session.close();
      session.close();
      expect(events).toEqual([['closed', undefined]]);
      expect(socket.closeCalls).toBe(1);
    });

    it('does not throw on an unexpected close with no error listener', async () => {
      await connect();
      expect(() => socket.drop()).not.toThrow();
    });
  });
});
