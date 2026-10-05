import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { NotificationService } from './notification.service';

/**
 * The current user's own notifications. `audience` selects the customer
 * dashboard (default) or the admin portal feed; either way every query is
 * scoped to the JWT's user, so there is nothing to gain by passing ADMIN as
 * a non-admin — admin-audience rows are only ever created for admins.
 */
@UseGuards(JwtGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private notifications: NotificationService) {}

  @Get()
  list(
    @Req() req: any,
    @Query('audience') audience?: string,
    @Query('filter') filter?: string,
    @Query('page') page?: string,
  ) {
    return this.notifications.list(req.user.userId, { audience, filter, page });
  }

  @Get('unread-count')
  unreadCount(@Req() req: any, @Query('audience') audience?: string) {
    return this.notifications.unreadCount(req.user.userId, audience);
  }

  @Patch('read-all')
  markAllRead(@Req() req: any, @Query('audience') audience?: string) {
    return this.notifications.markAllRead(req.user.userId, audience);
  }

  @Patch(':id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.notifications.markRead(req.user.userId, id);
  }
}
