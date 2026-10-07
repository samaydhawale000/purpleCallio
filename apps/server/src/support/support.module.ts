import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { SupportController } from './support.controller';
import { AdminSupportController } from './admin-support.controller';
import { SupportService } from './support.service';
import { AdminGuard } from '../admin/guards/admin.guard';

@Module({
  // JwtModule is needed by AdminGuard, which verifies the token itself.
  imports: [JwtModule.register({})],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, AdminGuard],
  exports: [SupportService],
})
export class SupportModule {}
