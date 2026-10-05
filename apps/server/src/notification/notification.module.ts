import { Global, Module } from '@nestjs/common';

import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationCleanupService } from './notification-cleanup.service';

// Global (like PrismaModule) so any feature module can inject
// NotificationService without import wiring or circular-module issues.
@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationCleanupService],
  exports: [NotificationService],
})
export class NotificationModule {}
