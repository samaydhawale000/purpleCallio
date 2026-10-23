import { Logger, NotFoundException } from '@nestjs/common';
import { createHmac } from 'crypto';

import {
  AiToolGatewayService,
  ToolCallContext,
  TOOL_TEST_PREVIEW_CHARS,
} from './ai-tool-gateway.service';
import { SafeHttpError } from './safe-http-client';

const SECRET = 'bj_tool_' + 'a'.repeat(64);

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool_1',
    agentId: 'agent_1',
    name: 'getCustomerName',
    description: 'Looks up a customer',
    parametersSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        tier: { type: 'string', enum: ['gold', 'silver'] },
      },
      required: ['customerId'],
    },
    endpointUrl: 'https://api.acme.com/tools/customer',
    method: 'POST',
    enabled: true,
    requiresConfirmation: false,
    timeoutMs: 8000,
    signingSecret: SECRET,
    ...overrides,
  };
}

function createFakes(tool: any = makeTool()) {
  const state = {
    tool: tool as any,
    session: { id: 'session_1', toolCallCount: 0 },
    invocations: [] as any[],
    events: [] as any[],
  };
  const prisma: any = {
    aiAgentTool: {
      findFirst: jest.fn(async ({ where }: any) => {
        const t = state.tool;
        if (!t || t.id !== where.id || t.agentId !== where.agentId) return null;
        if (where.enabled === true && !t.enabled) return null;
        return { ...t };
      }),
    },
    aiCallSession: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const s = state.session;
        if (s.id !== where.id || !(s.toolCallCount < where.toolCallCount.lt)) {
          return { count: 0 };
        }
        s.toolCallCount += data.toolCallCount.increment;
        return { count: 1 };
      }),
    },
    aiToolInvocation: {
      create: jest.fn(async ({ data }: any) => {
        state.invocations.push(data);
        return data;
      }),
    },
    callEvent: {
      create: jest.fn(async ({ data }: any) => {
        state.events.push(data);
        return data;
      }),
    },
  };
  const http = {
    request: jest.fn(async () => ({
      status: 200,
      json: { name: 'Sam Rivera' },
      raw: '{"name":"Sam Rivera"}',
    })),
  };
  return { state, prisma, http };
}

const CTX: ToolCallContext = {
  sessionId: 'session_1',
  callId: 'call_1',
  agentId: 'agent_1',
  projectId: 'project_1',
  participantId: 'user_42',
  participantName: 'Sam',
  toolsSnapshot: [{ id: 'tool_1', name: 'getCustomerName' }],
};

const CALL = {
  id: 'fc_1',
  name: 'getCustomerName',
  args: { customerId: 'c_9' },
};

describe('AiToolGatewayService', () => {
  let fakes: ReturnType<typeof createFakes>;
  let gateway: AiToolGatewayService;
  const savedCap = process.env.AI_MAX_TOOL_CALLS_PER_SESSION;
  const savedTimeout = process.env.AI_TOOL_TIMEOUT_MS;

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  beforeEach(() => {
    delete process.env.AI_MAX_TOOL_CALLS_PER_SESSION;
    delete process.env.AI_TOOL_TIMEOUT_MS;
    fakes = createFakes();
    gateway = new AiToolGatewayService(fakes.prisma, fakes.http as any);
  });

  afterAll(() => {
    if (savedCap !== undefined) {
      process.env.AI_MAX_TOOL_CALLS_PER_SESSION = savedCap;
    }
    if (savedTimeout !== undefined) {
      process.env.AI_TOOL_TIMEOUT_MS = savedTimeout;
    }
  });

  const eventNames = () => fakes.state.events.map((e) => e.event);

  it('calls the endpoint with a signed body and returns its JSON', async () => {
    const outcome = await gateway.invoke(CTX, CALL);

    expect(outcome).toMatchObject({
      status: 'SUCCESS',
      toolId: 'tool_1',
      errorCode: null,
      code: null,
      result: { name: 'Sam Rivera' },
    });
    const [req] = fakes.http.request.mock.calls[0] as any[];
    expect(req.url).toBe('https://api.acme.com/tools/customer');
    expect(req.method).toBe('POST');
    expect(req.timeoutMs).toBe(8000);
    expect(req.maxResponseBytes).toBe(65536);
    expect(JSON.parse(req.body)).toEqual({
      tool: 'getCustomerName',
      arguments: { customerId: 'c_9' },
      sessionId: 'session_1',
      callId: 'call_1',
      agentId: 'agent_1',
      participant: { id: 'user_42', name: 'Sam' },
    });
    const timestamp = req.headers['X-PurpleCallio-Timestamp'];
    const expected = createHmac('sha256', SECRET)
      .update(`${timestamp}.${req.body}`)
      .digest('hex');
    expect(req.headers['X-PurpleCallio-Signature']).toBe(`sha256=${expected}`);

    expect(fakes.state.session.toolCallCount).toBe(1);
    expect(fakes.state.invocations).toEqual([
      expect.objectContaining({
        sessionId: 'session_1',
        toolId: 'tool_1',
        toolName: 'getCustomerName',
        status: 'SUCCESS',
        errorCode: null,
      }),
    ]);
    expect(eventNames()).toEqual(['AI_TOOL_CALLED', 'AI_TOOL_COMPLETED']);
    // Neither the row nor the events hold arguments or responses.
    const stored = JSON.stringify([
      fakes.state.invocations,
      fakes.state.events,
    ]);
    expect(stored).not.toContain('c_9');
    expect(stored).not.toContain('Sam Rivera');
  });

  it('wraps non-object JSON so the provider always gets an object', async () => {
    fakes.http.request.mockResolvedValueOnce({
      status: 200,
      json: 'ok' as any,
      raw: '"ok"',
    });
    const outcome = await gateway.invoke(CTX, CALL);
    expect(outcome.result).toEqual({ result: 'ok' });
  });

  it('caps the timeout at AI_TOOL_TIMEOUT_MS', async () => {
    process.env.AI_TOOL_TIMEOUT_MS = '3000';
    await gateway.invoke(CTX, CALL);
    expect((fakes.http.request.mock.calls[0] as any[])[0].timeoutMs).toBe(3000);
  });

  it('refuses a tool that is not in the session snapshot', async () => {
    const outcome = await gateway.invoke(CTX, { ...CALL, name: 'dropTables' });
    expect(outcome).toMatchObject({
      status: 'FAILED',
      toolId: null,
      errorCode: 'TOOL_NOT_IN_SNAPSHOT',
      code: 'AI_TOOL_FAILED',
    });
    expect(fakes.prisma.aiAgentTool.findFirst).not.toHaveBeenCalled();
    expect(fakes.http.request).not.toHaveBeenCalled();
    expect(fakes.state.invocations[0]).toMatchObject({
      toolId: null,
      toolName: 'dropTables',
      status: 'FAILED',
    });
    expect(eventNames()).toEqual(['AI_TOOL_CALLED', 'AI_TOOL_FAILED']);
  });

  it('does not call the endpoint once the call is cancelled', async () => {
    const outcome = await gateway.invoke(CTX, CALL, undefined, () => true);
    expect(outcome).toMatchObject({
      status: 'FAILED',
      errorCode: 'TOOL_CANCELLED',
    });
    expect(fakes.http.request).not.toHaveBeenCalled();
  });

  it('refuses a tool that was disabled after the session started', async () => {
    fakes.state.tool.enabled = false;
    const outcome = await gateway.invoke(CTX, CALL);
    expect(outcome).toMatchObject({
      status: 'FAILED',
      errorCode: 'TOOL_DISABLED',
    });
    expect(fakes.http.request).not.toHaveBeenCalled();
  });

  it('scopes the tool lookup to the session agent and project', async () => {
    await gateway.invoke(CTX, CALL);
    expect(fakes.prisma.aiAgentTool.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'tool_1',
        agentId: 'agent_1',
        enabled: true,
        agent: { projectId: 'project_1', deletedAt: null },
      },
    });
  });

  it('stops at AI_MAX_TOOL_CALLS_PER_SESSION', async () => {
    process.env.AI_MAX_TOOL_CALLS_PER_SESSION = '2';
    await gateway.invoke(CTX, CALL);
    await gateway.invoke(CTX, CALL);
    const third = await gateway.invoke(CTX, CALL);

    expect(third).toMatchObject({
      status: 'FAILED',
      errorCode: 'TOOL_CALL_LIMIT',
    });
    expect(fakes.http.request).toHaveBeenCalledTimes(2);
    expect(fakes.state.session.toolCallCount).toBe(2);
  });

  it('refuses arguments that do not match the schema', async () => {
    for (const args of [
      {},
      { customerId: 42 },
      { customerId: 'c_9', tier: 'platinum' },
      { customerId: 'c_9', extra: true },
    ]) {
      const outcome = await gateway.invoke(CTX, { ...CALL, args });
      expect(outcome).toMatchObject({
        status: 'FAILED',
        errorCode: 'INVALID_ARGUMENTS',
      });
      // The model gets property names to retry with, never values.
      expect(JSON.stringify(outcome.result)).not.toContain('platinum');
    }
    expect(fakes.http.request).not.toHaveBeenCalled();
  });

  it('reports a timeout as TIMEOUT / AI_TOOL_TIMEOUT', async () => {
    fakes.http.request.mockRejectedValueOnce(new SafeHttpError('TIMEOUT'));
    const outcome = await gateway.invoke(CTX, CALL);
    expect(outcome).toMatchObject({
      status: 'TIMEOUT',
      errorCode: 'TIMEOUT',
      code: 'AI_TOOL_TIMEOUT',
      result: { error: 'The tool timed out.' },
    });
    expect(eventNames()).toEqual(['AI_TOOL_CALLED', 'AI_TOOL_FAILED']);
  });

  it.each([
    ['RESPONSE_TOO_LARGE', undefined, 'RESPONSE_TOO_LARGE'],
    ['REDIRECT_REFUSED', 302, 'REDIRECT_REFUSED'],
    ['BLOCKED_ADDRESS', undefined, 'BLOCKED_ADDRESS'],
    ['HTTP_ERROR', 503, 'HTTP_503'],
  ] as const)(
    'reports %s as a failed call without remote text',
    async (code, status, stored) => {
      fakes.http.request.mockRejectedValueOnce(
        new SafeHttpError(code, status, 'secret upstream body'),
      );
      const outcome = await gateway.invoke(CTX, CALL);
      expect(outcome).toMatchObject({
        status: 'FAILED',
        errorCode: stored,
        code: 'AI_TOOL_FAILED',
        result: { error: 'The tool call failed.' },
      });
      expect(JSON.stringify(outcome)).not.toContain('secret upstream body');
    },
  );

  it('treats an unexpected client error as a network failure', async () => {
    fakes.http.request.mockRejectedValueOnce(new Error('ECONNRESET 10.0.0.5'));
    const outcome = await gateway.invoke(CTX, CALL);
    expect(outcome).toMatchObject({
      status: 'FAILED',
      errorCode: 'NETWORK_ERROR',
    });
  });

  describe('requiresConfirmation', () => {
    beforeEach(() => {
      fakes.state.tool.requiresConfirmation = true;
    });

    it('runs the tool once the user approves', async () => {
      const confirm = jest.fn(async () => 'approved' as const);
      const outcome = await gateway.invoke(CTX, CALL, confirm);
      expect(confirm).toHaveBeenCalledWith({
        id: 'fc_1',
        name: 'getCustomerName',
      });
      expect(outcome.status).toBe('SUCCESS');
      expect(fakes.http.request).toHaveBeenCalledTimes(1);
    });

    it('does not run the tool when the user denies', async () => {
      const outcome = await gateway.invoke(CTX, CALL, async () => 'rejected');
      expect(outcome).toMatchObject({
        status: 'REJECTED',
        result: { error: 'The user did not confirm this action.' },
      });
      expect(fakes.http.request).not.toHaveBeenCalled();
      expect(fakes.state.invocations[0].status).toBe('REJECTED');
    });

    it('does not run the tool when nobody answers', async () => {
      const outcome = await gateway.invoke(CTX, CALL, async () => 'timeout');
      expect(outcome.status).toBe('UNCONFIRMED');
      expect(fakes.http.request).not.toHaveBeenCalled();
    });

    it('rejects when there is no way to ask the user', async () => {
      const outcome = await gateway.invoke(CTX, CALL);
      expect(outcome.status).toBe('REJECTED');
      expect(fakes.http.request).not.toHaveBeenCalled();
    });

    it('ignores a model argument claiming the user confirmed', async () => {
      const outcome = await gateway.invoke(
        CTX,
        { ...CALL, args: { customerId: 'c_9', confirmed: true } },
        async () => 'rejected',
      );
      expect(outcome.status).not.toBe('SUCCESS');
      expect(fakes.http.request).not.toHaveBeenCalled();
    });
  });

  describe('testTool', () => {
    it('runs sample arguments through the same client and signs them', async () => {
      const result = await gateway.testTool('user_1', 'agent_1', 'tool_1', {
        customerId: 'c_1',
      });
      expect(result).toEqual({
        status: 'SUCCESS',
        latencyMs: expect.any(Number),
        httpStatus: 200,
        errorCode: null,
        responsePreview: '{"name":"Sam Rivera"}',
      });
      const [req] = fakes.http.request.mock.calls[0] as any[];
      expect(JSON.parse(req.body)).toMatchObject({
        tool: 'getCustomerName',
        sessionId: null,
        test: true,
      });
      expect(req.headers['X-PurpleCallio-Signature']).toMatch(/^sha256=/);
      expect(fakes.state.invocations).toHaveLength(0);
      expect(fakes.prisma.aiAgentTool.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'tool_1',
          agentId: 'agent_1',
          agent: { deletedAt: null, project: { ownerId: 'user_1' } },
        },
      });
    });

    it('returns only the first 2 KB of the response', async () => {
      fakes.http.request.mockResolvedValueOnce({
        status: 200,
        json: {} as any,
        raw: 'x'.repeat(10_000),
      });
      const result = await gateway.testTool('user_1', 'agent_1', 'tool_1', {
        customerId: 'c_1',
      });
      expect(result.responsePreview).toHaveLength(TOOL_TEST_PREVIEW_CHARS);
    });

    it('shows the status and body of a failed call', async () => {
      fakes.http.request.mockRejectedValueOnce(
        new SafeHttpError('HTTP_ERROR', 500, '{"error":"boom"}'),
      );
      const result = await gateway.testTool('user_1', 'agent_1', 'tool_1', {
        customerId: 'c_1',
      });
      expect(result).toMatchObject({
        status: 'FAILED',
        httpStatus: 500,
        errorCode: 'HTTP_500',
        responsePreview: '{"error":"boom"}',
      });
    });

    it('reports bad sample arguments without calling the endpoint', async () => {
      const result = await gateway.testTool('user_1', 'agent_1', 'tool_1', {});
      expect(result).toMatchObject({
        status: 'FAILED',
        errorCode: 'INVALID_ARGUMENTS',
        errors: ['customerId is required'],
      });
      expect(fakes.http.request).not.toHaveBeenCalled();
    });

    it('404s for a tool the user does not own', async () => {
      fakes.state.tool = null;
      await expect(
        gateway.testTool('user_2', 'agent_1', 'tool_1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
