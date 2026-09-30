import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CallSource,
  CallStatus,
  CallType,
  PlaygroundAttemptType,
} from '@prisma/client';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const PLAYGROUND_PROJECT_NAME = 'PurpleCallio Playground';
const activeStatuses = [
  CallStatus.INITIATED,
  CallStatus.RINGING,
  CallStatus.ACCEPTED,
];
interface PlaygroundUser {
  userId: string;
}

@Injectable()
export class PlaygroundService {
  private readonly logger = new Logger(PlaygroundService.name);
  constructor(private readonly prisma: PrismaService) {}

  async createDemoCall(
    user: PlaygroundUser,
    type: 'AUDIO' | 'VIDEO' = 'VIDEO',
    rawIp = 'unknown',
  ) {
    if ((process.env.PLAYGROUND_ENABLED ?? 'true').toLowerCase() !== 'true') {
      this.logger.warn(
        `Playground call rejected: disabled user=${user.userId}`,
      );
      throw new ServiceUnavailableException({
        code: 'PLAYGROUND_DISABLED',
        message: 'The Playground is temporarily unavailable.',
      });
    }

    const ipKey = createHmac(
      'sha256',
      process.env.JWT_ACCESS_SECRET ?? 'local-playground-ip-key',
    )
      .update(rawIp)
      .digest('hex');
    const identityKey = createHmac(
      'sha256',
      process.env.JWT_ACCESS_SECRET ?? 'local-playground-ip-key',
    )
      .update(`user:${user.userId}`)
      .digest('hex');
    const now = new Date();
    const durationSeconds = Math.min(
      this.readLimit('PLAYGROUND_CALL_DURATION_SECONDS', 60),
      60,
    );
    const expiresAt = new Date(now.getTime() + durationSeconds * 1000);
    const perIpMax = this.readLimit('PLAYGROUND_CALL_RATE_LIMIT_MAX', 5);
    const perIpWindowMs =
      this.readLimit('PLAYGROUND_CALL_RATE_LIMIT_WINDOW_SECONDS', 600) * 1000;
    const dailyMax = this.readLimit('PLAYGROUND_DAILY_CALL_LIMIT', 20);
    const globalMax = this.readLimit('PLAYGROUND_MAX_ACTIVE_CALLS_GLOBAL', 5);
    const ipActiveMax = this.readLimit('PLAYGROUND_MAX_ACTIVE_CALLS_PER_IP', 1);
    const identityActiveMax = this.readLimit(
      'PLAYGROUND_MAX_ACTIVE_CALLS_PER_IDENTITY',
      1,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      // Do not queue unbounded transactions behind the global capacity check.
      const [globalLock] = await tx.$queryRaw<
        Array<{ locked: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtext('purplecallio:playground:global')) AS locked`;
      if (!globalLock?.locked) {
        throw new ServiceUnavailableException({
          code: 'PLAYGROUND_CAPACITY_REACHED',
          message:
            'The playground is currently at capacity. Please try again shortly.',
        });
      }
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`purplecallio:playground:${identityKey}`}))`;
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`purplecallio:playground:${ipKey}`}))`;

      const activeWhere = {
        source: CallSource.PLAYGROUND,
        status: { in: activeStatuses },
        expiresAt: { gt: now },
      };
      const [
        activeGlobal,
        activeIdentity,
        activeIp,
        recentIp,
        todayIp,
        oldestRecent,
        oldestDaily,
      ] = await Promise.all([
        tx.call.count({ where: activeWhere }),
        tx.call.count({
          where: { ...activeWhere, creatorIdentity: identityKey },
        }),
        tx.call.count({ where: { ...activeWhere, creatorIpKey: ipKey } }),
        tx.playgroundAttempt.count({
          where: {
            ipKey,
            type: PlaygroundAttemptType.CALL_CREATION,
            createdAt: { gte: new Date(now.getTime() - perIpWindowMs) },
          },
        }),
        tx.playgroundAttempt.count({
          where: {
            ipKey,
            type: PlaygroundAttemptType.CALL_CREATION,
            createdAt: { gte: new Date(now.getTime() - 86_400_000) },
          },
        }),
        tx.playgroundAttempt.findFirst({
          where: {
            ipKey,
            type: PlaygroundAttemptType.CALL_CREATION,
            createdAt: { gte: new Date(now.getTime() - perIpWindowMs) },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        tx.playgroundAttempt.findFirst({
          where: {
            ipKey,
            type: PlaygroundAttemptType.CALL_CREATION,
            createdAt: { gte: new Date(now.getTime() - 86_400_000) },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
      ]);

      if (activeIdentity >= identityActiveMax || activeIp >= ipActiveMax) {
        throw new ConflictException({
          code: 'PLAYGROUND_ACTIVE_CALL_EXISTS',
          message: 'You already have an active demo call.',
        });
      }
      if (activeGlobal >= globalMax) {
        this.logger.warn(`Playground capacity reached user=${user.userId}`);
        throw new ServiceUnavailableException({
          code: 'PLAYGROUND_CAPACITY_REACHED',
          message:
            'The playground is currently at capacity. Please try again shortly.',
        });
      }
      if (recentIp >= perIpMax || todayIp >= dailyMax) {
        const windowMs = recentIp >= perIpMax ? perIpWindowMs : 86_400_000;
        const oldest = recentIp >= perIpMax ? oldestRecent : oldestDaily;
        const retryAfter = Math.max(
          1,
          Math.ceil(
            (windowMs -
              (now.getTime() -
                (oldest?.createdAt.getTime() ?? now.getTime()))) /
              1000,
          ),
        );
        this.logger.warn(
          `Playground rate limited user=${user.userId} ip=${ipKey.slice(0, 12)}`,
        );
        throw new HttpException(
          {
            code: 'PLAYGROUND_RATE_LIMITED',
            message: 'Too many playground attempts. Please try again later.',
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      let project = await tx.project.findFirst({
        where: { name: PLAYGROUND_PROJECT_NAME, ownerId: user.userId },
      });
      if (!project)
        project = await tx.project.create({
          data: { name: PLAYGROUND_PROJECT_NAME, ownerId: user.userId },
        });
      const callerId = `playground_${randomBytes(16).toString('hex')}`;
      const receiverId = `playground_${randomBytes(16).toString('hex')}`;
      const maxParticipants = Math.min(
        this.readLimit('PLAYGROUND_MAX_PARTICIPANTS', 2),
        2,
      );
      const call = await tx.call.create({
        data: {
          projectId: project.id,
          callerId,
          receiverId,
          type: type === 'AUDIO' ? CallType.AUDIO : CallType.VIDEO,
          status: CallStatus.RINGING,
          source: CallSource.PLAYGROUND,
          createdAt: now,
          expiresAt,
          maxParticipants,
          creatorIdentity: identityKey,
          creatorIpKey: ipKey,
        },
      });
      const callerToken = `bj_session_${randomBytes(32).toString('hex')}`;
      const receiverToken = `bj_session_${randomBytes(32).toString('hex')}`;
      await tx.callSession.create({
        data: { callId: call.id, callerToken, receiverToken, expiresAt },
      });
      await tx.callEvent.create({
        data: {
          callId: call.id,
          event: 'CALL_CREATED',
          participantId: callerId,
        },
      });
      await tx.playgroundAttempt.create({ data: { identityKey, ipKey } });
      return {
        callId: call.id,
        callerToken,
        receiverToken,
        callerId,
        receiverId,
      };
    });

    this.logger.log(
      `Playground call created call=${result.callId} user=${user.userId}`,
    );
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    const callerUrl = `${frontend}/call?token=${result.callerToken}&callId=${result.callId}`;
    const receiverUrl = `${frontend}/call?token=${result.receiverToken}&callId=${result.callId}`;
    return {
      success: true,
      callId: result.callId,
      callerToken: result.callerToken,
      receiverToken: result.receiverToken,
      callerUrl,
      receiverUrl,
      hostedUrl: callerUrl,
      participants: [
        {
          participantId: result.callerId,
          token: result.callerToken,
          hostedUrl: callerUrl,
          expiresAt,
        },
        {
          participantId: result.receiverId,
          token: result.receiverToken,
          hostedUrl: receiverUrl,
          expiresAt,
        },
      ],
      expiresAt,
      maxParticipants: Math.min(
        this.readLimit('PLAYGROUND_MAX_PARTICIPANTS', 2),
        2,
      ),
    };
  }

  private readLimit(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }
}
