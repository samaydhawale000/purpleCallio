import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';

import { AiProviderError } from '../ai-provider.interface';
import {
  OpenAiProvider,
  OpenAiSession,
  OPENAI_REALTIME_URL,
} from './openai.provider';

/** Stands in for a `ws` WebSocket: records sends, lets the spec push frames. */
class FakeWebSocket extends EventEmitter {
  readyState = 0;
  sent: any[] = [];
  closeCalls = 0;

  constructor(
    public url: string,
    public headers: Record<string, string>,
  ) {
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

  push(message: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }

  /** The provider closing on us. */
  drop(code = 1011) {
    this.readyState = 3;
    this.emit('close', code);
  }

  sentTypes() {
    return this.sent.map((m) => m.type);
  }
}

const CONFIG = {
  systemPrompt: 'You are a test agent.',
  voice: 'marin',
  language: 'en-IN',
  tools: [
    {
      name: 'lookup_order',
      description: 'Find an order',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
    },
  ],
  model: null,
};

describe('OpenAiProvider', () => {
  let provider: OpenAiProvider;
  let socket: FakeWebSocket;
  const savedKey = process.env.OPENAI_API_KEY;
  const savedModel = process.env.AI_OPENAI_MODEL;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.AI_OPENAI_MODEL;
    provider = new OpenAiProvider();
    provider.socketFactory = (url, headers) => {
      socket = new FakeWebSocket(url, headers);
      return socket;
    };
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    if (savedModel === undefined) delete process.env.AI_OPENAI_MODEL;
    else process.env.AI_OPENAI_MODEL = savedModel;
  });

  async function connect(config: any = CONFIG): Promise<OpenAiSession> {
    const pending = provider.connect(config);
    socket.open();
    socket.push({ type: 'session.created', session: {} });
    socket.push({ type: 'session.updated', session: {} });
    return pending;
  }

  function collect(session: OpenAiSession) {
    const events: Array<[string, unknown]> = [];
    for (const name of [
      'audio',
      'transcript',
      'userSpeechStarted',
      'toolCall',
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
    it('authenticates with a header and sends the session config', async () => {
      const session = await connect();

      expect(socket.url).toBe(`${OPENAI_REALTIME_URL}?model=gpt-realtime-2.1`);
      expect(socket.url).not.toContain('sk-test');
      expect(socket.headers).toEqual({ Authorization: 'Bearer sk-test' });
      expect(socket.sent[0]).toEqual({
        type: 'session.update',
        session: {
          type: 'realtime',
          output_modalities: ['audio'],
          instructions: 'You are a test agent.',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24_000 },
              transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
              turn_detection: {
                type: 'server_vad',
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              format: { type: 'audio/pcm', rate: 24_000 },
              voice: 'marin',
            },
          },
          tools: [{ type: 'function', ...CONFIG.tools[0] }],
          tool_choice: 'auto',
        },
      });
      expect(session.inputSampleRate).toBe(24_000);
      expect(session.outputSampleRate).toBe(24_000);
    });

    it('uses AI_OPENAI_MODEL, and the agent model over it', async () => {
      process.env.AI_OPENAI_MODEL = 'gpt-realtime-mini';
      await connect();
      expect(socket.url).toBe(`${OPENAI_REALTIME_URL}?model=gpt-realtime-mini`);

      await connect({ ...CONFIG, model: 'gpt-realtime' });
      expect(socket.url).toBe(`${OPENAI_REALTIME_URL}?model=gpt-realtime`);
    });

    it('drops voices OpenAI does not have and omits tools when there are none', async () => {
      await connect({ ...CONFIG, voice: 'Puck', tools: [] });
      const session = socket.sent[0].session;
      expect(session.audio.output).toEqual({
        format: { type: 'audio/pcm', rate: 24_000 },
      });
      expect(session).not.toHaveProperty('tools');
    });

    it('rejects AI_PROVIDER_UNAVAILABLE without a key, opening nothing', async () => {
      delete process.env.OPENAI_API_KEY;
      const factory = jest.fn();
      provider.socketFactory = factory;
      await expect(provider.connect(CONFIG)).rejects.toEqual(
        new AiProviderError('AI_PROVIDER_UNAVAILABLE'),
      );
      expect(factory).not.toHaveBeenCalled();
      expect(provider.isConfigured()).toBe(false);
    });

    it('rejects when the provider refuses the session config', async () => {
      const pending = provider.connect(CONFIG);
      socket.open();
      socket.push({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'secret detail' },
      });
      await expect(pending).rejects.toMatchObject({
        code: 'AI_PROVIDER_UNAVAILABLE',
        message: 'AI_PROVIDER_UNAVAILABLE',
      });
      expect(socket.closeCalls).toBe(1);
    });

    it('rejects when the socket closes before the session is updated', async () => {
      const pending = provider.connect(CONFIG);
      socket.open();
      socket.push({ type: 'session.created', session: {} });
      socket.drop(4001);
      await expect(pending).rejects.toMatchObject({
        code: 'AI_PROVIDER_UNAVAILABLE',
      });
    });

    it('rejects after the setup timeout', async () => {
      jest.useFakeTimers();
      try {
        const pending = provider.connect(CONFIG);
        socket.open();
        jest.advanceTimersByTime(10_000);
        await expect(pending).rejects.toMatchObject({
          code: 'AI_PROVIDER_UNAVAILABLE',
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('outbound', () => {
    it('appends audio as base64', async () => {
      const session = await connect();
      session.sendAudio(Buffer.from([1, 2, 3, 4]));
      expect(socket.sent.at(-1)).toEqual({
        type: 'input_audio_buffer.append',
        audio: Buffer.from([1, 2, 3, 4]).toString('base64'),
      });
    });

    it('greets with a system item and a response, keeping the session prompt', async () => {
      const session = await connect();
      session.greet('Hi there!');
      expect(socket.sent.slice(1)).toEqual([
        {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: 'Start the call now by saying this greeting to the caller: Hi there!',
              },
            ],
          },
        },
        { type: 'response.create' },
      ]);
    });

    it('sends nothing after close', async () => {
      const session = await connect();
      session.close();
      session.sendAudio(Buffer.from([1, 2]));
      expect(socket.sentTypes()).toEqual(['session.update']);
    });
  });

  describe('inbound mapping', () => {
    it('maps audio deltas to audio', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({ type: 'response.created', response: { id: 'r1' } });
      socket.push({
        type: 'response.output_audio.delta',
        response_id: 'r1',
        delta: Buffer.from([9, 8]).toString('base64'),
      });
      expect(events).toEqual([['audio', Buffer.from([9, 8])]]);
    });

    it('maps agent and user transcripts to partial and final events', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'u1',
        delta: 'Where is ',
      });
      socket.push({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'u1',
        delta: 'my order',
      });
      socket.push({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'u1',
        transcript: 'Where is my order?',
      });
      socket.push({ type: 'response.created', response: { id: 'r1' } });
      socket.push({
        type: 'response.output_audio_transcript.delta',
        response_id: 'r1',
        delta: 'Let me ',
      });
      socket.push({
        type: 'response.output_audio_transcript.delta',
        response_id: 'r1',
        delta: 'check.',
      });
      socket.push({
        type: 'response.output_audio_transcript.done',
        response_id: 'r1',
        transcript: 'Let me check.',
      });

      expect(events).toEqual([
        ['transcript', { role: 'user', text: 'Where is ', final: false }],
        ['transcript', { role: 'user', text: 'Where is my order', final: false }],
        ['transcript', { role: 'user', text: 'Where is my order?', final: true }],
        ['transcript', { role: 'agent', text: 'Let me ', final: false }],
        ['transcript', { role: 'agent', text: 'Let me check.', final: false }],
        ['transcript', { role: 'agent', text: 'Let me check.', final: true }],
      ]);
    });

    it('barge-in cancels the response, flushes the partial and drops late output', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({ type: 'response.created', response: { id: 'r1' } });
      socket.push({
        type: 'response.output_audio_transcript.delta',
        response_id: 'r1',
        delta: 'Your order is',
      });
      socket.push({ type: 'input_audio_buffer.speech_started', item_id: 'u2' });
      socket.push({
        type: 'response.output_audio.delta',
        response_id: 'r1',
        delta: Buffer.from([1]).toString('base64'),
      });
      socket.push({
        type: 'response.output_audio_transcript.done',
        response_id: 'r1',
        transcript: 'Your order is on its way.',
      });
      socket.push({
        type: 'response.done',
        response: {
          id: 'r1',
          status: 'cancelled',
          usage: { input_tokens: 50, output_tokens: 7 },
        },
      });

      expect(socket.sentTypes()).toEqual(['session.update', 'response.cancel']);
      expect(events).toEqual([
        ['transcript', { role: 'agent', text: 'Your order is', final: false }],
        ['transcript', { role: 'agent', text: 'Your order is', final: true }],
        ['userSpeechStarted', undefined],
        ['usage', { inputTokens: 50, outputTokens: 7 }],
      ]);
    });

    it('speech with no response running only signals barge-in', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
      expect(socket.sentTypes()).toEqual(['session.update']);
      expect(events).toEqual([['userSpeechStarted', undefined]]);
    });

    it('maps function calls to toolCall and answers once the response is done', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({ type: 'response.created', response: { id: 'r1' } });
      socket.push({
        type: 'response.function_call_arguments.done',
        response_id: 'r1',
        call_id: 'call_1',
        name: 'lookup_order',
        arguments: '{"id":"A1"}',
      });
      socket.push({
        type: 'response.function_call_arguments.done',
        response_id: 'r1',
        call_id: 'call_2',
        name: 'lookup_order',
        arguments: 'not json',
      });
      expect(events).toEqual([
        ['toolCall', { id: 'call_1', name: 'lookup_order', args: { id: 'A1' } }],
        ['toolCall', { id: 'call_2', name: 'lookup_order', args: {} }],
      ]);

      // Both results arrive while r1 is still open: no response.create yet.
      session.sendToolResult('call_1', { status: 'shipped' });
      session.sendToolResult('call_2', 'not found');
      session.sendToolResult('unknown', {});
      expect(socket.sent.slice(1)).toEqual([
        {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: 'call_1',
            output: '{"status":"shipped"}',
          },
        },
        {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: 'call_2',
            output: '"not found"',
          },
        },
      ]);

      socket.push({
        type: 'response.done',
        response: { id: 'r1', status: 'completed' },
      });
      expect(socket.sentTypes().at(-1)).toBe('response.create');
    });

    it('asks for a response right away when results come after the response ended', async () => {
      const session = await connect();
      socket.push({ type: 'response.created', response: { id: 'r1' } });
      socket.push({
        type: 'response.function_call_arguments.done',
        call_id: 'call_1',
        name: 'lookup_order',
        arguments: '{}',
      });
      socket.push({
        type: 'response.done',
        response: { id: 'r1', status: 'completed' },
      });
      expect(socket.sentTypes()).toEqual(['session.update']);
      session.sendToolResult('call_1', { ok: true });
      expect(socket.sentTypes()).toEqual([
        'session.update',
        'conversation.item.create',
        'response.create',
      ]);
    });

    it('maps response.done to usage and turnComplete', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({ type: 'response.created', response: { id: 'r1' } });
      socket.push({
        type: 'response.done',
        response: {
          id: 'r1',
          status: 'completed',
          usage: {
            input_tokens: 120,
            output_tokens: 80.7,
            input_token_details: { audio_tokens: 100 },
          },
        },
      });
      socket.push({
        type: 'response.done',
        response: { id: 'r2', status: 'completed', usage: { input_tokens: -3 } },
      });
      expect(events).toEqual([
        ['usage', { inputTokens: 120, outputTokens: 80 }],
        ['turnComplete', undefined],
        ['usage', { inputTokens: 0, outputTokens: 0 }],
        ['turnComplete', undefined],
      ]);
    });
  });

  describe('errors', () => {
    it('keeps the session on invalid_request_error', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          code: 'response_cancel_not_active',
          message: 'nothing to cancel',
        },
      });
      expect(events).toEqual([]);
    });

    it('maps other provider errors to AI_CONNECTION_FAILED without the message', async () => {
      const session = await connect();
      const events = collect(session);
      socket.push({
        type: 'error',
        error: { type: 'server_error', message: 'internal detail sk-test' },
      });
      expect(events).toEqual([['error', 'AI_CONNECTION_FAILED']]);
      const warn = Logger.prototype.warn as jest.Mock;
      for (const [line] of warn.mock.calls) {
        expect(String(line)).not.toContain('internal detail');
        expect(String(line)).not.toContain('sk-test');
      }
    });

    it('reports AI_CONNECTION_FAILED then closed when the provider drops', async () => {
      const session = await connect();
      const events = collect(session);
      socket.drop(1011);
      expect(events).toEqual([
        ['error', 'AI_CONNECTION_FAILED'],
        ['closed', undefined],
      ]);
    });

    it('emits closed once and no error on our own close', async () => {
      const session = await connect();
      const events = collect(session);
      session.close();
      session.close();
      expect(events).toEqual([['closed', undefined]]);
    });
  });
});
