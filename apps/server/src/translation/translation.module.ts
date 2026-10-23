import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { BillingModule } from '../billing/billing.module';
import { BillingAuditService } from '../billing/billing-audit.service';
import { CallSessionModule } from '../call-session/call-session.module';
import { WebhookModule } from '../webhook/webhook.module';

import { TranslationController } from './controllers/translation.controller';
import { TranslationDashboardController } from './controllers/translation-dashboard.controller';
import { TranslationAdminController } from './controllers/translation-admin.controller';
import { OptionalJwtGuard } from './controllers/optional-jwt.guard';
import { BillingTabGuard } from './controllers/billing-tab.guard';
import { ApiKeyOrCallSessionGuard } from './controllers/api-key-or-session.guard';

import { TranslationRelayGateway } from './translation-relay.gateway';
import { TranslationSessionService } from './translation-session.service';
import { TranslationAccessService } from './translation-access.service';
import { TranslationBillingService } from './translation-billing.service';
import { CostGuardService } from './cost-guard.service';
import { TranslationTranscriptWriter } from './translation-transcript.writer';
import { TranslationProviderRegistry } from './providers/translation-provider.registry';
import { TranslationRouter } from './providers/translation-router';
import { MockTranslationProvider } from './providers/mock/mock.provider';
import { OpenAiTranslateProvider } from './providers/openai/openai-translate.provider';
import { SarvamProvider } from './providers/sarvam/sarvam.provider';

import { TranslationSettingsService } from './translation-settings.service';
import { TranslationLexiconService } from './translation-lexicon.service';
import { TranslationMetricsService } from './translation-metrics.service';
import { TranslationEstimateService } from './translation-estimate.service';
import { TranslationAdminService } from './translation-admin.service';
import { TranslationReportService } from './report/translation-report.service';
import { OpenAiReportSummarizer } from './report/openai-summarizer';
import { ExtractiveReportSummarizer } from './report/extractive-summarizer';
import { reportSummarizerProvider } from './report/summarizer.provider';

/**
 * Live Translate (translation/PROTOCOL.md): `/translate` Socket.IO relay,
 * provider routes, billing/CostGuard, PurpleLex, observability, Post-Call
 * Suite and the REST/dashboard/admin APIs. CallModule imports this module
 * (POST /calls validation, PATCH /calls/:id/translation, reports); this
 * module must therefore never import CallModule.
 */
@Module({
  // JwtModule: AdminGuard + OptionalJwtGuard verify tokens directly.
  imports: [BillingModule, WebhookModule, CallSessionModule, JwtModule.register({})],
  controllers: [
    TranslationController,
    TranslationDashboardController,
    TranslationAdminController,
  ],
  providers: [
    // Relay + realtime
    TranslationRelayGateway,
    TranslationSessionService,
    TranslationAccessService,
    TranslationBillingService,
    CostGuardService,
    TranslationTranscriptWriter,
    // Provider routes
    MockTranslationProvider,
    OpenAiTranslateProvider,
    SarvamProvider,
    TranslationProviderRegistry,
    TranslationRouter,
    // REST / dashboard / admin
    TranslationSettingsService,
    TranslationLexiconService,
    TranslationMetricsService,
    TranslationEstimateService,
    TranslationAdminService,
    // Stateless audit writer (not exported by BillingModule).
    BillingAuditService,
    // Post-Call Suite
    OpenAiReportSummarizer,
    ExtractiveReportSummarizer,
    reportSummarizerProvider,
    TranslationReportService,
    // Guards
    OptionalJwtGuard,
    BillingTabGuard,
    ApiKeyOrCallSessionGuard,
  ],
  exports: [
    TranslationRelayGateway,
    TranslationAccessService,
    TranslationSessionService,
    TranslationBillingService,
    TranslationSettingsService,
    TranslationLexiconService,
    TranslationReportService,
    ApiKeyOrCallSessionGuard,
  ],
})
export class TranslationModule {}
