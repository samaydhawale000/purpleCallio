import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { AiEnabledGuard } from './guards/ai-enabled.guard';
import { AiCallsService } from './ai-calls.service';
import { AnalyticsQueryDto, ListCallsQueryDto } from './dto/list-calls.dto';

/** Dashboard call history and analytics for the signed-in account. */
@UseGuards(AiEnabledGuard, JwtGuard)
@Controller('ai')
export class AiCallsController {
  constructor(private calls: AiCallsService) {}

  @Get('calls')
  list(@Req() req: any, @Query() query: ListCallsQueryDto) {
    return this.calls.list(req.user.userId, query);
  }

  @Get('calls/:sessionId')
  detail(@Req() req: any, @Param('sessionId') sessionId: string) {
    return this.calls.detail(req.user.userId, sessionId);
  }

  @Get('analytics')
  analytics(@Req() req: any, @Query() query: AnalyticsQueryDto) {
    return this.calls.analytics(req.user.userId, query);
  }
}
