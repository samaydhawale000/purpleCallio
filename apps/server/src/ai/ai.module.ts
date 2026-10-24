import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { BillingModule } from '../billing/billing.module';
import { AiStatusController } from './ai-status.controller';
import { AiAdminController } from './ai-admin.controller';
import { AiAgentController } from './ai-agent.controller';
import { AiSessionController } from './ai-session.controller';
import { AiCallsController } from './ai-calls.controller';
import { AiAgentService } from './ai-agent.service';
import { AiAccessService } from './ai-access.service';
import { AiSessionService } from './ai-session.service';
import { AiBillingService } from './ai-billing.service';
import { AiPricingService } from './ai-pricing.service';
import { AiTranscriptService } from './ai-transcript.service';
import { AiCallsService } from './ai-calls.service';
import { AiEnabledGuard } from './guards/ai-enabled.guard';
import { AiRelayGateway } from './ai-relay.gateway';
import { AiProviderRegistry } from './providers/ai-provider.registry';
import { GeminiProvider } from './providers/gemini/gemini.provider';
import { OpenAiProvider } from './providers/openai/openai.provider';
import { AiToolGatewayService } from './tools/ai-tool-gateway.service';
import { SafeHttpClient } from './tools/safe-http-client';

@Module({
  // JwtModule is needed by AdminGuard on AiAdminController.
  imports: [BillingModule, JwtModule.register({})],
  controllers: [
    AiStatusController,
    AiAgentController,
    AiSessionController,
    AiAdminController,
    AiCallsController,
  ],
  providers: [
    AiAgentService,
    AiAccessService,
    AiSessionService,
    AiBillingService,
    AiPricingService,
    AiEnabledGuard,
    GeminiProvider,
    OpenAiProvider,
    AiProviderRegistry,
    AiRelayGateway,
    SafeHttpClient,
    AiToolGatewayService,
    AiTranscriptService,
    AiCallsService,
  ],
  exports: [
    AiAgentService,
    AiAccessService,
    AiSessionService,
    AiBillingService,
  ],
})
export class AiModule {}
