import {
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PlaygroundAttemptType } from '@prisma/client';

@Injectable()
export class TurnService {
  private readonly logger = new Logger(TurnService.name);
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async getPlaygroundCredentials(
    callId: string,
    rawIp: string,
    expiresAt: Date,
  ) {
    const key = process.env.JWT_ACCESS_SECRET ?? 'local-playground-ip-key';
    const identityKey = createHmac('sha256', key)
      .update(`turn:${callId}`)
      .digest('hex');
    const ipKey = createHmac('sha256', key).update(rawIp).digest('hex');
    const now = new Date();
    const windowStart = new Date(now.getTime() - 60_000);
    const allowed = Number(process.env.PLAYGROUND_TURN_CALLS_PER_MINUTE ?? 3);
    const count = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`purplecallio:turn:${identityKey}:${ipKey}`}))`;
      const current = await tx.playgroundAttempt.count({
        where: {
          identityKey,
          ipKey,
          type: PlaygroundAttemptType.TURN_CREDENTIAL,
          createdAt: { gte: windowStart },
        },
      });
      if (current >= allowed) return current;
      await tx.playgroundAttempt.create({
        data: {
          identityKey,
          ipKey,
          type: PlaygroundAttemptType.TURN_CREDENTIAL,
        },
      });
      return current;
    });
    if (count >= allowed) {
      this.logger.warn(
        `Playground TURN credentials rate limited call=${callId}`,
      );
      throw new HttpException(
        {
          code: 'TURN_RATE_LIMITED',
          message: 'Too many connection attempts. Please try again shortly.',
          retryAfter: 60,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (expiresAt.getTime() <= Date.now()) {
      throw new GoneException({
        code: 'PLAYGROUND_CALL_EXPIRED',
        message:
          'This demo call has ended. Playground calls are limited to 1 minute.',
      });
    }
    return this.getCredentials(true, expiresAt);
  }

  getCredentials(playground = false, playgroundExpiresAt?: Date) {
    const secret = this.config.get<string>('TURN_SECRET');
    const server = this.config.get<string>('TURN_SERVER') ?? 'localhost';

    // Customer credentials keep the existing 24h lifetime; Playground
    // credentials expire with the demo window (and call authorization).
    // Format understood by coturn --use-auth-secret mode (RFC 5766)
    const ttl = playground
      ? Number(process.env.PLAYGROUND_TURN_CREDENTIAL_TTL_SECONDS ?? 60)
      : 86400;
    const expires = Math.min(
      Math.floor(Date.now() / 1000) + ttl,
      playground && playgroundExpiresAt
        ? Math.floor(playgroundExpiresAt.getTime() / 1000)
        : Number.MAX_SAFE_INTEGER,
    );
    const username = `${expires}:purplecallio`;

    const credential = secret
      ? createHmac('sha1', secret).update(username).digest('base64')
      : '';

    const iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
    ];

    if (secret) {
      iceServers.push(
        {
          urls: `turn:${server}:3478`,
          username,
          credential,
        },
        {
          urls: `turns:${server}:5349`,
          username,
          credential,
        },
      );
    }

    return { iceServers };
  }

  /**
   * Real health check for the admin health screen: is TURN configured, and
   * does credential generation actually succeed? This does NOT verify the
   * TURN server is reachable over the network (no live coturn probe) — just
   * that we're not silently reporting "healthy" without checking anything.
   */
  getHealthStatus(): {
    configured: boolean;
    credentialGeneration: 'ok' | 'failed' | 'not_configured';
  } {
    const secret = this.config.get<string>('TURN_SECRET');
    if (!secret) {
      return { configured: false, credentialGeneration: 'not_configured' };
    }
    try {
      const { iceServers } = this.getCredentials();
      const hasTurnEntry = iceServers.some((s) =>
        String(s.urls).startsWith('turn'),
      );
      return {
        configured: true,
        credentialGeneration: hasTurnEntry ? 'ok' : 'failed',
      };
    } catch {
      return { configured: true, credentialGeneration: 'failed' };
    }
  }
}
