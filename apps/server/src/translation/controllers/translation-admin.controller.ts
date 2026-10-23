import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AdminGuard } from '../../admin/guards/admin.guard';
import { BillingTabGuard } from './billing-tab.guard';
import { TranslationAdminService } from '../translation-admin.service';
import { parseRange } from '../translation-metrics.service';
import type { PutRateOverrideBody } from '../dto/translation.dto';

interface AdminRequest {
  user: { userId: string };
}

/** Admin: per-customer translation prices and the margin report (PROTOCOL.md §1). */
@UseGuards(AdminGuard, BillingTabGuard)
@Controller('admin/translation')
export class TranslationAdminController {
  constructor(private admin: TranslationAdminService) {}

  @Get('overrides')
  list() {
    return this.admin.listOverrides();
  }

  @Get('overrides/:userId')
  get(@Param('userId') userId: string) {
    return this.admin.getOverride(userId);
  }

  @Put('overrides/:userId')
  put(
    @Req() req: AdminRequest,
    @Param('userId') userId: string,
    @Body() body: PutRateOverrideBody,
  ) {
    return this.admin.putOverride(userId, body, req.user.userId);
  }

  @Delete('overrides/:userId')
  remove(@Req() req: AdminRequest, @Param('userId') userId: string) {
    return this.admin.deleteOverride(userId, req.user.userId);
  }

  /** ?from=YYYY-MM-DD&to=YYYY-MM-DD (to inclusive); defaults to the last 30 days. */
  @Get('margin')
  margin(@Query('from') from?: string, @Query('to') to?: string) {
    const range = parseRange(from, to);
    return this.admin.margin(range.from, range.to);
  }
}
