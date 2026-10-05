import { Global, Module } from '@nestjs/common';

import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

// Global (like PrismaModule) so any feature module can inject
// NotificationService without import wiring or circular-module issues.
@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
