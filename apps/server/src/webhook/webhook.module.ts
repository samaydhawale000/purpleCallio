import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [PrismaModule, BillingModule],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
