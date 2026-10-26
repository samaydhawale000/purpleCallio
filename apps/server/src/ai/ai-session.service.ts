import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AiAgent,
  AiCallSession,
  AiSessionStatus,
  CallSource,
  CallStatus,
  CallType,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { aiConfig } from './ai.config';
import { AiAccessService } from './ai-access.service';
import { AiBillingService } from './ai-billing.service';
import {
  CreateAiSessionDto,
  CreatePlaygroundSessionDto,
} from './dto/create-session.dto';

/** A session in one of these states can never be connected or ended again. */
const TERMINAL_STATUSES: AiSessionStatus[] = [
  AiSessionStatus.ENDED,
  AiSessionStatus.FAILED,
  AiSessionStatus.EXPIRED,
];

const EXPIRY_BATCH_SIZE = 500;
/** A live session whose relay hasn't written a heartbeat for this long is dead. */
export const AI_HEARTBEAT_STALE_MS = 60_000;

export interface AiFinalizeOptions {
  reason: AiSessionEndReason;
  /** ENDED (default) or FAILED. */
  status?: typeof AiSessionStatus.ENDED | typeof AiSessionStatus.FAILED;
  /** Server timestamp the call ended at; defaults to now. */
  endedAt?: Date;
  /** Token totals from the provider's usage events. */
  usage?: { inputTokens: number; outputTokens: number };
  /** The agent never answered (provider failed to open): bill nothing. */
  noDuration?: boolean;
}

export type AiSessionEndedListener = (
  sessionId: string,
  reason: AiSessionEndReason,
) => void;

export type AiSessionEndReason =
  | 'api'
  | 'admin'
  | 'participant'
  | 'max_duration'
  | 'provider_error'
  | 'provider_unavailable'
  | 'idle_timeout'
  | 'disconnected'
  | 'heartbeat_lost'
  | (string & {});

interface SessionStart {
  agent: AiAgent;
  ownerId: string;
  participant: { id: string; name?: string | null };
  metadata?: Record<string, unknown>;
}

function aiError(
  status: HttpStatus,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ code, message }, status);
}

export function hashAiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AiSessionService {
  private readonly logger = new Logger(AiSessionService.name);
  private expiring = false;
  private sweeping = false;
  private readonly endedListeners = new Set<AiSessionEndedListener>();

  constructor(
    private prisma: PrismaService,
    private access: AiAccessService,
    // Optional so the relay can be unit-tested without billing.
    @Optional() private billing?: AiBillingService,
  ) {}

  // ── Create ───────────────────────────────────────────
  /** POST /ai/sessions: the agent must belong to the API key's project. */
  async createApiSession(
    project: { id: string; ownerId: string },
    dto: CreateAiSessionDto,
  ) {
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: dto.agentId, projectId: project.id, deletedAt: null },
    });
    if (!agent) throw this.agentNotFound();
    return this.start({
      agent,
      ownerId: project.ownerId,
      participant: {
        id: dto.participant.id.trim(),
        name: dto.participant.name?.trim() || null,
      },
      metadata: dto.metadata,
    });
  }

  /** POST /ai/playground/sessions: the dashboard user calls their own agent. */
  async createPlaygroundSession(
    userId: string,
    dto: CreatePlaygroundSessionDto,
  ) {
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: dto.agentId, deletedAt: null, project: { ownerId: userId } },
    });
    if (!agent) throw this.agentNotFound();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return this.start({
      agent,
      ownerId: userId,
      participant: { id: userId, name: user?.name ?? null },
      metadata: dto.metadata,
    });
  }

  /**
   * Checks run in a fixed order (see stage-02.md) so each failure maps to
   * one stable error code. Limits are counted under an advisory lock on the
   * owner, so parallel requests can't both squeeze into the last slot.
   */
  private async start({ agent, ownerId, participant, metadata }: SessionStart) {
    if (agent.status !== 'ACTIVE') {
      throw aiError(
        HttpStatus.FORBIDDEN,
        'AI_AGENT_DISABLED',
        'This agent is disabled.',
      );
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { status: true },
    });
    if (!owner) throw new ForbiddenException('Account not found');
    if (owner.status === 'SUSPENDED') {
      throw new ForbiddenException(
        'Account is suspended. Please contact support to resume service.',
      );
    }

    const config = aiConfig();
    if (!config.enabled) {
      throw aiError(
        HttpStatus.FORBIDDEN,
        'AI_DISABLED',
        'AI Voice Agents are not enabled.',
      );
    }

    if (!(await this.access.hasPaidPlan(ownerId))) {
      throw aiError(
        HttpStatus.FORBIDDEN,
        'AI_PAID_PLAN_REQUIRED',
        'AI voice agents unlock after your first verified credit purchase. Add credits in Billing.',
      );
    }

    if (!(await this.access.hasCreditsToStart(ownerId))) {
      throw aiError(
        HttpStatus.FORBIDDEN,
        'AI_INSUFFICIENT_CREDITS',
        'AI voice agents use purchased credits only, and yours are used up. Free credits cover calls only. Add credits in Billing.',
      );
    }

    // Whole minutes the balance pays for: the call can't run far past it.
    const balanceCapSeconds = this.billing
      ? await this.billing.maxSecondsByBalance(ownerId)
      : Number.MAX_SAFE_INTEGER;
    if (balanceCapSeconds <= 0) {
      throw aiError(
        HttpStatus.FORBIDDEN,
        'AI_INSUFFICIENT_CREDITS',
        'Your PurpleCallio credits are used up. Add credits in Billing.',
      );
    }

    const version = agent.currentVersionId
      ? await this.prisma.aiAgentVersion.findUnique({
          where: { id: agent.currentVersionId },
        })
      : null;
    if (!version) {
      this.logger.error(
        `event=ai_session_create_failed agentId=${agent.id} reason=no_version`,
      );
      throw this.createFailed();
    }
    const tools = await this.prisma.aiAgentTool.findMany({
      where: { agentId: agent.id, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    // Signing secrets stay on AiAgentTool; the snapshot only names the tool.
    const toolsSnapshot = tools.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      parametersSchema: t.parametersSchema,
      endpointUrl: t.endpointUrl,
      method: t.method,
      requiresConfirmation: t.requiresConfirmation,
      timeoutMs: t.timeoutMs,
    }));

    const token = `bj_ai_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1000);

    let created: { sessionId: string; callId: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Owner first, then global: every caller takes them in this order.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`purplecallio:ai:owner:${ownerId}`}))`;
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('purplecallio:ai:global'))`;

        const live: Prisma.AiCallSessionWhereInput = {
          OR: [
            {
              status: {
                in: [AiSessionStatus.CONNECTING, AiSessionStatus.ACTIVE],
              },
            },
            { status: AiSessionStatus.CREATED, expiresAt: { gt: now } },
          ],
        };
        const [accountActive, globalActive, daily, monthly, reserved, unbilled] = await Promise.all(
          [
            tx.aiCallSession.count({ where: { ownerId, ...live } }),
            tx.aiCallSession.count({ where: live }),
            tx.aiCallSession.aggregate({
              where: { ownerId, createdAt: { gte: startOfUtcDay(now) } },
              _sum: { durationSeconds: true },
            }),
            tx.aiCallSession.aggregate({
              where: { ownerId, createdAt: { gte: startOfUtcMonth(now) } },
              _sum: { durationSeconds: true },
            }),
            // Time this account's live calls may still use: their duration is
            // only known at finalize, so reserve their full allowance.
            tx.aiCallSession.aggregate({
              where: { ownerId, ...live },
              _sum: { maxDurationSeconds: true },
            }),
            // Finished calls not yet debited still owe the wallet.
            tx.aiCallSession.aggregate({
              where: {
                ownerId,
                usageRecordedAt: null,
                status: { in: [AiSessionStatus.ENDED, AiSessionStatus.FAILED] },
              },
              _sum: { durationSeconds: true },
            }),
          ],
        );
        const reservedSeconds = reserved._sum.maxDurationSeconds ?? 0;

        if (
          accountActive >= config.maxConcurrentSessionsPerAccount ||
          globalActive >= config.globalMaxConcurrentSessions
        ) {
          this.logger.warn(
            `event=ai_concurrency_limit ownerId=${ownerId} account=${accountActive} global=${globalActive}`,
          );
          throw aiError(
            HttpStatus.TOO_MANY_REQUESTS,
            'AI_CONCURRENCY_LIMIT',
            'Too many AI calls are running. Please try again shortly.',
          );
        }

        const dailyLeft =
          config.dailyMinutesPerAccount * 60 -
          (daily._sum.durationSeconds ?? 0) -
          reservedSeconds;
        const monthlyLeft =
          config.monthlyMinutesPerAccount * 60 -
          (monthly._sum.durationSeconds ?? 0) -
          reservedSeconds;
        if (dailyLeft <= 0 || monthlyLeft <= 0) {
          this.logger.warn(
            `event=ai_quota_exceeded ownerId=${ownerId} period=${dailyLeft <= 0 ? 'daily' : 'monthly'}`,
          );
          throw aiError(
            HttpStatus.TOO_MANY_REQUESTS,
            'AI_QUOTA_EXCEEDED',
            'The AI call minutes allowed for this account are used up for now.',
          );
        }

        // Balance left after what running and unbilled calls will spend.
        const balanceLeft =
          balanceCapSeconds -
          reservedSeconds -
          (unbilled._sum.durationSeconds ?? 0);
        if (balanceLeft <= 0) {
          throw aiError(
            HttpStatus.FORBIDDEN,
            'AI_INSUFFICIENT_CREDITS',
            'Your PurpleCallio credits are used up. Add credits in Billing.',
          );
        }

        // A single call can't run past the remaining quota or balance either.
        const maxDurationSeconds = Math.min(
          version.maxDurationSeconds,
          config.maxDurationCapSeconds,
          dailyLeft,
          monthlyLeft,
          balanceLeft,
        );

        const call = await tx.call.create({
          data: {
            projectId: agent.projectId,
            callerId: participant.id,
            callerName: participant.name ?? undefined,
            receiverId: `agent:${agent.id}`,
            receiverName: agent.name,
            type: CallType.AUDIO,
            // INITIATED, not RINGING: the ring-timeout sweep only looks at
            // RINGING calls, and AI calls never ring.
            status: CallStatus.INITIATED,
            source: CallSource.AI_AGENT,
            createdAt: now,
          },
        });
        const session = await tx.aiCallSession.create({
          data: {
            callId: call.id,
            agentId: agent.id,
            agentVersionId: version.id,
            projectId: agent.projectId,
            ownerId,
            tokenHash: hashAiToken(token),
            provider: version.provider,
            model: version.model,
            status: AiSessionStatus.CREATED,
            expiresAt,
            maxDurationSeconds,
            participantId: participant.id,
            participantName: participant.name ?? null,
            metadata: (metadata ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            toolsSnapshot: toolsSnapshot,
          },
        });
        await tx.callEvent.create({
          data: {
            callId: call.id,
            event: 'AI_SESSION_CREATED',
            participantId: participant.id,
            metadata: { sessionId: session.id, agentId: agent.id },
          },
        });
        return { sessionId: session.id, callId: call.id };
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(
        `event=ai_session_create_failed agentId=${agent.id} error=${(e as Error)?.name ?? 'unknown'}`,
      );
      throw this.createFailed();
    }

    this.logger.log(
      `event=ai_session_created sessionId=${created.sessionId} callId=${created.callId} agentId=${agent.id} ownerId=${ownerId}`,
    );
    return {
      sessionId: created.sessionId,
      callId: created.callId,
      token,
      expiresAt,
      connectUrl: connectUrl(),
    };
  }

  // ── Read / verify ────────────────────────────────────
  async getForProject(projectId: string, sessionId: string) {
    return this.toSession(await this.findForProject(projectId, sessionId));
  }

  /**
   * Resolves a browser token to its session. Used by the /ai relay (stage
   * 3); an unknown token, an expired one and an ended one are all refused.
   */
  async verifyToken(token: string): Promise<AiCallSession> {
    if (typeof token !== 'string' || !token.startsWith('bj_ai_')) {
      throw new UnauthorizedException('Invalid session token');
    }
    const session = await this.prisma.aiCallSession.findUnique({
      where: { tokenHash: hashAiToken(token) },
    });
    if (!session) throw new UnauthorizedException('Invalid session token');

    if (
      session.status === AiSessionStatus.EXPIRED ||
      (session.status === AiSessionStatus.CREATED &&
        session.expiresAt.getTime() <= Date.now())
    ) {
      throw aiError(
        HttpStatus.GONE,
        'AI_SESSION_EXPIRED',
        'This AI session has expired. Create a new one.',
      );
    }
    if (
      session.status === AiSessionStatus.ENDED ||
      session.status === AiSessionStatus.FAILED
    ) {
      throw aiError(
        HttpStatus.GONE,
        'AI_SESSION_ENDED',
        'This AI session has ended.',
      );
    }
    return session;
  }

  // ── Relay lifecycle (stage 3) ────────────────────────
  /** Atomically claims a CREATED, unexpired session for one socket. */
  async claimConnection(sessionId: string): Promise<boolean> {
    const claimed = await this.prisma.aiCallSession.updateMany({
      where: {
        id: sessionId,
        status: AiSessionStatus.CREATED,
        expiresAt: { gt: new Date() },
      },
      data: { status: AiSessionStatus.CONNECTING },
    });
    return claimed.count === 1;
  }

  /**
   * CONNECTING → ACTIVE: stamps connectedAt (the start of the billed
   * duration), accepts the Call and writes AI_SESSION_CONNECTED. Returns
   * connectedAt, or null when the session was ended in the meantime.
   */
  async markConnected(sessionId: string): Promise<Date | null> {
    const connectedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.aiCallSession.updateMany({
        where: { id: sessionId, status: AiSessionStatus.CONNECTING },
        data: {
          status: AiSessionStatus.ACTIVE,
          connectedAt,
          lastHeartbeatAt: connectedAt,
        },
      });
      if (claimed.count === 0) return null;
      const session = await tx.aiCallSession.findUnique({
        where: { id: sessionId },
        select: { callId: true, participantId: true },
      });
      if (!session) return null;
      // Same status human calls use once both sides are in.
      await tx.call.updateMany({
        where: { id: session.callId, status: CallStatus.INITIATED },
        data: { status: CallStatus.ACCEPTED, startedAt: connectedAt },
      });
      await tx.callEvent.create({
        data: {
          callId: session.callId,
          event: 'AI_SESSION_CONNECTED',
          participantId: session.participantId,
          metadata: { sessionId },
        },
      });
      return connectedAt;
    });
  }

  /** Returns false once the session is no longer ACTIVE (ended elsewhere). */
  async heartbeat(sessionId: string): Promise<boolean> {
    const updated = await this.prisma.aiCallSession.updateMany({
      where: { id: sessionId, status: AiSessionStatus.ACTIVE },
      data: { lastHeartbeatAt: new Date() },
    });
    return updated.count === 1;
  }

  async getStatus(sessionId: string) {
    return this.prisma.aiCallSession.findUnique({
      where: { id: sessionId },
      select: { status: true, terminationReason: true },
    });
  }

  /** Token totals for a session someone else already finalized. */
  async recordUsage(
    sessionId: string,
    usage: { inputTokens: number; outputTokens: number },
  ) {
    await this.prisma.aiCallSession.updateMany({
      where: { id: sessionId },
      data: usage,
    });
  }

  /** The relay registers here so an API/admin end tears down its socket. */
  onSessionEnded(listener: AiSessionEndedListener): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  // ── End ──────────────────────────────────────────────
  async endForProject(projectId: string, sessionId: string) {
    const session = await this.findForProject(projectId, sessionId);
    await this.end(session.id, 'api');
    return this.getForProject(projectId, session.id);
  }

  /**
   * Idempotent: only the caller that moves the session out of a live state
   * ends the Call and writes AI_SESSION_ENDED. Returns whether it did.
   * Never consults the plan or credits, so a lapsed plan can't cut a call.
   */
  async end(sessionId: string, reason: AiSessionEndReason): Promise<boolean> {
    return this.finalize(sessionId, { reason });
  }

  /**
   * The single end path for every reason (client, API, max duration, idle,
   * provider failure, lost socket, stale heartbeat). The atomic claim makes
   * it idempotent across paths and instances. durationSeconds comes from
   * server timestamps only: connectedAt → endedAt, capped at the max.
   */
  async finalize(
    sessionId: string,
    options: AiFinalizeOptions,
  ): Promise<boolean> {
    const session = await this.prisma.aiCallSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        callId: true,
        connectedAt: true,
        maxDurationSeconds: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const { reason } = options;
    const status = options.status ?? AiSessionStatus.ENDED;
    const endedAt = options.endedAt ?? new Date();
    const durationSeconds =
      options.noDuration || !session.connectedAt
        ? 0
        : Math.min(
            Math.max(
              0,
              Math.floor(
                (endedAt.getTime() - session.connectedAt.getTime()) / 1000,
              ),
            ),
            session.maxDurationSeconds,
          );

    const ended = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.aiCallSession.updateMany({
        where: { id: session.id, status: { notIn: TERMINAL_STATUSES } },
        data: {
          status,
          endedAt,
          terminationReason: reason,
          durationSeconds,
          ...(options.usage ?? {}),
        },
      });
      if (claimed.count === 0) return false;
      await tx.call.updateMany({
        where: { id: session.callId, status: { not: CallStatus.ENDED } },
        data: { status: CallStatus.ENDED, endedAt },
      });
      await tx.callEvent.create({
        data: {
          callId: session.callId,
          event: 'AI_SESSION_ENDED',
          metadata: { sessionId: session.id, reason, status, durationSeconds },
        },
      });
      return true;
    });
    if (!ended) return false;

    this.logger.log(
      `event=ai_session_ended sessionId=${session.id} callId=${session.callId} reason=${reason} status=${status} durationSeconds=${durationSeconds}`,
    );
    await this.runFinalizedHook(session.id);
    for (const listener of this.endedListeners) {
      try {
        listener(session.id, reason);
      } catch {
        // A listener failure must not undo or block the end.
      }
    }
    return true;
  }

  private async runFinalizedHook(sessionId: string) {
    try {
      const finalized = await this.prisma.aiCallSession.findUnique({
        where: { id: sessionId },
      });
      if (finalized) await this.onFinalized(finalized);
    } catch (err) {
      this.logger.error(
        `event=ai_session_finalized_hook_failed sessionId=${sessionId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
    }
  }

  /**
   * Runs once per session, after it reached ENDED/FAILED with its final
   * durationSeconds and token totals: debits the wallet (idempotent, see
   * AiBillingService.recordSession). A failure here is retried by
   * AiBillingService.billUnrecordedSessions.
   */
  protected async onFinalized(session: AiCallSession): Promise<void> {
    await this.billing?.recordSession(session);
  }

  /**
   * Recovers sessions whose relay died (crash, deploy): a live session with
   * no heartbeat for 60 s ends at its last heartbeat, never later.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweepStaleSessions() {
    if (this.sweeping || !aiConfig().enabled) return;
    this.sweeping = true;
    try {
      const cutoff = new Date(Date.now() - AI_HEARTBEAT_STALE_MS);
      const stale = await this.prisma.aiCallSession.findMany({
        where: {
          OR: [
            {
              status: AiSessionStatus.ACTIVE,
              lastHeartbeatAt: { lt: cutoff },
            },
            // Claimed by a socket that died before it went ACTIVE.
            { status: AiSessionStatus.CONNECTING, updatedAt: { lt: cutoff } },
          ],
        },
        select: { id: true, lastHeartbeatAt: true, updatedAt: true },
        take: EXPIRY_BATCH_SIZE,
      });
      let swept = 0;
      for (const session of stale) {
        const ended = await this.finalize(session.id, {
          reason: 'heartbeat_lost',
          endedAt: session.lastHeartbeatAt ?? session.updatedAt,
        });
        if (ended) swept++;
      }
      if (swept > 0) {
        this.logger.warn(`event=ai_sessions_heartbeat_swept count=${swept}`);
      }
    } catch (err) {
      this.logger.error(
        `event=ai_session_sweep_failed error=${(err as Error)?.name ?? 'unknown'}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  /** Browsers that never connected within AI_SESSION_TTL_SECONDS. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireSessions() {
    if (this.expiring || !aiConfig().enabled) return;
    this.expiring = true;
    try {
      const now = new Date();
      const stale = await this.prisma.aiCallSession.findMany({
        where: { status: AiSessionStatus.CREATED, expiresAt: { lte: now } },
        select: { id: true, callId: true },
        take: EXPIRY_BATCH_SIZE,
      });
      let expired = 0;
      for (const session of stale) {
        const claimed = await this.prisma.$transaction(async (tx) => {
          const result = await tx.aiCallSession.updateMany({
            where: { id: session.id, status: AiSessionStatus.CREATED },
            data: {
              status: AiSessionStatus.EXPIRED,
              endedAt: now,
              terminationReason: 'expired',
            },
          });
          if (result.count === 0) return false;
          await tx.call.updateMany({
            where: { id: session.callId, status: { not: CallStatus.ENDED } },
            data: { status: CallStatus.ENDED, endedAt: now },
          });
          await tx.callEvent.create({
            data: {
              callId: session.callId,
              event: 'AI_SESSION_EXPIRED',
              metadata: { sessionId: session.id },
            },
          });
          return true;
        });
        if (claimed) expired++;
      }
      if (expired > 0) {
        this.logger.log(`event=ai_sessions_expired count=${expired}`);
      }
    } catch (err) {
      this.logger.error(
        `event=ai_session_expiry_failed error=${(err as Error)?.name ?? 'unknown'}`,
      );
    } finally {
      this.expiring = false;
    }
  }

  // ── Helpers ──────────────────────────────────────────
  private async findForProject(projectId: string, sessionId: string) {
    const session = await this.prisma.aiCallSession.findFirst({
      where: { id: sessionId, projectId },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  /** Public view: no token hash, provider details, cost or tool snapshot. */
  private toSession(session: AiCallSession) {
    return {
      sessionId: session.id,
      callId: session.callId,
      agentId: session.agentId,
      agentVersionId: session.agentVersionId,
      status: session.status,
      terminationReason: session.terminationReason,
      participantId: session.participantId,
      participantName: session.participantName,
      metadata: session.metadata,
      expiresAt: session.expiresAt,
      connectedAt: session.connectedAt,
      endedAt: session.endedAt,
      durationSeconds: session.durationSeconds,
      maxDurationSeconds: session.maxDurationSeconds,
      toolCallCount: session.toolCallCount,
      creditsCharged: session.creditsCharged,
      createdAt: session.createdAt,
    };
  }

  private agentNotFound() {
    return new NotFoundException({
      code: 'AI_AGENT_NOT_FOUND',
      message: 'Agent not found',
    });
  }

  private createFailed() {
    return new InternalServerErrorException({
      code: 'AI_SESSION_CREATE_FAILED',
      message: 'Could not create the AI session. Please try again.',
    });
  }
}

function startOfUtcDay(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function startOfUtcMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Socket.IO namespace the browser joins with the token (stage 3).
 * PUBLIC_API_URL is this server's public origin (APP_URL is the frontend).
 */
function connectUrl() {
  const base = (
    process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3005}`
  ).replace(/\/+$/, '');
  return `${base}/ai`;
}
