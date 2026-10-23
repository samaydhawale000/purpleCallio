import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { CallSessionGuard } from '../../common/guards/call-session.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { CallSessionService } from '../../call-session/services/call-session.service';

/**
 * `ApiKeyGuard` when an `x-api-key` header is sent (developer backend,
 * sets `request.project`), else `CallSessionGuard` (participant bearer
 * session token, sets `request.callSession`). Used by
 * PATCH /calls/:id/translation.
 */
@Injectable()
export class ApiKeyOrCallSessionGuard implements CanActivate {
  private readonly apiKey: ApiKeyGuard;
  private readonly session: CallSessionGuard;

  constructor(prisma: PrismaService, callSessions: CallSessionService) {
    this.apiKey = new ApiKeyGuard(prisma);
    this.session = new CallSessionGuard(callSessions);
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    return request.headers?.['x-api-key']
      ? this.apiKey.canActivate(context)
      : this.session.canActivate(context);
  }
}
