import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { publicLanguageList } from '../languages';
import { TranslationEstimateService } from '../translation-estimate.service';
import { TranslationLexiconService } from '../translation-lexicon.service';
import { TranslationMetricsService } from '../translation-metrics.service';
import { TranslationSettingsService } from '../translation-settings.service';
import type {
  CreateLexiconBody,
  EstimateQuery,
  ImportLexiconCsvBody,
  LexiconFromPackBody,
  LexiconTermInput,
  MetricsQuery,
  UpdateLexiconBody,
  UpdateTranslationSettingsBody,
} from '../dto/translation.dto';
import { OptionalJwtGuard } from './optional-jwt.guard';

interface ApiKeyRequest {
  project: { id: string };
}

/**
 * Developer REST API for Live Translate (translation/PROTOCOL.md §1).
 * `languages` and `estimate` are public; everything else is scoped to the
 * API key's project.
 */
@Controller('translation')
export class TranslationController {
  constructor(
    private settings: TranslationSettingsService,
    private lexicons: TranslationLexiconService,
    private metricsService: TranslationMetricsService,
    private estimates: TranslationEstimateService,
  ) {}

  @Get('languages')
  languages() {
    return publicLanguageList();
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('estimate')
  @UseGuards(OptionalJwtGuard)
  estimate(@Req() req: { user?: { userId?: string } }, @Query() q: EstimateQuery) {
    return this.estimates.estimate(q, req.user?.userId ?? null);
  }

  // ── Settings ────────────────────────────────────────
  @Get('settings')
  @UseGuards(ApiKeyGuard)
  getSettings(@Req() req: ApiKeyRequest) {
    return this.settings.getPublic(req.project.id);
  }

  @Patch('settings')
  @UseGuards(ApiKeyGuard)
  updateSettings(
    @Req() req: ApiKeyRequest,
    @Body() body: UpdateTranslationSettingsBody,
  ) {
    return this.settings.update(req.project.id, body);
  }

  // ── PurpleLex (static routes before :id) ────────────
  @Get('lexicons/packs')
  @UseGuards(ApiKeyGuard)
  packs() {
    return this.lexicons.packs();
  }

  @Post('lexicons/from-pack')
  @UseGuards(ApiKeyGuard)
  fromPack(@Req() req: ApiKeyRequest, @Body() body: LexiconFromPackBody) {
    return this.lexicons.fromPack(req.project.id, body);
  }

  @Get('lexicons')
  @UseGuards(ApiKeyGuard)
  listLexicons(@Req() req: ApiKeyRequest) {
    return this.lexicons.list(req.project.id);
  }

  @Post('lexicons')
  @UseGuards(ApiKeyGuard)
  createLexicon(@Req() req: ApiKeyRequest, @Body() body: CreateLexiconBody) {
    return this.lexicons.create(req.project.id, body);
  }

  @Get('lexicons/:id')
  @UseGuards(ApiKeyGuard)
  getLexicon(@Req() req: ApiKeyRequest, @Param('id') id: string) {
    return this.lexicons.get(req.project.id, id);
  }

  @Patch('lexicons/:id')
  @UseGuards(ApiKeyGuard)
  updateLexicon(
    @Req() req: ApiKeyRequest,
    @Param('id') id: string,
    @Body() body: UpdateLexiconBody,
  ) {
    return this.lexicons.update(req.project.id, id, body);
  }

  @Delete('lexicons/:id')
  @UseGuards(ApiKeyGuard)
  deleteLexicon(@Req() req: ApiKeyRequest, @Param('id') id: string) {
    return this.lexicons.remove(req.project.id, id);
  }

  @Put('lexicons/:id/terms')
  @UseGuards(ApiKeyGuard)
  putTerms(
    @Req() req: ApiKeyRequest,
    @Param('id') id: string,
    @Body() body: LexiconTermInput[] | { terms: LexiconTermInput[] },
  ) {
    return this.lexicons.upsertTerms(req.project.id, id, termsOf(body));
  }

  @Delete('lexicons/:id/terms/:termId')
  @UseGuards(ApiKeyGuard)
  deleteTerm(
    @Req() req: ApiKeyRequest,
    @Param('id') id: string,
    @Param('termId') termId: string,
  ) {
    return this.lexicons.deleteTerm(req.project.id, id, termId);
  }

  @Post('lexicons/:id/import')
  @UseGuards(ApiKeyGuard)
  importCsv(
    @Req() req: ApiKeyRequest,
    @Param('id') id: string,
    @Body() body: ImportLexiconCsvBody,
  ) {
    return this.lexicons.importCsv(req.project.id, id, body?.csv);
  }

  // ── Observability ───────────────────────────────────
  @Get('metrics')
  @UseGuards(ApiKeyGuard)
  metrics(@Req() req: ApiKeyRequest, @Query() q: MetricsQuery) {
    return this.metricsService.metrics(req.project.id, q);
  }
}

/** PUT …/terms accepts a bare array (PROTOCOL) or `{ terms: [...] }`. */
export function termsOf(body: unknown): unknown {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && 'terms' in body)
    return (body as { terms: unknown }).terms;
  return body;
}
