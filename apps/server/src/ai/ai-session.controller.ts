import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { AiEnabledGuard } from './guards/ai-enabled.guard';
import { AiSessionService } from './ai-session.service';
import {
  CreateAiSessionDto,
  CreatePlaygroundSessionDto,
} from './dto/create-session.dto';

interface ApiKeyRequest {
  project: { id: string; ownerId: string };
}

/**
 * Session API. POST /ai/sessions has no AiEnabledGuard: the service checks
 * the flag itself, after the agent and account checks (stage-02.md order).
 */
@Controller('ai')
export class AiSessionController {
  constructor(private sessions: AiSessionService) {}

  // Prevents a leaked API key from mass-creating sessions.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(ApiKeyGuard)
  @Post('sessions')
  create(@Req() req: ApiKeyRequest, @Body() body: CreateAiSessionDto) {
    return this.sessions.createApiSession(req.project, body);
  }

  @UseGuards(AiEnabledGuard, ApiKeyGuard)
  @Get('sessions/:id')
  get(@Req() req: ApiKeyRequest, @Param('id') id: string) {
    return this.sessions.getForProject(req.project.id, id);
  }

  @UseGuards(AiEnabledGuard, ApiKeyGuard)
  @Post('sessions/:id/end')
  end(@Req() req: ApiKeyRequest, @Param('id') id: string) {
    return this.sessions.endForProject(req.project.id, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AiEnabledGuard, JwtGuard)
  @Post('playground/sessions')
  createPlayground(@Req() req: any, @Body() body: CreatePlaygroundSessionDto) {
    return this.sessions.createPlaygroundSession(req.user.userId, body);
  }
}
