import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtGuard } from '../../auth/guards/jwt.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { TranslationLexiconService } from '../translation-lexicon.service';
import { TranslationMetricsService } from '../translation-metrics.service';
import { TranslationSettingsService } from '../translation-settings.service';
import { TranslationReportService } from '../report/translation-report.service';
import type {
  CreateLexiconBody,
  ImportLexiconCsvBody,
  LexiconFromPackBody,
  LexiconTermInput,
  MetricsQuery,
  UpdateLexiconBody,
  UpdateTranslationSettingsBody,
} from '../dto/translation.dto';
import { termsOf } from './translation.controller';

interface JwtRequest {
  user: { userId: string };
}

/**
 * Dashboard mirrors of the developer API (translation/PROTOCOL.md §1):
 * same handlers, JWT auth, and the signed-in user must own the project.
 */
@UseGuards(JwtGuard)
@Controller('dashboard/translation')
export class TranslationDashboardController {
  constructor(
    private prisma: PrismaService,
    private settings: TranslationSettingsService,
    private lexicons: TranslationLexiconService,
    private metricsService: TranslationMetricsService,
    private reports: TranslationReportService,
  ) {}

  private async own(req: JwtRequest, projectId: string) {
    await this.settings.assertOwner(projectId, req.user.userId);
    return projectId;
  }

  @Get('usage')
  async usage(
    @Req() req: JwtRequest,
    @Query() q: { from?: string; to?: string; projectId?: string },
  ) {
    if (q.projectId) await this.own(req, q.projectId);
    return this.metricsService.usageBreakdown(req.user.userId, q);
  }

  @Get('calls/:callId/report')
  async report(@Req() req: JwtRequest, @Param('callId') callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: { projectId: true, project: { select: { ownerId: true } } },
    });
    if (!call)
      throw new NotFoundException({
        statusCode: 404,
        code: 'TRANSLATION_REPORT_NOT_FOUND',
        message: 'No translation report for this call.',
      });
    if (call.project.ownerId !== req.user.userId)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'TRANSLATION_FORBIDDEN',
        message: 'You do not own this call',
      });
    return this.reports.getReport(callId, call.projectId);
  }

  @Get('projects/:projectId/settings')
  async getSettings(@Req() req: JwtRequest, @Param('projectId') projectId: string) {
    return this.settings.getPublic(await this.own(req, projectId));
  }

  @Patch('projects/:projectId/settings')
  async updateSettings(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Body() body: UpdateTranslationSettingsBody,
  ) {
    return this.settings.update(await this.own(req, projectId), body);
  }

  @Get('projects/:projectId/lexicons/packs')
  async packs(@Req() req: JwtRequest, @Param('projectId') projectId: string) {
    await this.own(req, projectId);
    return this.lexicons.packs();
  }

  @Post('projects/:projectId/lexicons/from-pack')
  async fromPack(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Body() body: LexiconFromPackBody,
  ) {
    return this.lexicons.fromPack(await this.own(req, projectId), body);
  }

  @Get('projects/:projectId/lexicons')
  async listLexicons(@Req() req: JwtRequest, @Param('projectId') projectId: string) {
    return this.lexicons.list(await this.own(req, projectId));
  }

  @Post('projects/:projectId/lexicons')
  async createLexicon(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Body() body: CreateLexiconBody,
  ) {
    return this.lexicons.create(await this.own(req, projectId), body);
  }

  @Get('projects/:projectId/lexicons/:id')
  async getLexicon(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.lexicons.get(await this.own(req, projectId), id);
  }

  @Patch('projects/:projectId/lexicons/:id')
  async updateLexicon(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: UpdateLexiconBody,
  ) {
    return this.lexicons.update(await this.own(req, projectId), id, body);
  }

  @Delete('projects/:projectId/lexicons/:id')
  async deleteLexicon(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.lexicons.remove(await this.own(req, projectId), id);
  }

  @Put('projects/:projectId/lexicons/:id/terms')
  async putTerms(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: LexiconTermInput[] | { terms: LexiconTermInput[] },
  ) {
    return this.lexicons.upsertTerms(await this.own(req, projectId), id, termsOf(body));
  }

  @Delete('projects/:projectId/lexicons/:id/terms/:termId')
  async deleteTerm(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('termId') termId: string,
  ) {
    return this.lexicons.deleteTerm(await this.own(req, projectId), id, termId);
  }

  @Post('projects/:projectId/lexicons/:id/import')
  async importCsv(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: ImportLexiconCsvBody,
  ) {
    return this.lexicons.importCsv(await this.own(req, projectId), id, body?.csv);
  }

  @Get('projects/:projectId/metrics')
  async metrics(
    @Req() req: JwtRequest,
    @Param('projectId') projectId: string,
    @Query() q: MetricsQuery,
  ) {
    return this.metricsService.metrics(await this.own(req, projectId), q);
  }
}
