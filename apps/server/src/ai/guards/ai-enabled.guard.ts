import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';

import { aiConfig } from '../ai.config';

/**
 * Blocks every /ai/* route (except /ai/status) while AI_ENABLED is off.
 * Listed before JwtGuard so the response is the same for every caller.
 */
@Injectable()
export class AiEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!aiConfig().enabled) {
      throw new ForbiddenException({
        code: 'AI_DISABLED',
        message: 'AI Voice Agents are not enabled.',
      });
    }
    return true;
  }
}
