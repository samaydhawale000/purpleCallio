import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiAgentTool, AiToolInvocationStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { aiConfig } from '../ai.config';
import { validateToolArguments } from '../tool-parameters-schema';
import { SafeHttpClient, SafeHttpError } from './safe-http-client';
import {
  signToolRequest,
  TOOL_EVENT_HEADER,
  TOOL_SIGNATURE_HEADER,
  TOOL_TIMESTAMP_HEADER,
} from './tool-signature';

export type ToolConfirmation = 'approved' | 'rejected' | 'timeout';

/** The parts of an AiCallSession a tool call needs. */
export interface ToolCallContext {
  sessionId: string;
  callId: string;
  agentId: string;
  projectId: string;
  participantId: string;
  participantName: string | null;
  toolsSnapshot: unknown;
}

export interface ToolCallRequest {
  /** Provider's call id; also the id the client confirms. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallOutcome {
  status: AiToolInvocationStatus;
  toolId: string | null;
  latencyMs: number;
  errorCode: string | null;
  /** Client-facing code (`AI_TOOL_FAILED` / `AI_TOOL_TIMEOUT`), if any. */
  code: string | null;
  /** Sent back to the provider: the endpoint's JSON or a short error. */
  result: unknown;
}

/** Asks the end user; resolves once they answer or the wait times out. */
export type ToolConfirmFn = (call: {
  id: string;
  name: string;
}) => Promise<ToolConfirmation>;

export interface ToolTestResult {
  status: AiToolInvocationStatus;
  latencyMs: number;
  httpStatus: number | null;
  errorCode: string | null;
  errors?: string[];
  /** First 2 KB of the response body. */
  responsePreview: string | null;
}

export const TOOL_TEST_PREVIEW_CHARS = 2048;
const NOT_CONFIRMED = { error: 'The user did not confirm this action.' };

interface SnapshotTool {
  id: string;
  name: string;
}

type ExecuteResult =
  | { ok: true; json: unknown; raw: string; status: number; latencyMs: number }
  | { ok: false; error: SafeHttpError; latencyMs: number };

/**
 * Runs a model's tool call against the customer's endpoint. Checks, in
 * order: the tool is in the session's snapshot; it is still enabled on that
 * agent and project; the per-session cap; the arguments; confirmation.
 * Never logs or stores arguments or responses.
 */
@Injectable()
export class AiToolGatewayService {
  private readonly logger = new Logger(AiToolGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: SafeHttpClient,
  ) {}

  async invoke(
    ctx: ToolCallContext,
    call: ToolCallRequest,
    confirm?: ToolConfirmFn,
    /** True once the call was withdrawn or the session is ending. */
    isCancelled?: () => boolean,
  ): Promise<ToolCallOutcome> {
    const snap = findInSnapshot(ctx.toolsSnapshot, call.name);
    this.recordEvent(ctx, 'AI_TOOL_CALLED', {
      toolId: snap?.id ?? null,
      toolName: call.name,
    });
    const fail = (errorCode: string, result: unknown) =>
      this.finish(ctx, call.name, {
        status: AiToolInvocationStatus.FAILED,
        toolId: snap?.id ?? null,
        latencyMs: 0,
        errorCode,
        code: 'AI_TOOL_FAILED',
        result,
      });

    if (!snap) return fail('TOOL_NOT_IN_SNAPSHOT', { error: 'Unknown tool.' });

    const tool = await this.prisma.aiAgentTool.findFirst({
      where: {
        id: snap.id,
        agentId: ctx.agentId,
        enabled: true,
        agent: { projectId: ctx.projectId, deletedAt: null },
      },
    });
    if (!tool) {
      return fail('TOOL_DISABLED', { error: 'This tool is not available.' });
    }

    const claimed = await this.prisma.aiCallSession.updateMany({
      where: {
        id: ctx.sessionId,
        toolCallCount: { lt: aiConfig().maxToolCallsPerSession },
      },
      data: { toolCallCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      return fail('TOOL_CALL_LIMIT', {
        error: 'The tool call limit for this call was reached.',
      });
    }

    const argErrors = validateToolArguments(tool.parametersSchema, call.args);
    if (argErrors.length) {
      return fail('INVALID_ARGUMENTS', {
        error: `Invalid arguments: ${argErrors.join('; ')}.`,
      });
    }

    // Only the end user's answer counts, never anything the model says.
    if (tool.requiresConfirmation) {
      const answer = confirm
        ? await confirm({ id: call.id, name: tool.name })
        : 'rejected';
      if (answer !== 'approved') {
        return this.finish(ctx, call.name, {
          status:
            answer === 'timeout'
              ? AiToolInvocationStatus.UNCONFIRMED
              : AiToolInvocationStatus.REJECTED,
          toolId: tool.id,
          latencyMs: 0,
          errorCode: null,
          code: null,
          result: NOT_CONFIRMED,
        });
      }
    }

    // Last check before side effects: the user may have interrupted or hung up.
    if (isCancelled?.()) {
      return this.finish(ctx, call.name, {
        status: AiToolInvocationStatus.FAILED,
        toolId: tool.id,
        latencyMs: 0,
        errorCode: 'TOOL_CANCELLED',
        code: null,
        result: { error: 'This tool call was cancelled.' },
      });
    }

    const res = await this.execute(tool, call.args, {
      sessionId: ctx.sessionId,
      callId: ctx.callId,
      agentId: ctx.agentId,
      participant: { id: ctx.participantId, name: ctx.participantName },
    });
    if (res.ok) {
      return this.finish(ctx, call.name, {
        status: AiToolInvocationStatus.SUCCESS,
        toolId: tool.id,
        latencyMs: res.latencyMs,
        errorCode: null,
        code: null,
        result: isPlainObject(res.json) ? res.json : { result: res.json },
      });
    }
    const timedOut = res.error.code === 'TIMEOUT';
    return this.finish(ctx, call.name, {
      status: timedOut
        ? AiToolInvocationStatus.TIMEOUT
        : AiToolInvocationStatus.FAILED,
      toolId: tool.id,
      latencyMs: res.latencyMs,
      errorCode: errorCodeOf(res.error),
      code: timedOut ? 'AI_TOOL_TIMEOUT' : 'AI_TOOL_FAILED',
      result: {
        error: timedOut ? 'The tool timed out.' : 'The tool call failed.',
      },
    });
  }

  /**
   * Dashboard "Test call": sample arguments through the same validation,
   * signing and SSRF-safe client. No session, so no invocation row and no
   * confirmation step.
   */
  async testTool(
    userId: string,
    agentId: string,
    toolId: string,
    args: Record<string, unknown>,
  ): Promise<ToolTestResult> {
    const tool = await this.prisma.aiAgentTool.findFirst({
      where: {
        id: toolId,
        agentId,
        agent: { deletedAt: null, project: { ownerId: userId } },
      },
    });
    if (!tool) throw new NotFoundException('Tool not found');

    const errors = validateToolArguments(tool.parametersSchema, args);
    if (errors.length) {
      return {
        status: AiToolInvocationStatus.FAILED,
        latencyMs: 0,
        httpStatus: null,
        errorCode: 'INVALID_ARGUMENTS',
        errors,
        responsePreview: null,
      };
    }

    const res = await this.execute(tool, args, {
      sessionId: null,
      callId: null,
      agentId: tool.agentId,
      participant: { id: 'dashboard-test', name: null },
      test: true,
    });
    this.logger.log(
      `event=ai_tool_test toolId=${tool.id} ok=${res.ok} latencyMs=${res.latencyMs}`,
    );
    if (res.ok) {
      return {
        status: AiToolInvocationStatus.SUCCESS,
        latencyMs: res.latencyMs,
        httpStatus: res.status,
        errorCode: null,
        responsePreview: res.raw.slice(0, TOOL_TEST_PREVIEW_CHARS),
      };
    }
    return {
      status:
        res.error.code === 'TIMEOUT'
          ? AiToolInvocationStatus.TIMEOUT
          : AiToolInvocationStatus.FAILED,
      latencyMs: res.latencyMs,
      httpStatus: res.error.httpStatus ?? null,
      errorCode: errorCodeOf(res.error),
      responsePreview:
        res.error.raw === undefined
          ? null
          : res.error.raw.slice(0, TOOL_TEST_PREVIEW_CHARS),
    };
  }

  private async execute(
    tool: AiAgentTool,
    args: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    const config = aiConfig();
    const body = JSON.stringify({
      tool: tool.name,
      arguments: args,
      ...context,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const started = Date.now();
    try {
      const res = await this.http.request({
        url: tool.endpointUrl,
        method: tool.method,
        body,
        headers: {
          [TOOL_EVENT_HEADER]: 'ai.tool_call',
          [TOOL_TIMESTAMP_HEADER]: String(timestamp),
          [TOOL_SIGNATURE_HEADER]: signToolRequest(
            tool.signingSecret,
            timestamp,
            body,
          ),
        },
        timeoutMs: Math.min(tool.timeoutMs, config.toolTimeoutMs),
        maxResponseBytes: config.toolMaxResponseBytes,
      });
      return { ok: true, ...res, latencyMs: Date.now() - started };
    } catch (e) {
      const error =
        e instanceof SafeHttpError ? e : new SafeHttpError('NETWORK_ERROR');
      return { ok: false, error, latencyMs: Date.now() - started };
    }
  }

  private async finish(
    ctx: ToolCallContext,
    toolName: string,
    outcome: ToolCallOutcome,
  ): Promise<ToolCallOutcome> {
    this.logger.log(
      `event=ai_tool_call sessionId=${ctx.sessionId} toolId=${outcome.toolId ?? 'none'} status=${outcome.status} latencyMs=${outcome.latencyMs}${outcome.errorCode ? ` errorCode=${outcome.errorCode}` : ''}`,
    );
    try {
      await this.prisma.aiToolInvocation.create({
        data: {
          sessionId: ctx.sessionId,
          toolId: outcome.toolId,
          toolName,
          status: outcome.status,
          latencyMs: outcome.latencyMs,
          errorCode: outcome.errorCode,
        },
      });
    } catch (err) {
      this.logger.error(
        `event=ai_tool_invocation_write_failed sessionId=${ctx.sessionId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
    }
    this.recordEvent(
      ctx,
      outcome.status === AiToolInvocationStatus.SUCCESS
        ? 'AI_TOOL_COMPLETED'
        : 'AI_TOOL_FAILED',
      {
        toolId: outcome.toolId,
        toolName,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        errorCode: outcome.errorCode,
      },
    );
    return outcome;
  }

  private recordEvent(
    ctx: ToolCallContext,
    event: string,
    metadata: Record<string, unknown>,
  ) {
    this.prisma.callEvent
      .create({
        data: {
          callId: ctx.callId,
          event,
          metadata: { sessionId: ctx.sessionId, ...metadata },
        },
      })
      .catch(() => undefined);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findInSnapshot(snapshot: unknown, name: string): SnapshotTool | null {
  if (!Array.isArray(snapshot)) return null;
  for (const raw of snapshot) {
    const tool = raw as { id?: unknown; name?: unknown };
    if (typeof tool?.id === 'string' && tool.name === name) {
      return { id: tool.id, name: tool.name };
    }
  }
  return null;
}

/** Stored on AiToolInvocation; never remote text. */
function errorCodeOf(error: SafeHttpError): string {
  return error.code === 'HTTP_ERROR' && error.httpStatus
    ? `HTTP_${error.httpStatus}`
    : error.code;
}
