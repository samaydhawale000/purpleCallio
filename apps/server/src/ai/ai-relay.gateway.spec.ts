import { Logger } from '@nestjs/common';

import {
  AI_HEARTBEAT_INTERVAL_MS,
  AI_MAX_AUDIO_FRAME_BYTES,
  AiRelayGateway,
} from './ai-relay.gateway';
import { AiSessionService, hashAiToken } from './ai-session.service';
import {
  AiProviderConnectConfig,
  AiProviderError,
  AiProviderSession,
} from './providers/ai-provider.interface';

const NOW = new Date('2026-10-16T12:00:00Z');
const TOKEN = 'bj_ai_test_token';

/** Prisma-style where matcher for the operators the relay path uses. */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return cond.some((w: any) => matches(row, w));
    const value = row[key] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('notIn' in cond && cond.notIn.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if ('gt' in cond && !(value > cond.gt)) return false;
      if ('lt' in cond && !(value !== null && value < cond.lt)) return false;
      return true;
    }
    return value === cond;
  });
}

function createFakePrisma() {
  const sessions: any[] = [];
  const calls: any[] = [];
  const events: any[] = [];
  const store: any = {
    aiCallSession: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = sessions.find((s) => matches(s, where));
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        sessions.filter((s) => matches(s, where)).map((s) => ({ ...s })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = sessions.filter((s) => matches(s, where));
        rows.forEach((s) => Object.assign(s, data, { updatedAt: new Date() }));
        return { count: rows.length };
      }),
    },
    call: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = calls.filter((c) => matches(c, where));
        rows.forEach((c) => Object.assign(c, data));
        return { count: rows.length };
      }),
    },
    callEvent: {
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
    },
    aiAgentVersion: {
      findUnique: jest.fn(async () => ({
        id: 'version_1',
        instructions: 'Help with orders.',
        welcomeMessage: 'Hi, I am Ava.',
        language: 'en',
        voice: 'Puck',
        model: null,
      })),
    },
    aiAgent: {
      findUnique: jest.fn(async () => ({
        name: 'Ava',
        project: { companyName: 'Acme' },
      })),
    },
  };
  store.$transaction = jest.fn(async (fn: any) => fn(store));
  return { store, sessions, calls, events };
}

class FakeProviderSession extends AiProviderSession {
  readonly inputSampleRate = 16_000;
  readonly outputSampleRate = 24_000;
  sendAudio = jest.fn();
  sendToolResult = jest.fn();
  greet = jest.fn();
  cancelResponse = jest.fn();
  close = jest.fn(() => this.emit('closed'));
}

/** Records outbound emits; `trigger` plays an inbound client event. */
class FakeSocket {
  handshake: any;
  emit = jest.fn();
  disconnect = jest.fn();
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  constructor(token: string) {
    this.handshake = { auth: { token } };
  }

  on(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  trigger(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }

  emitted(event: string) {
    return this.emit.mock.calls
      .filter(([name]) => name === event)
      .map(([, payload]) => payload);
  }
}

describe('AiRelayGateway', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let sessions: AiSessionService;
  let gateway: AiRelayGateway;
  let providerSession: FakeProviderSession;
  let connect: jest.Mock;
  const savedEnabled = process.env.AI_ENABLED;

  const flush = () => jest.advanceTimersByTimeAsync(0);
  const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  function seedSession(overrides: Record<string, unknown> = {}) {
    const row = {
      id: `session_${fake.sessions.length + 1}`,
      callId: `call_${fake.sessions.length + 1}`,
      agentId: 'agent_1',
      agentVersionId: 'version_1',
      tokenHash: hashAiToken(TOKEN),
      provider: 'gemini',
      model: null,
      status: 'CREATED',
      terminationReason: null,
      expiresAt: new Date(Date.now() + 300_000),
      connectedAt: null,
      endedAt: null,
      lastHeartbeatAt: null,
      durationSeconds: null,
      maxDurationSeconds: 600,
      participantId: 'user_1',
      participantName: 'Sam',
      metadata: null,
      toolsSnapshot: [
        {
          id: 'tool_1',
          name: 'lookup_order',
          description: 'Find an order',
          parametersSchema: { type: 'object', properties: {} },
        },
      ],
      inputTokens: 0,
      outputTokens: 0,
      updatedAt: new Date(),
      ...overrides,
    };
    fake.sessions.push(row);
    fake.calls.push({ id: row.callId, status: 'INITIATED', startedAt: null });
    return row;
  }

  async function connectClient(token = TOKEN) {
    const socket = new FakeSocket(token);
    await gateway.handleConnection(socket as any);
    await flush();
    return socket;
  }

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    process.env.AI_ENABLED = 'true';
    fake = createFakePrisma();
    sessions = new AiSessionService(fake.store, {} as any);
    providerSession = new FakeProviderSession();
    connect = jest.fn(
      async (_config: AiProviderConnectConfig) => providerSession,
    );
    const registry = { resolve: jest.fn(() => ({ name: 'gemini', connect })) };
    gateway = new AiRelayGateway(sessions, registry as any, fake.store);
    gateway.onModuleInit();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (savedEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = savedEnabled;
  });

  describe('connect', () => {
    it('activates the session, accepts the Call and opens the provider', async () => {
      const session = seedSession();
      const socket = await connectClient();

      expect(fake.sessions[0]).toMatchObject({
        status: 'ACTIVE',
        connectedAt: NOW,
        lastHeartbeatAt: NOW,
      });
      expect(fake.calls[0]).toMatchObject({
        status: 'ACCEPTED',
        startedAt: NOW,
      });
      expect(fake.events.map((e) => e.event)).toEqual(['AI_SESSION_CONNECTED']);

      const config = connect.mock.calls[0][0];
      expect(config.systemPrompt).toContain('Help with orders.');
      expect(config.systemPrompt).toContain('voice assistant for Acme');
      expect(config.voice).toBe('Puck');
      expect(config.tools).toEqual([
        {
          name: 'lookup_order',
          description: 'Find an order',
          parameters: { type: 'object', properties: {} },
        },
      ]);
      expect(providerSession.greet).toHaveBeenCalledWith('Hi, I am Ava.');
      expect(socket.emitted('ready')).toEqual([
        { inputSampleRate: 16_000, outputSampleRate: 24_000 },
      ]);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(gateway.activeCount).toBe(1);
      expect(session.status).toBe('ACTIVE');
    });

    it('refuses an unknown token, an ended session and a second socket', async () => {
      const unknown = await connectClient('bj_ai_nope');
      expect(unknown.emitted('error')).toEqual([
        { code: 'AI_SESSION_EXPIRED' },
      ]);
      expect(unknown.disconnect).toHaveBeenCalledWith(true);

      seedSession();
      await connectClient();
      const second = await connectClient();
      expect(second.emitted('error')).toEqual([{ code: 'AI_SESSION_ENDED' }]);
      expect(second.disconnect).toHaveBeenCalledWith(true);

      fake.sessions[0].status = 'ENDED';
      const late = await connectClient();
      expect(late.emitted('error')).toEqual([{ code: 'AI_SESSION_ENDED' }]);
    });

    it('refuses an expired token', async () => {
      seedSession({ expiresAt: new Date(NOW.getTime() - 1) });
      const socket = await connectClient();
      expect(socket.emitted('error')).toEqual([{ code: 'AI_SESSION_EXPIRED' }]);
      expect(fake.sessions[0].status).toBe('CREATED');
    });

    it('refuses everything with AI_DISABLED when the flag is off', async () => {
      seedSession();
      process.env.AI_ENABLED = 'false';
      const socket = await connectClient();
      expect(socket.emitted('error')).toEqual([{ code: 'AI_DISABLED' }]);
      expect(fake.sessions[0].status).toBe('CREATED');
    });

    it('fails the session with AI_PROVIDER_UNAVAILABLE when the provider is down', async () => {
      connect.mockRejectedValueOnce(
        new AiProviderError('AI_PROVIDER_UNAVAILABLE'),
      );
      seedSession();
      const socket = await connectClient();

      expect(socket.emitted('error')).toEqual([
        { code: 'AI_PROVIDER_UNAVAILABLE' },
      ]);
      expect(socket.emitted('ended')).toEqual([
        { reason: 'provider_unavailable' },
      ]);
      expect(fake.sessions[0]).toMatchObject({
        status: 'FAILED',
        durationSeconds: 0,
        terminationReason: 'provider_unavailable',
      });
      expect(fake.calls[0].status).toBe('ENDED');
      expect(gateway.activeCount).toBe(0);
    });
  });

  describe('audio and events', () => {
    it('relays audio both ways and caps frame size and rate', async () => {
      seedSession();
      const socket = await connectClient();

      socket.trigger('audio', Buffer.alloc(640));
      socket.trigger('audio', new Uint8Array(320).buffer);
      socket.trigger('audio', Buffer.alloc(AI_MAX_AUDIO_FRAME_BYTES + 2));
      socket.trigger('audio', Buffer.alloc(3));
      socket.trigger('audio', 'not audio');
      expect(providerSession.sendAudio).toHaveBeenCalledTimes(2);

      // A fresh one-second window: at most 100 frames get through.
      await advance(1_000);
      for (let i = 0; i < 150; i++) socket.trigger('audio', Buffer.alloc(320));
      expect(providerSession.sendAudio).toHaveBeenCalledTimes(2 + 100);

      const out = Buffer.from([1, 2]);
      providerSession.emit('audio', out);
      expect(socket.emitted('audio')).toEqual([out]);
    });

    it('writes AI_AGENT_SPEAKING once per turn and flags barge-in', async () => {
      seedSession();
      const socket = await connectClient();

      providerSession.emit('audio', Buffer.alloc(2));
      providerSession.emit('audio', Buffer.alloc(2));
      providerSession.emit('userSpeechStarted');
      providerSession.emit('audio', Buffer.alloc(2));
      providerSession.emit('turnComplete');
      await flush();

      expect(
        fake.events.filter((e) => e.event === 'AI_AGENT_SPEAKING'),
      ).toHaveLength(2);
      expect(socket.emitted('interrupted')).toHaveLength(1);
      expect(socket.emitted('state').map((s) => s.state)).toEqual([
        'listening',
        'speaking',
        'listening',
        'speaking',
        'listening',
      ]);
    });

    it('forwards transcripts and refuses tool calls for now', async () => {
      seedSession();
      const socket = await connectClient();
      const line = { role: 'user', text: 'hello', final: true };
      providerSession.emit('transcript', line as any);
      providerSession.emit('toolCall', {
        id: 'fc_1',
        name: 'lookup_order',
        args: {},
      });

      expect(socket.emitted('transcript')).toEqual([line]);
      expect(providerSession.sendToolResult).toHaveBeenCalledWith('fc_1', {
        error: 'tools not available yet',
      });
    });

    it('ends the call with a code on a provider error', async () => {
      seedSession();
      const socket = await connectClient();
      providerSession.emit('error', 'AI_CONNECTION_FAILED');
      await flush();

      expect(socket.emitted('error')).toEqual([
        { code: 'AI_CONNECTION_FAILED' },
      ]);
      expect(fake.sessions[0]).toMatchObject({
        status: 'FAILED',
        terminationReason: 'provider_error',
      });
    });
  });

  describe('grace reconnect', () => {
    it('lets the same token back in within 15 s and keeps the provider', async () => {
      seedSession();
      const first = await connectClient();
      first.trigger('disconnect');
      await advance(10_000);

      const second = await connectClient();
      expect(second.disconnect).not.toHaveBeenCalled();
      expect(second.emitted('ready')).toHaveLength(1);
      expect(connect).toHaveBeenCalledTimes(1);

      second.trigger('audio', Buffer.alloc(640));
      first.trigger('audio', Buffer.alloc(640));
      expect(providerSession.sendAudio).toHaveBeenCalledTimes(1);

      await advance(20_000);
      expect(fake.sessions[0].status).toBe('ACTIVE');
    });

    it('finalizes at the disconnect time once the grace window passes', async () => {
      seedSession();
      const socket = await connectClient();
      await advance(42_000);
      socket.trigger('audio', Buffer.alloc(640));
      socket.trigger('disconnect');
      await advance(15_000);

      expect(fake.sessions[0]).toMatchObject({
        status: 'ENDED',
        terminationReason: 'disconnected',
        endedAt: new Date(NOW.getTime() + 42_000),
        durationSeconds: 42,
      });
      expect(providerSession.close).toHaveBeenCalledTimes(1);
      expect(gateway.activeCount).toBe(0);

      const late = await connectClient();
      expect(late.emitted('error')).toEqual([{ code: 'AI_SESSION_ENDED' }]);
    });
  });

  describe('timers', () => {
    it('ends at maxDurationSeconds with AI_MAX_DURATION_REACHED', async () => {
      seedSession({ maxDurationSeconds: 30 });
      const socket = await connectClient();
      await advance(29_000);
      expect(fake.sessions[0].status).toBe('ACTIVE');
      await advance(1_000);

      expect(socket.emitted('error')).toEqual([
        { code: 'AI_MAX_DURATION_REACHED' },
      ]);
      expect(socket.emitted('ended')).toEqual([{ reason: 'max_duration' }]);
      expect(fake.sessions[0]).toMatchObject({
        status: 'ENDED',
        durationSeconds: 30,
      });
    });

    it('beats every 15 s and ends after 60 s without client audio', async () => {
      seedSession();
      const socket = await connectClient();
      await advance(AI_HEARTBEAT_INTERVAL_MS);
      expect(fake.sessions[0].lastHeartbeatAt).toEqual(
        new Date(NOW.getTime() + AI_HEARTBEAT_INTERVAL_MS),
      );

      await advance(45_000);
      expect(socket.emitted('ended')).toEqual([{ reason: 'idle_timeout' }]);
      expect(fake.sessions[0].status).toBe('ENDED');
    });

    it('tears down when the session was ended on another instance', async () => {
      seedSession();
      const socket = await connectClient();
      fake.sessions[0].status = 'ENDED';
      fake.sessions[0].terminationReason = 'api';
      socket.trigger('audio', Buffer.alloc(640));
      await advance(AI_HEARTBEAT_INTERVAL_MS);

      expect(socket.emitted('ended')).toEqual([{ reason: 'api' }]);
      expect(providerSession.close).toHaveBeenCalledTimes(1);
      expect(gateway.activeCount).toBe(0);
    });
  });

  describe('finalize', () => {
    it('is idempotent across the client and the API ending at once', async () => {
      seedSession();
      const socket = await connectClient();
      providerSession.emit('usage', { inputTokens: 100, outputTokens: 40 });
      providerSession.emit('usage', { inputTokens: 20, outputTokens: 5 });
      await advance(12_000);
      socket.trigger('audio', Buffer.alloc(640));

      socket.trigger('end');
      const [apiEnded] = await Promise.all([
        sessions.end(fake.sessions[0].id, 'api'),
        flush(),
      ]);
      await flush();

      expect(
        fake.events.filter((e) => e.event === 'AI_SESSION_ENDED'),
      ).toHaveLength(1);
      expect(providerSession.close).toHaveBeenCalledTimes(1);
      expect(socket.emitted('ended')).toHaveLength(1);
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(fake.sessions[0]).toMatchObject({
        status: 'ENDED',
        durationSeconds: 12,
        inputTokens: 120,
        outputTokens: 45,
      });
      expect(typeof apiEnded).toBe('boolean');
      expect(gateway.activeCount).toBe(0);
    });

    it('tears down the socket when the API ends the session', async () => {
      seedSession();
      const socket = await connectClient();
      await sessions.end(fake.sessions[0].id, 'api');
      await flush();

      expect(socket.emitted('ended')).toEqual([{ reason: 'api' }]);
      expect(providerSession.close).toHaveBeenCalledTimes(1);
      expect(gateway.activeCount).toBe(0);
    });

    it('calls the stage 6 onFinalized hook exactly once', async () => {
      const hook = jest
        .spyOn(sessions as any, 'onFinalized')
        .mockResolvedValue(undefined);
      seedSession();
      const socket = await connectClient();
      socket.trigger('end');
      socket.trigger('end');
      await sessions.end(fake.sessions[0].id, 'api');
      await flush();

      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook.mock.calls[0][0]).toMatchObject({ status: 'ENDED' });
    });
  });

  describe('stale-heartbeat sweep', () => {
    it('ends dead sessions at their last heartbeat and leaves live ones', async () => {
      const lastBeat = new Date(NOW.getTime() - 120_000);
      seedSession({
        status: 'ACTIVE',
        connectedAt: new Date(NOW.getTime() - 300_000),
        lastHeartbeatAt: lastBeat,
      });
      seedSession({
        status: 'ACTIVE',
        tokenHash: 'other',
        connectedAt: new Date(NOW.getTime() - 30_000),
        lastHeartbeatAt: new Date(NOW.getTime() - 10_000),
      });

      await sessions.sweepStaleSessions();

      expect(fake.sessions[0]).toMatchObject({
        status: 'ENDED',
        terminationReason: 'heartbeat_lost',
        endedAt: lastBeat,
        durationSeconds: 180,
      });
      expect(fake.sessions[1].status).toBe('ACTIVE');
      expect(fake.calls[0].status).toBe('ENDED');
    });

    it('caps the swept duration at maxDurationSeconds', async () => {
      seedSession({
        status: 'ACTIVE',
        maxDurationSeconds: 60,
        connectedAt: new Date(NOW.getTime() - 600_000),
        lastHeartbeatAt: new Date(NOW.getTime() - 120_000),
      });
      await sessions.sweepStaleSessions();
      expect(fake.sessions[0].durationSeconds).toBe(60);
    });
  });
});
