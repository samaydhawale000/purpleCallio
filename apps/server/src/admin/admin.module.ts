import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';
import { SocketModule } from '../socket/socket.module';
import { TurnModule } from '../turn/turn.module';
import { BillingModule } from '../billing/billing.module';
import { OciMonitoringModule } from '../oci/oci-monitoring.module';
import { CallModule } from '../call/call.module';

@Module({
  imports: [
    JwtModule.register({}),
    SocketModule,
    TurnModule,
    BillingModule,
    OciMonitoringModule,
    CallModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
