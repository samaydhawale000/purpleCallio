import { Logger } from '@nestjs/common';

import { AiRelayGateway } from './ai-relay.gateway';
import { AiSessionService, hashAiToken } from './ai-session.service';
import { AiTranscriptService } from './ai-transcript.service';
import { AiProviderSession } from './providers/ai-provider.interface';

const NOW = new Date('2026-10-17T12:00:00Z');
const TOKEN = 'bj_ai_tok_transcript';

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
    const value = row[key] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('notIn' in cond && cond.notIn.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if ('lt' in cond && !(value !== null && value < cond.lt)) return false;
      return true;
    }
    return value === cond;
  });
}

function createFakePrisma(agent: {
  storeTranscript: boolean;
  transcriptRetentionDays: number | null;
}) {
  const sessions: any[] = [];
  const calls: any[] = [];
  const messages: any[] = [];
  const store: any = {
    aiCallSession: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = sessions.find((s) => matches(s, where));
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = sessions.filter((s) => matches(s, where));
        rows.forEach((s) => {
          const { toolCallCount, ...rest } = data;
          Object.assign(s, rest);
          if (toolCallCount?.increment) {
            s.toolCallCount += toolCallCount.increment;
          }
        });
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
    callEvent: { create: jest.fn(async ({ data }: any) => data) },
    aiAgentVersion: {
      findUnique: jest.fn(async () => ({
        id: 'version_1',
        instructions: 'Help with orders.',
        welcomeMessage: null,
        language: 'en',
        voice: null,
        model: null,
      })),
    },
    aiAgent: {
      // The relay asks for the prompt fields; the transcript service for the toggle.
      findUnique: jest.fn(async ({ select }: any) =>
        select?.storeTranscript
          ? { ...agent }
          : { name: 'Ava', project: { companyName: 'Acme' } },
      ),
    },
    aiConversationMessage: {
      create: jest.fn(async ({ data }: any) => {
        messages.push(data);
        return data;
      }),
    },
  };
  store.$transaction = jest.fn(async (fn: any) => fn(store));

  sessions.push({
    id: 'session_1',
    callId: 'call_1',
    agentId: 'agent_1',
    agentVersionId: 'version_1',
    projectId: 'project_1',
    tokenHash: hashAiToken(TOKEN),
    provider: 'gemini',
    model: null,
    status: 'CREATED',
    expiresAt: new Date(NOW.getTime() + 300_000),
    connectedAt: null,
    endedAt: null,
    durationSeconds: null,
    maxDurationSeconds: 600,
    participantId: 'user_1',
    participantName: 'Sam',
    metadata: null,
    toolsSnapshot: [
      {
        id: 'tool_1',
        name: 'lookup_order',
        description: 'Look up an order',
        parametersSchema: { type: 'object', properties: {} },
      },
    ],
    inputTokens: 0,
    outputTokens: 0,
    toolCallCount: 0,
  });
  calls.push({ id: 'call_1', status: 'INITIATED', startedAt: null });
  return { store, messages };
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

function fakeSocket() {
  return {
    handshake: { auth: { token: TOKEN } },
    emit: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  };
}

describe('AiRelayGateway transcripts', () => {
  const savedEnabled = process.env.AI_ENABLED;
  const savedCap = process.env.AI_MAX_TRANSCRIPT_MESSAGES;
  const flush = () => jest.advanceTimersByTimeAsync(0);

  async function connect(agent: {
    storeTranscript: boolean;
    transcriptRetentionDays: number | null;
  }) {
    const fake = createFakePrisma(agent);
    const providers: FakeProviderSession[] = [];
    const registry = {
      resolve: jest.fn(() => ({
        name: 'gemini',
        connect: jest.fn(async () => {
          const p = new FakeProviderSession();
          providers.push(p);
          return p;
        }),
      })),
    };
    // Stub: the tool gateway has its own spec; only the outcome matters here.
    const tools = {
      invoke: jest.fn(async () => ({
        status: 'SUCCESS',
        code: null,
        result: { ok: true },
      })),
    };
    const gateway = new AiRelayGateway(
      new AiSessionService(fake.store, {} as any),
      registry as any,
      fake.store,
      tools as any,
      new AiTranscriptService(fake.store),
    );
    gateway.onModuleInit();
    await gateway.handleConnection(fakeSocket() as any);
    await flush();
    return { fake, provider: providers[0] };
  }

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    process.env.AI_ENABLED = 'true';
    delete process.env.AI_MAX_TRANSCRIPT_MESSAGES;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (savedEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = savedEnabled;
    if (savedCap === undefined) delete process.env.AI_MAX_TRANSCRIPT_MESSAGES;
    else process.env.AI_MAX_TRANSCRIPT_MESSAGES = savedCap;
  });

  it('stores nothing when the toggle is off', async () => {
    const { fake, provider } = await connect({
      storeTranscript: false,
      transcriptRetentionDays: 30,
    });
    provider.emit('transcript', { role: 'user', text: 'Hello', final: true });
    provider.emit('transcript', { role: 'agent', text: 'Hi!', final: true });
    await flush();

    expect(fake.messages).toEqual([]);
    expect(fake.store.aiConversationMessage.create).not.toHaveBeenCalled();
  });

  it('stores nothing without a retention period', async () => {
    const { fake, provider } = await connect({
      storeTranscript: true,
      transcriptRetentionDays: null,
    });
    provider.emit('transcript', { role: 'user', text: 'Hello', final: true });
    await flush();

    expect(fake.messages).toEqual([]);
  });

  it('stores only final segments, redacted, in order, with tool outcomes', async () => {
    const { fake, provider } = await connect({
      storeTranscript: true,
      transcriptRetentionDays: 30,
    });
    provider.emit('transcript', { role: 'user', text: 'My card', final: false });
    provider.emit('transcript', {
      role: 'user',
      text: 'My card is 4111 1111 1111 1111, email me at sam@example.com',
      final: true,
    });
    provider.emit('toolCall', { id: 'fc_1', name: 'lookup_order', args: { orderId: 'o_1' } });
    await flush();
    provider.emit('transcript', { role: 'agent', text: 'Found it.', final: true });
    await flush();

    expect(fake.messages.map((m) => [m.role, m.content])).toEqual([
      ['USER', 'My card is [redacted number], email me at [redacted email]'],
      ['TOOL', 'lookup_order: success'],
      ['ASSISTANT', 'Found it.'],
    ]);
    expect(fake.messages.every((m) => m.sessionId === 'session_1')).toBe(true);
    // Tool arguments and responses never reach the transcript.
    expect(JSON.stringify(fake.messages)).not.toContain('o_1');
  });

  it('caps messages per session at AI_MAX_TRANSCRIPT_MESSAGES', async () => {
    process.env.AI_MAX_TRANSCRIPT_MESSAGES = '3';
    const { fake, provider } = await connect({
      storeTranscript: true,
      transcriptRetentionDays: 7,
    });
    for (let i = 0; i < 5; i++) {
      provider.emit('transcript', { role: 'user', text: `line ${i}`, final: true });
    }
    await flush();

    expect(fake.messages.map((m) => m.content)).toEqual(['line 0', 'line 1', 'line 2']);
  });
});
