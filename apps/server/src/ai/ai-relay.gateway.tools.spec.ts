import { Logger } from '@nestjs/common';

import {
  AI_RECONNECT_GRACE_MS,
  AI_TOOL_CONFIRM_TIMEOUT_MS,
  AiRelayGateway,
} from './ai-relay.gateway';
import { AiSessionService, hashAiToken } from './ai-session.service';
import { AiProviderSession } from './providers/ai-provider.interface';
import { AiToolGatewayService } from './tools/ai-tool-gateway.service';

const NOW = new Date('2026-10-17T12:00:00Z');

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
  const invocations: any[] = [];
  const tools: any[] = [
    {
      id: 'tool_1',
      agentId: 'agent_1',
      name: 'cancel_order',
      parametersSchema: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
      endpointUrl: 'https://api.acme.com/tools/cancel',
      method: 'POST',
      enabled: true,
      requiresConfirmation: true,
      timeoutMs: 8000,
      signingSecret: 'bj_tool_secret',
    },
  ];
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
        rows.forEach((s) => {
          const { toolCallCount, ...rest } = data;
          Object.assign(s, rest, { updatedAt: new Date() });
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
        welcomeMessage: null,
        language: 'en',
        voice: null,
        model: null,
      })),
    },
    aiAgent: {
      findUnique: jest.fn(async () => ({
        name: 'Ava',
        project: { companyName: 'Acme' },
      })),
    },
    aiAgentTool: {
      findFirst: jest.fn(async ({ where }: any) => {
        const t = tools.find(
          (x) => x.id === where.id && x.agentId === where.agentId && x.enabled,
        );
        return t ? { ...t } : null;
      }),
    },
    aiToolInvocation: {
      create: jest.fn(async ({ data }: any) => {
        invocations.push(data);
        return data;
      }),
    },
  };
  store.$transaction = jest.fn(async (fn: any) => fn(store));
  return { store, sessions, calls, events, invocations, tools };
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

describe('AiRelayGateway tool calls', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let gateway: AiRelayGateway;
  let providers: FakeProviderSession[];
  let http: { request: jest.Mock };
  const savedEnabled = process.env.AI_ENABLED;

  const flush = () => jest.advanceTimersByTimeAsync(0);
  const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  function seedSession(token: string) {
    const n = fake.sessions.length + 1;
    const row = {
      id: `session_${n}`,
      callId: `call_${n}`,
      agentId: 'agent_1',
      agentVersionId: 'version_1',
      projectId: 'project_1',
      tokenHash: hashAiToken(token),
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
          name: 'cancel_order',
          description: 'Cancel an order',
          parametersSchema: fake.tools[0].parametersSchema,
        },
      ],
      inputTokens: 0,
      outputTokens: 0,
      toolCallCount: 0,
      updatedAt: new Date(),
    };
    fake.sessions.push(row);
    fake.calls.push({ id: row.callId, status: 'INITIATED', startedAt: null });
    return row;
  }

  async function connectClient(token: string) {
    const socket = new FakeSocket(token);
    await gateway.handleConnection(socket as any);
    await flush();
    return socket;
  }

  function toolCall(provider: FakeProviderSession, id = 'fc_1') {
    provider.emit('toolCall', {
      id,
      name: 'cancel_order',
      args: { orderId: 'o_1' },
    });
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
    providers = [];
    const connect = jest.fn(async () => {
      const p = new FakeProviderSession();
      providers.push(p);
      return p;
    });
    const registry = { resolve: jest.fn(() => ({ name: 'gemini', connect })) };
    http = {
      request: jest.fn(async () => ({
        status: 200,
        json: { cancelled: true },
        raw: '{"cancelled":true}',
      })),
    };
    const sessions = new AiSessionService(fake.store, {} as any);
    const tools = new AiToolGatewayService(fake.store, http as any);
    gateway = new AiRelayGateway(sessions, registry as any, fake.store, tools);
    gateway.onModuleInit();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (savedEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = savedEnabled;
  });

  it('runs a tool without confirmation and returns the result', async () => {
    fake.tools[0].requiresConfirmation = false;
    seedSession('bj_ai_tok_a');
    const socket = await connectClient('bj_ai_tok_a');
    toolCall(providers[0]);
    await flush();

    expect(providers[0].sendToolResult).toHaveBeenCalledWith('fc_1', {
      cancelled: true,
    });
    expect(socket.emitted('tool_call')).toEqual([
      { id: 'fc_1', name: 'cancel_order', status: 'running' },
      { id: 'fc_1', name: 'cancel_order', status: 'success' },
    ]);
    expect(socket.emitted('tool.confirmation_required')).toEqual([]);
    expect(fake.sessions[0].toolCallCount).toBe(1);
    expect(fake.invocations).toHaveLength(1);
  });

  it('holds the call until the session socket approves', async () => {
    seedSession('bj_ai_tok_a');
    const socket = await connectClient('bj_ai_tok_a');
    toolCall(providers[0]);
    await flush();

    expect(socket.emitted('tool.confirmation_required')).toEqual([
      {
        id: 'fc_1',
        name: 'cancel_order',
        toolCallId: 'fc_1',
        toolName: 'cancel_order',
      },
    ]);
    expect(http.request).not.toHaveBeenCalled();
    expect(providers[0].sendToolResult).not.toHaveBeenCalled();

    socket.trigger('tool.confirm', { id: 'fc_1', approve: true });
    await flush();

    expect(http.request).toHaveBeenCalledTimes(1);
    expect(providers[0].sendToolResult).toHaveBeenCalledWith('fc_1', {
      cancelled: true,
    });
    expect(fake.invocations[0].status).toBe('SUCCESS');
  });

  it('tells the model the user did not confirm on a denial', async () => {
    seedSession('bj_ai_tok_a');
    const socket = await connectClient('bj_ai_tok_a');
    toolCall(providers[0]);
    await flush();
    socket.trigger('tool.confirm', { id: 'fc_1', approve: false });
    await flush();

    expect(http.request).not.toHaveBeenCalled();
    expect(providers[0].sendToolResult).toHaveBeenCalledWith('fc_1', {
      error: 'The user did not confirm this action.',
    });
    expect(socket.emitted('tool_call').at(-1)).toEqual({
      id: 'fc_1',
      name: 'cancel_order',
      status: 'rejected',
    });
    expect(fake.invocations[0].status).toBe('REJECTED');
  });

  it('treats anything but approve === true as a denial', async () => {
    seedSession('bj_ai_tok_a');
    const socket = await connectClient('bj_ai_tok_a');
    toolCall(providers[0]);
    await flush();
    socket.trigger('tool.confirm', { id: 'fc_1', approve: 'yes' });
    await flush();
    expect(http.request).not.toHaveBeenCalled();
    expect(fake.invocations[0].status).toBe('REJECTED');
  });

  it('gives up after 60 s without an answer', async () => {
    seedSession('bj_ai_tok_a');
    const socket = await connectClient('bj_ai_tok_a');
    toolCall(providers[0]);
    await flush();
    // Keep the mic alive so the idle timeout doesn't end the call first.
    for (let t = 0; t < AI_TOOL_CONFIRM_TIMEOUT_MS; t += 10_000) {
      socket.trigger('audio', Buffer.alloc(320));
      await advance(10_000);
    }
    await flush();

    expect(http.request).not.toHaveBeenCalled();
    expect(providers[0].sendToolResult).toHaveBeenCalledWith('fc_1', {
      error: 'The user did not confirm this action.',
    });
    expect(fake.invocations[0].status).toBe('UNCONFIRMED');

    // A late answer changes nothing.
    socket.trigger('tool.confirm', { id: 'fc_1', approve: true });
    await flush();
    expect(http.request).not.toHaveBeenCalled();
  });

  it("ignores a confirmation from another session's socket", async () => {
    seedSession('bj_ai_tok_a');
    seedSession('bj_ai_tok_b');
    const socketA = await connectClient('bj_ai_tok_a');
    const socketB = await connectClient('bj_ai_tok_b');
    toolCall(providers[0]);
    await flush();

    socketB.trigger('tool.confirm', { id: 'fc_1', approve: true });
    await flush();
    expect(http.request).not.toHaveBeenCalled();
    expect(providers[0].sendToolResult).not.toHaveBeenCalled();

    socketA.trigger('tool.confirm', { id: 'fc_1', approve: true });
    await flush();
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('ignores the old socket after a reconnect and re-asks the new one', async () => {
    seedSession('bj_ai_tok_a');
    const oldSocket = await connectClient('bj_ai_tok_a');
    toolCall(providers[0]);
    await flush();

    oldSocket.trigger('disconnect');
    await advance(AI_RECONNECT_GRACE_MS / 2);
    const newSocket = await connectClient('bj_ai_tok_a');
    expect(newSocket.emitted('tool.confirmation_required')).toEqual([
      expect.objectContaining({ id: 'fc_1', name: 'cancel_order' }),
    ]);

    oldSocket.trigger('tool.confirm', { id: 'fc_1', approve: true });
    await flush();
    expect(http.request).not.toHaveBeenCalled();

    newSocket.trigger('tool.confirm', { id: 'fc_1', approve: true });
    await flush();
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('drops a pending confirmation when the call ends', async () => {
    seedSession('bj_ai_tok_a');
    const socket = await connectClient('bj_ai_tok_a');
    const provider = providers[0];
    toolCall(provider);
    await flush();

    socket.trigger('end');
    await flush();

    expect(http.request).not.toHaveBeenCalled();
    expect(provider.sendToolResult).not.toHaveBeenCalled();
    expect(fake.invocations[0].status).toBe('UNCONFIRMED');
  });

  it('sends a short error when the endpoint fails', async () => {
    fake.tools[0].requiresConfirmation = false;
    http.request.mockRejectedValueOnce(new Error('boom from 10.0.0.5'));
    seedSession('bj_ai_tok_a');
    const socket = await connectClient('bj_ai_tok_a');
    toolCall(providers[0]);
    await flush();

    expect(providers[0].sendToolResult).toHaveBeenCalledWith('fc_1', {
      error: 'The tool call failed.',
    });
    expect(socket.emitted('tool_call').at(-1)).toEqual({
      id: 'fc_1',
      name: 'cancel_order',
      status: 'failed',
      code: 'AI_TOOL_FAILED',
    });
  });
});
