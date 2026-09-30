import { Injectable } from '@nestjs/common';

import { randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { CallSource } from '@prisma/client';

@Injectable()
export class CallSessionService {
  constructor(
    private prisma: PrismaService,
  ) {}

  async createSession(
    callId: string,
  ) {
    const callerToken =
      'bj_session_' +
      randomBytes(32).toString('hex');

    const receiverToken =
      'bj_session_' +
      randomBytes(32).toString('hex');

    const call = await this.prisma.call.findUnique({ where: { id: callId }, select: { source: true, expiresAt: true, createdAt: true } });
    const now = Date.now();
    const sessionTtl = call?.source === CallSource.PLAYGROUND
      ? Number(process.env.PLAYGROUND_PARTICIPANT_TOKEN_TTL_SECONDS ?? 180) * 1000
      : 24 * 60 * 60 * 1000;
    const tokenExpiry = now + sessionTtl;
    const expiresAt = call?.source === CallSource.PLAYGROUND && call.expiresAt
      ? new Date(Math.min(tokenExpiry, call.expiresAt.getTime()))
      : new Date(tokenExpiry);

    return this.prisma.callSession.create({
      data: {
        callId,
        callerToken,
        receiverToken,
        expiresAt,
      },
    });
  }

  /** Fetch the session for a call (used to look up existing tokens/URLs
   * for a call that already exists, e.g. duplicate-call-attempt handling). */
  async getByCallId(callId: string) {
    return this.prisma.callSession.findUnique({ where: { callId } });
  }

  /**
   * Resolve a session by either the caller or receiver token.
   * Used by the unified socket `authenticate` flow and by
   * the join/leave endpoints.
   */
  async getByToken(
    token: string,
  ) {
    return this.prisma.callSession.findFirst({
      where: {
        OR: [
          { callerToken: token },
          { receiverToken: token },
        ],
      },
      include: {
        call: {
          include: {
            project: true,
          },
        },
      },
    });
  }

  async deleteByCallId(callId: string) {
    return this.prisma.callSession.deleteMany({ where: { callId } });
  }

}
