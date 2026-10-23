import {
  HttpException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { AiCallSession, AiSessionStatus } from '@prisma/client';
import { Socket } from 'socket.io';

import { socketOriginCallback } from '../common/config/cors';
import { PrismaService } from '../prisma/prisma.service';
import { aiConfig } from './ai.config';
import { buildAiPrompt, sanitizePromptText } from './ai-prompt-builder';
import {
  AiFinalizeOptions,
  AiSessionEndReason,
  AiSessionService,
} from './ai-session.service';
import {
  AiProviderError,
  AiProviderSession,
  AiProviderTool,
  AiToolCallEvent,
} from './providers/ai-provider.interface';
import { AiProviderRegistry } from './providers/ai-provider.registry';
import {
  AiTranscriptService,
  AiTranscriptWriter,
} from './ai-transcript.service';
import {
  AiToolGatewayService,
  ToolCallContext,
  ToolConfirmation,
} from './tools/ai-tool-gateway.service';

export const AI_RECONNECT_GRACE_MS = 15_000;
export const AI_HEARTBEAT_INTERVAL_MS = 15_000;
export const AI_IDLE_TIMEOUT_MS = 60_000;
/** 1 s of 16 kHz PCM16; anything larger is dropped. */
export const AI_MAX_AUDIO_FRAME_BYTES = 32_000;
/** Frames per second per socket (10 ms frames = 100/s); excess is dropped. */
export const AI_MAX_AUDIO_FRAMES_PER_SECOND = 100;
/** How long a `requiresConfirmation` tool waits for the end user. */
export const AI_TOOL_CONFIRM_TIMEOUT_MS = 60_000;
/** Used only when no tool gateway is wired (old specs). */
const TOOLS_NOT_AVAILABLE = { error: 'tools not available yet' };
const TOOL_CALL_FAILED = { error: 'The tool call failed.' };

type AgentState = 'listening' | 'thinking' | 'speaking';

interface PendingConfirm {
  name: string;
  settle: (answer: ToolConfirmation) => void;
}

interface LiveRelay {
  sessionId: string;
  callId: string;
  toolContext: ToolCallContext;
  /** Tool calls waiting for the end user, by provider call id. */
  pendingConfirms: Map<string, PendingConfirm>;
  /** Tool calls the provider withdrew; they must not run. */
  cancelledTools: Set<string>;
  socket: Socket | null;
  provider: AiProviderSession | null;
  /** Set when the agent stores transcripts. */
  transcript: AiTranscriptWriter | null;
  connectedAt: Date | null;
  maxDurationSeconds: number;
  maxTimer?: NodeJS.Timeout;
  heartbeatTimer?: NodeJS.Timeout;
  graceTimer?: NodeJS.Timeout;
  disconnectedAt: Date | null;
  lastAudioAt: number;
  frameWindowStart: number;
  frameCount: number;
  droppedFrames: number;
  /** True from the first agent audio of a turn until the turn ends. */
  speaking: boolean;
  usage: { inputTokens: number; outputTokens: number };
  finalizing: Promise<void> | null;
}

interface RelayEnd extends AiFinalizeOptions {
  /** Sent to the client as `error { code }` before `ended`. */
  code?: string;
  /** Someone else already finalized the session; only tear down here. */
  alreadyFinalized?: boolean;
}

/**
 * Socket.IO namespace `/ai`: the browser streams mic PCM16 here and this
 * server holds the provider connection. Live state is in memory per
 * instance; the DB heartbeat plus AiSessionService.sweepStaleSessions
 * recover sessions whose instance died.
 *
 * Client → server: `audio` (binary PCM16), `end`, `tool.confirm { id, approve }`.
 * Server → client: `ready`, `audio`, `state`, `transcript`, `interrupted`,
 * `tool_call { id, name, status, code? }`,
 * `tool.confirmation_required { id, name, toolCallId, toolName }`,
 * `error { code }`, `ended { reason }`.
 */
@WebSocketGateway({
  namespace: '/ai',
  cors: { origin: socketOriginCallback, credentials: false },
})
export class AiRelayGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AiRelayGateway.name);
  private readonly relays = new Map<string, LiveRelay>();
  private unsubscribe?: () => void;

  constructor(
    private readonly sessions: AiSessionService,
    private readonly providers: AiProviderRegistry,
    private readonly prisma: PrismaService,
    @Optional() private readonly toolGateway?: AiToolGatewayService,
    @Optional() private readonly transcripts?: AiTranscriptService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.sessions.onSessionEnded((sessionId, reason) =>
      this.onEndedElsewhere(sessionId, reason),
    );
  }

  async onModuleDestroy() {
    this.unsubscribe?.();
    await Promise.all(
      [...this.relays.values()].map((relay) =>
        this.finalize(relay, { reason: 'server_shutdown' }),
      ),
    );
  }

  /** Live relays on this instance (admin metrics, specs). */
  get activeCount() {
    return this.relays.size;
  }

  // ── Handshake ────────────────────────────────────────
  async handleConnection(client: Socket) {
    if (!aiConfig().enabled) return this.reject(client, 'AI_DISABLED');

    const token = (client.handshake.auth as { token?: unknown } | undefined)
      ?.token;
    let session: AiCallSession;
    try {
      session = await this.sessions.verifyToken(token as string);
    } catch (e) {
      return this.reject(client, errorCode(e) ?? 'AI_SESSION_EXPIRED');
    }

    if (session.status === AiSessionStatus.CREATED) {
      if (!(await this.sessions.claimConnection(session.id))) {
        return this.reject(client, 'AI_SESSION_ENDED');
      }
      return this.start(client, session);
    }

    // Already connected: only a reconnect inside the grace window.
    const relay = this.relays.get(session.id);
    if (relay && !relay.socket && relay.graceTimer && !relay.finalizing) {
      return this.reattach(relay, client);
    }
    return this.reject(client, 'AI_SESSION_ENDED');
  }

  private reject(client: Socket, code: string) {
    client.emit('error', { code });
    client.disconnect(true);
  }

  // ── Connect ──────────────────────────────────────────
  private async start(client: Socket, session: AiCallSession) {
    const now = Date.now();
    const relay: LiveRelay = {
      sessionId: session.id,
      callId: session.callId,
      toolContext: {
        sessionId: session.id,
        callId: session.callId,
        agentId: session.agentId,
        projectId: session.projectId,
        participantId: session.participantId,
        participantName: session.participantName,
        toolsSnapshot: session.toolsSnapshot,
      },
      pendingConfirms: new Map(),
      cancelledTools: new Set(),
      socket: null,
      provider: null,
      transcript: null,
      connectedAt: null,
      maxDurationSeconds: session.maxDurationSeconds,
      disconnectedAt: null,
      lastAudioAt: now,
      frameWindowStart: now,
      frameCount: 0,
      droppedFrames: 0,
      speaking: false,
      usage: { inputTokens: 0, outputTokens: 0 },
      finalizing: null,
    };
    this.relays.set(session.id, relay);
    this.attachSocket(relay, client);

    try {
      relay.connectedAt = await this.sessions.markConnected(session.id);
    } catch (err) {
      this.logger.error(
        `event=ai_relay_connect_failed sessionId=${session.id} error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return this.finalize(relay, {
        reason: 'connect_failed',
        status: AiSessionStatus.FAILED,
        code: 'AI_CONNECTION_FAILED',
        noDuration: true,
      });
    }
    if (!relay.connectedAt) {
      // Ended (API, sweep) between the claim and now.
      return this.finalize(relay, {
        reason: 'ended',
        alreadyFinalized: true,
      });
    }
    this.startTimers(relay);
    this.logger.log(
      `event=ai_session_connected sessionId=${session.id} callId=${session.callId}`,
    );

    const transcript = this.openTranscript(session);
    let provider: AiProviderSession;
    let welcome: string | null;
    try {
      ({ provider, welcome } = await this.openProvider(session));
    } catch (e) {
      const code =
        e instanceof AiProviderError ? e.code : 'AI_PROVIDER_UNAVAILABLE';
      this.logger.warn(
        `event=ai_provider_connect_failed sessionId=${session.id} provider=${session.provider} code=${code}`,
      );
      return this.finalize(relay, {
        reason: 'provider_unavailable',
        status: AiSessionStatus.FAILED,
        code: 'AI_PROVIDER_UNAVAILABLE',
        noDuration: true,
      });
    }
    if (relay.finalizing) {
      // The client left or the session was ended while we were connecting.
      provider.close();
      return;
    }
    relay.provider = provider;
    relay.transcript = await transcript;
    this.wireProvider(relay, provider);

    if (welcome) provider.greet(welcome);

    relay.socket?.emit('ready', this.readyPayload(provider));
    this.emitState(relay, 'listening');
  }

  private async openProvider(session: AiCallSession) {
    const provider = this.providers.resolve(session.provider);
    if (!provider) throw new AiProviderError('AI_PROVIDER_UNAVAILABLE');

    const [version, agent] = await Promise.all([
      this.prisma.aiAgentVersion.findUnique({
        where: { id: session.agentVersionId },
      }),
      this.prisma.aiAgent.findUnique({
        where: { id: session.agentId },
        select: { name: true, project: { select: { companyName: true } } },
      }),
    ]);
    if (!version || !agent) {
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE');
    }

    const tools = toolsFromSnapshot(session.toolsSnapshot);
    const systemPrompt = buildAiPrompt({
      agentName: agent.name,
      companyName: agent.project?.companyName,
      participantName: session.participantName,
      tools,
      instructions: version.instructions,
      language: version.language,
      metadata: session.metadata as Record<string, unknown> | null,
    });
    const connected = await provider.connect({
      systemPrompt,
      voice: version.voice,
      language: version.language,
      tools,
      model: session.model ?? version.model,
    });
    const welcome = sanitizePromptText(version.welcomeMessage ?? '').trim();
    return { provider: connected, welcome: welcome || null };
  }

  /** Never blocks or fails the call: no writer means nothing is stored. */
  private async openTranscript(
    session: AiCallSession,
  ): Promise<AiTranscriptWriter | null> {
    if (!this.transcripts) return null;
    try {
      return await this.transcripts.openWriter(session.id, session.agentId);
    } catch (err) {
      this.logger.warn(
        `event=ai_transcript_open_failed sessionId=${session.id} error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return null;
    }
  }

  private readyPayload(provider: AiProviderSession) {
    return {
      inputSampleRate: provider.inputSampleRate,
      outputSampleRate: provider.outputSampleRate,
    };
  }

  private reattach(relay: LiveRelay, client: Socket) {
    clearTimeout(relay.graceTimer);
    relay.graceTimer = undefined;
    relay.disconnectedAt = null;
    relay.lastAudioAt = Date.now();
    this.attachSocket(relay, client);
    this.logger.log(`event=ai_relay_reconnected sessionId=${relay.sessionId}`);
    if (relay.provider) {
      client.emit('ready', this.readyPayload(relay.provider));
      this.emitState(relay, relay.speaking ? 'speaking' : 'listening');
    }
    // Questions asked while the client was away.
    for (const [id, pending] of relay.pendingConfirms) {
      client.emit('tool.confirmation_required', confirmPayload(id, pending));
    }
  }

  // ── Client socket ────────────────────────────────────
  private attachSocket(relay: LiveRelay, client: Socket) {
    relay.socket = client;
    client.on('audio', (frame: unknown) =>
      this.onClientAudio(relay, client, frame),
    );
    client.on('end', () => {
      if (relay.socket !== client) return;
      void this.finalize(relay, { reason: 'participant' });
    });
    client.on('tool.confirm', (payload: unknown) =>
      this.onToolConfirm(relay, client, payload),
    );
    client.on('disconnect', () => this.onClientDisconnect(relay, client));
  }

  /** Only the session's current socket can answer; anything else is ignored. */
  private onToolConfirm(relay: LiveRelay, client: Socket, payload: unknown) {
    if (relay.socket !== client || relay.finalizing) return;
    const body = payload as { id?: unknown; approve?: unknown } | null;
    if (typeof body?.id !== 'string') return;
    relay.pendingConfirms
      .get(body.id)
      ?.settle(body.approve === true ? 'approved' : 'rejected');
  }

  private onClientAudio(relay: LiveRelay, client: Socket, frame: unknown) {
    if (relay.socket !== client || relay.finalizing) return;
    const pcm = toBuffer(frame);
    const now = Date.now();
    if (now - relay.frameWindowStart >= 1000) {
      if (relay.droppedFrames > 0) {
        this.logger.warn(
          `event=ai_audio_frames_dropped sessionId=${relay.sessionId} count=${relay.droppedFrames}`,
        );
      }
      relay.frameWindowStart = now;
      relay.frameCount = 0;
      relay.droppedFrames = 0;
    }
    relay.frameCount++;
    if (
      !pcm ||
      pcm.length === 0 ||
      pcm.length > AI_MAX_AUDIO_FRAME_BYTES ||
      pcm.length % 2 !== 0 ||
      relay.frameCount > AI_MAX_AUDIO_FRAMES_PER_SECOND
    ) {
      relay.droppedFrames++;
      return;
    }
    relay.lastAudioAt = now;
    relay.provider?.sendAudio(pcm);
  }

  private onClientDisconnect(relay: LiveRelay, client: Socket) {
    if (relay.socket !== client || relay.finalizing) return;
    relay.socket = null;
    relay.disconnectedAt = new Date();
    relay.graceTimer = setTimeout(() => {
      void this.finalize(relay, {
        reason: 'disconnected',
        endedAt: relay.disconnectedAt ?? undefined,
      });
    }, AI_RECONNECT_GRACE_MS);
    relay.graceTimer.unref?.();
  }

  // ── Provider ─────────────────────────────────────────
  private wireProvider(relay: LiveRelay, provider: AiProviderSession) {
    provider.on('audio', (pcm) => {
      if (!relay.speaking) {
        relay.speaking = true;
        this.emitState(relay, 'speaking');
        this.recordSpeaking(relay);
      }
      relay.socket?.emit('audio', pcm);
    });
    provider.on('transcript', (event) => {
      relay.socket?.emit('transcript', event);
      if (event.final) {
        relay.transcript?.add(
          event.role === 'agent' ? 'ASSISTANT' : 'USER',
          event.text,
        );
      }
      if (event.role === 'user' && event.final && !relay.speaking) {
        this.emitState(relay, 'thinking');
      }
    });
    provider.on('userSpeechStarted', () => {
      relay.speaking = false;
      relay.socket?.emit('interrupted');
      this.emitState(relay, 'listening');
    });
    provider.on('turnComplete', () => {
      relay.speaking = false;
      this.emitState(relay, 'listening');
    });
    provider.on('toolCall', (call) => {
      this.emitState(relay, 'thinking');
      if (!this.toolGateway) {
        provider.sendToolResult(call.id, TOOLS_NOT_AVAILABLE);
        return;
      }
      void this.runTool(relay, provider, call);
    });
    provider.on('toolCallCancelled', (ids) => {
      for (const id of ids) {
        relay.cancelledTools.add(id);
        relay.pendingConfirms.get(id)?.settle('rejected');
      }
    });
    provider.on('usage', (usage) => {
      relay.usage.inputTokens += usage.inputTokens;
      relay.usage.outputTokens += usage.outputTokens;
    });
    provider.on('error', (code) => {
      void this.finalize(relay, {
        reason: 'provider_error',
        status: AiSessionStatus.FAILED,
        code,
      });
    });
    provider.on('closed', () => {
      void this.finalize(relay, {
        reason: 'provider_error',
        status: AiSessionStatus.FAILED,
        code: 'AI_CONNECTION_FAILED',
      });
    });
  }

  // ── Tools ────────────────────────────────────────────
  private async runTool(
    relay: LiveRelay,
    provider: AiProviderSession,
    call: AiToolCallEvent,
  ) {
    const gateway = this.toolGateway!;
    relay.socket?.emit('tool_call', {
      id: call.id,
      name: call.name,
      status: 'running',
    });
    let status = 'failed';
    let code: string | null = 'AI_TOOL_FAILED';
    let result: unknown = TOOL_CALL_FAILED;
    try {
      const outcome = await gateway.invoke(
        relay.toolContext,
        call,
        (c) => this.askConfirmation(relay, c),
        () => Boolean(relay.finalizing) || relay.cancelledTools.has(call.id),
      );
      status = outcome.status.toLowerCase();
      code = outcome.code;
      result = outcome.result;
    } catch (err) {
      this.logger.error(
        `event=ai_tool_call_failed sessionId=${relay.sessionId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
    }
    // Name and outcome only: arguments and responses are never stored.
    relay.transcript?.add('TOOL', `${call.name}: ${status}`);
    if (relay.finalizing || relay.provider !== provider) return;
    const withdrawn = relay.cancelledTools.delete(call.id);
    relay.socket?.emit('tool_call', {
      id: call.id,
      name: call.name,
      status,
      ...(code ? { code } : {}),
    });
    // A withdrawn call has no turn waiting for its result.
    if (!withdrawn) provider.sendToolResult(call.id, result);
  }

  /** Holds the tool call until this session's socket answers, or 60 s pass. */
  private askConfirmation(
    relay: LiveRelay,
    call: { id: string; name: string },
  ): Promise<ToolConfirmation> {
    if (relay.finalizing) return Promise.resolve('timeout');
    relay.pendingConfirms.get(call.id)?.settle('rejected');
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => pending.settle('timeout'),
        AI_TOOL_CONFIRM_TIMEOUT_MS,
      );
      timer.unref?.();
      const pending: PendingConfirm = {
        name: call.name,
        settle: (answer) => {
          if (relay.pendingConfirms.get(call.id) !== pending) return;
          clearTimeout(timer);
          relay.pendingConfirms.delete(call.id);
          resolve(answer);
        },
      };
      relay.pendingConfirms.set(call.id, pending);
      relay.socket?.emit(
        'tool.confirmation_required',
        confirmPayload(call.id, pending),
      );
    });
  }

  /** One AI_AGENT_SPEAKING event per agent turn, never per frame. */
  private recordSpeaking(relay: LiveRelay) {
    this.prisma.callEvent
      .create({
        data: {
          callId: relay.callId,
          event: 'AI_AGENT_SPEAKING',
          metadata: { sessionId: relay.sessionId },
        },
      })
      .catch(() => undefined);
  }

  private emitState(relay: LiveRelay, state: AgentState) {
    relay.socket?.emit('state', { state });
  }

  // ── Timers ───────────────────────────────────────────
  private startTimers(relay: LiveRelay) {
    const elapsed = Date.now() - (relay.connectedAt?.getTime() ?? Date.now());
    relay.maxTimer = setTimeout(
      () => {
        void this.finalize(relay, {
          reason: 'max_duration',
          code: 'AI_MAX_DURATION_REACHED',
        });
      },
      Math.max(0, relay.maxDurationSeconds * 1000 - elapsed),
    );
    relay.maxTimer.unref?.();

    relay.heartbeatTimer = setInterval(
      () => void this.tick(relay),
      AI_HEARTBEAT_INTERVAL_MS,
    );
    relay.heartbeatTimer.unref?.();
  }

  private async tick(relay: LiveRelay) {
    if (relay.finalizing) return;
    if (Date.now() - relay.lastAudioAt >= AI_IDLE_TIMEOUT_MS) {
      return this.finalize(relay, { reason: 'idle_timeout' });
    }
    try {
      if (await this.sessions.heartbeat(relay.sessionId)) return;
    } catch (err) {
      // Keep going; the sweep only ends us after 60 s of failed beats.
      this.logger.warn(
        `event=ai_heartbeat_failed sessionId=${relay.sessionId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return;
    }
    // No longer ACTIVE: ended on another instance or by the sweep.
    const status = await this.sessions
      .getStatus(relay.sessionId)
      .catch(() => null);
    await this.finalize(relay, {
      reason: status?.terminationReason ?? 'ended',
      alreadyFinalized: true,
    });
  }

  private stopTimers(relay: LiveRelay) {
    clearTimeout(relay.maxTimer);
    clearInterval(relay.heartbeatTimer);
    clearTimeout(relay.graceTimer);
    relay.graceTimer = undefined;
  }

  // ── Finalize ─────────────────────────────────────────
  /** Ended by the API, an admin or the sweep on this instance. */
  private onEndedElsewhere(sessionId: string, reason: AiSessionEndReason) {
    const relay = this.relays.get(sessionId);
    if (!relay || relay.finalizing) return;
    void this.finalize(relay, { reason, alreadyFinalized: true });
  }

  /**
   * Idempotent per relay: every path gets the same promise. The work is
   * deferred a tick so `finalizing` is set before anything (like the
   * provider's `closed` event) can re-enter.
   */
  private finalize(relay: LiveRelay, end: RelayEnd): Promise<void> {
    if (relay.finalizing) return relay.finalizing;
    relay.finalizing = Promise.resolve().then(() =>
      this.runFinalize(relay, end),
    );
    return relay.finalizing;
  }

  private async runFinalize(relay: LiveRelay, end: RelayEnd) {
    this.stopTimers(relay);
    for (const pending of [...relay.pendingConfirms.values()]) {
      pending.settle('timeout');
    }
    const provider = relay.provider;
    relay.provider = null;
    if (provider) {
      provider.removeAllListeners();
      provider.close();
    }

    const usage = { ...relay.usage };
    try {
      let claimed = false;
      if (!end.alreadyFinalized) {
        claimed = await this.sessions.finalize(relay.sessionId, {
          reason: end.reason,
          status: end.status,
          endedAt: end.endedAt,
          noDuration: end.noDuration,
          usage,
        });
      }
      // Lost the race to another path: still keep the token totals.
      if (!claimed && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
        await this.sessions.recordUsage(relay.sessionId, usage);
      }
    } catch (err) {
      this.logger.error(
        `event=ai_relay_finalize_failed sessionId=${relay.sessionId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
    }

    const socket = relay.socket;
    relay.socket = null;
    if (socket) {
      if (end.code) socket.emit('error', { code: end.code });
      socket.emit('ended', { reason: end.reason });
      socket.disconnect(true);
    }
    this.relays.delete(relay.sessionId);
  }
}

function errorCode(e: unknown): string | null {
  if (!(e instanceof HttpException)) return null;
  const body = e.getResponse();
  return body && typeof body === 'object' && 'code' in body
    ? String(body.code)
    : null;
}

/** `id`/`name` for the SDK; `toolCallId`/`toolName` as the spec names them. */
function confirmPayload(id: string, pending: PendingConfirm) {
  return { id, name: pending.name, toolCallId: id, toolName: pending.name };
}

function toBuffer(frame: unknown): Buffer | null {
  if (Buffer.isBuffer(frame)) return frame;
  if (frame instanceof ArrayBuffer) return Buffer.from(frame);
  if (ArrayBuffer.isView(frame)) {
    return Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  }
  return null;
}

/** toolsSnapshot (stage 2) → provider declarations. No secrets in it. */
function toolsFromSnapshot(snapshot: unknown): AiProviderTool[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.flatMap((raw) => {
    const tool = raw as {
      name?: unknown;
      description?: unknown;
      parametersSchema?: unknown;
    };
    if (typeof tool?.name !== 'string') return [];
    return [
      {
        name: tool.name,
        description:
          typeof tool.description === 'string' ? tool.description : '',
        parameters:
          tool.parametersSchema && typeof tool.parametersSchema === 'object'
            ? (tool.parametersSchema as Record<string, unknown>)
            : { type: 'object', properties: {} },
      },
    ];
  });
}
