import { Controller, Get, Optional, Req, UseGuards } from '@nestjs/common';

import { aiConfig } from './ai.config';
import { AiAccessService } from './ai-access.service';
import { OptionalJwtGuard } from './guards/optional-jwt.guard';
import { AiProviderRegistry } from './providers/ai-provider.registry';

/**
 * Public: the dashboard uses this to show or hide the AI nav. `paidPlan` is
 * only included for signed-in callers (for the upgrade prompt). `providers`
 * lists the providers with a configured key (empty while AI is disabled).
 */
@Controller('ai')
export class AiStatusController {
  constructor(
    private access: AiAccessService,
    @Optional() private providers?: AiProviderRegistry,
  ) {}

  @UseGuards(OptionalJwtGuard)
  @Get('status')
  async status(@Req() req: any) {
    const enabled = aiConfig().enabled;
    const providers = this.providers
      ? { providers: enabled ? this.providers.configured() : [] }
      : {};
    if (!req.user?.userId) return { enabled, ...providers };
    return {
      enabled,
      ...providers,
      paidPlan: await this.access.hasPaidPlan(req.user.userId),
    };
  }
}
