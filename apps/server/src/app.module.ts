import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProjectModule } from './project/project.module';
import { CallModule } from './call/call.module';
import { SocketModule } from './socket/socket.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { CallSessionModule } from './call-session/call-session.module';
import { TurnModule } from './turn/turn.module';
import { WebhookModule } from './webhook/webhook.module';
import { PlaygroundModule } from './playground/playground.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { BillingModule } from './billing/billing.module';
import { AdminModule } from './admin/admin.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Global default rate limit (per IP): 100 requests / 60s. Sensitive
    // routes (auth, calls, api-keys, billing) apply a stricter @Throttle()
    // override on top of this — see their controllers.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    ProjectModule,
    CallModule,
    SocketModule,
    ApiKeyModule,
    CallSessionModule,
    TurnModule,
    WebhookModule,
    PlaygroundModule,
    DashboardModule,
    BillingModule,
    AdminModule,
    SupportModule,
  ],
  // TestController is intentionally not registered in the production app;
  // its database-count endpoint is only useful in local development.
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
