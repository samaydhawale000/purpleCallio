import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  GoneException,
} from '@nestjs/common';

import { CallSessionService } from '../../call-session/services/call-session.service';
import { CallSource, CallStatus } from '@prisma/client';

interface CallSessionRequest {
  headers: Record<string, string | undefined>;
  params?: { id?: string };
  callSession?: Record<string, unknown>;
}

const terminalCallStatuses = new Set<CallStatus>([
  CallStatus.ENDED,
  CallStatus.MISSED,
  CallStatus.REJECTED,
  CallStatus.CANCELLED,
  CallStatus.BUSY,
]);

@Injectable()
export class CallSessionGuard implements CanActivate {
  constructor(private callSessionService: CallSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CallSessionRequest>();

    const authHeader: string | undefined = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Session token required');
    }

    const token = authHeader.slice(7);

    const session = await this.callSessionService.getByToken(token);

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    const requestedCallId = request.params?.id;
    if (requestedCallId && requestedCallId !== session.callId) {
      throw new UnauthorizedException('Invalid or expired session token');
    }

    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired session token');
    }
    if (
      session.call.source === CallSource.PLAYGROUND &&
      ((process.env.PLAYGROUND_ENABLED ?? 'true').toLowerCase() !== 'true' ||
        !session.call.expiresAt ||
        session.call.expiresAt <= new Date() ||
        session.call.status === CallStatus.ENDED ||
        session.call.status === CallStatus.MISSED ||
        session.call.status === CallStatus.REJECTED ||
        session.call.status === CallStatus.CANCELLED ||
        session.call.status === CallStatus.BUSY)
    ) {
      throw new GoneException({
        code: 'PLAYGROUND_CALL_EXPIRED',
        message:
          'This demo call has ended. Playground calls are limited to 1 minute.',
      });
    }
    if (
      session.call.source !== CallSource.PLAYGROUND &&
      terminalCallStatuses.has(session.call.status)
    ) {
      throw new GoneException({
        code: 'CALL_ENDED',
        message: 'This call has ended.',
      });
    }

    // The session row always carries BOTH tokens regardless of which one
    // was presented — resolve the actual role from the token that matched,
    // rather than assuming CALLER whenever a callerToken field is present
    // (it always is, on every session row).
    const role: 'CALLER' | 'RECEIVER' =
      session.callerToken === token ? 'CALLER' : 'RECEIVER';

    request.callSession = { ...session, role };
    return true;
  }
}
