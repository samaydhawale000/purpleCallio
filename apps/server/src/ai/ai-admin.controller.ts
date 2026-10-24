import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminGuard } from '../admin/guards/admin.guard';
import { AiBillingService } from './ai-billing.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

/**
 * Admin AI billing report. Lives under /admin/billing so the billing tab's
 * permission applies, and is not behind AiEnabledGuard: past AI usage stays
 * visible when the flag is turned off.
 */
@UseGuards(AdminGuard)
@Controller('admin/billing/ai-usage')
export class AiAdminController {
  constructor(private billing: AiBillingService) {}

  /** ?from=YYYY-MM-DD&to=YYYY-MM-DD (to inclusive); defaults to this month. */
  @Get()
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    const start = from
      ? parseDay(from, 'from')
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = to
      ? new Date(parseDay(to, 'to').getTime() + DAY_MS)
      : new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
            DAY_MS,
        );
    if (end <= start) {
      throw new BadRequestException('"to" must not be before "from".');
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `The range can be at most ${MAX_RANGE_DAYS} days.`,
      );
    }
    return this.billing.adminSummary(start, end);
  }
}

function parseDay(value: string, name: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(`${value}T00:00:00Z`) : null;
  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`"${name}" must be a date (YYYY-MM-DD).`);
  }
  return date;
}
