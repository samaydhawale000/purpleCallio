import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TranslationSettings } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { BillingConfigService } from '../billing/billing-config.service';
import { TRANSCRIPT_RETENTION_DAYS } from '../ai/dto/validators';
import { MAX_CALL_MINUTES, ON_LIMIT_ACTIONS } from './translation-config';

const badRequest = (message: string) =>
  new BadRequestException({ statusCode: 400, code: 'TRANSLATION_INVALID_SETTINGS', message });

export type TranslationSettingsUpdate = Partial<
  Pick<
    TranslationSettings,
    | 'replayEnabled'
    | 'postCallReportEnabled'
    | 'sentimentEnabled'
    | 'transcriptRetentionDays'
    | 'industry'
    | 'defaultLexiconId'
    | 'defaultMaxMinutes'
    | 'dailyBudgetCredits'
    | 'monthlyBudgetCredits'
    | 'alertThresholds'
    | 'onLimit'
  >
>;

const BOOL_FIELDS = [
  'replayEnabled',
  'postCallReportEnabled',
  'sentimentEnabled',
] as const;

const INDUSTRY_SLUG = /^[a-z][a-z0-9_-]{0,39}$/;

/** Public (customer-visible) shape of the settings row. */
export function presentSettings(s: TranslationSettings) {
  return {
    projectId: s.projectId,
    replayEnabled: s.replayEnabled,
    postCallReportEnabled: s.postCallReportEnabled,
    sentimentEnabled: s.sentimentEnabled,
    transcriptRetentionDays: s.transcriptRetentionDays,
    industry: s.industry,
    defaultLexiconId: s.defaultLexiconId,
    defaultMaxMinutes: s.defaultMaxMinutes,
    dailyBudgetCredits: s.dailyBudgetCredits,
    monthlyBudgetCredits: s.monthlyBudgetCredits,
    alertThresholds: s.alertThresholds,
    onLimit: s.onLimit,
    updatedAt: s.updatedAt,
  };
}

/**
 * Per-project Live Translate settings (1:1 row, created lazily with the
 * schema defaults). See translation/PROTOCOL.md §1.
 */
@Injectable()
export class TranslationSettingsService {
  constructor(
    private prisma: PrismaService,
    private billingConfig: BillingConfigService,
  ) {}

  /** Throws 403 unless `ownerId` owns the project. */
  async assertOwner(projectId: string, ownerId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true },
    });
    if (!project) throw new NotFoundException({ statusCode: 404, code: 'TRANSLATION_NOT_FOUND', message: 'Project not found' });
    if (project.ownerId !== ownerId)
      throw new ForbiddenException({ statusCode: 403, code: 'TRANSLATION_FORBIDDEN', message: 'You do not own this project' });
    return project;
  }

  async get(projectId: string): Promise<TranslationSettings> {
    const existing = await this.prisma.translationSettings.findUnique({
      where: { projectId },
    });
    if (existing) return existing;
    return this.prisma.translationSettings.upsert({
      where: { projectId },
      create: { projectId },
      update: {},
    });
  }

  async getPublic(projectId: string) {
    return presentSettings(await this.get(projectId));
  }

  async update(projectId: string, input: TranslationSettingsUpdate) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw badRequest('Body must be an object.');
    await this.get(projectId);
    const config = await this.billingConfig.get();
    const data: Prisma.TranslationSettingsUpdateInput = {};

    for (const f of BOOL_FIELDS) {
      const v = input[f];
      if (v === undefined) continue;
      if (typeof v !== 'boolean')
        throw badRequest(`${f} must be true or false.`);
      data[f] = v;
    }

    if (input.transcriptRetentionDays !== undefined) {
      if (!TRANSCRIPT_RETENTION_DAYS.includes(input.transcriptRetentionDays))
        throw badRequest(
          `transcriptRetentionDays must be one of ${TRANSCRIPT_RETENTION_DAYS.join(', ')}.`,
        );
      data.transcriptRetentionDays = input.transcriptRetentionDays;
    }

    if (input.industry !== undefined) {
      if (input.industry === null || input.industry === '') {
        data.industry = null;
      } else if (
        typeof input.industry !== 'string' ||
        !INDUSTRY_SLUG.test(input.industry.trim().toLowerCase())
      ) {
        throw badRequest(
          'industry must be a short lowercase name (e.g. healthcare).',
        );
      } else {
        data.industry = input.industry.trim().toLowerCase();
      }
    }

    if (input.defaultLexiconId !== undefined) {
      if (input.defaultLexiconId === null || input.defaultLexiconId === '') {
        data.defaultLexiconId = null;
      } else {
        const lexicon =
          typeof input.defaultLexiconId === 'string' &&
          /^[0-9a-f-]{36}$/i.test(input.defaultLexiconId)
            ? await this.prisma.translationLexicon.findFirst({
                where: { id: input.defaultLexiconId, projectId },
                select: { id: true },
              })
            : null;
        if (!lexicon)
          throw new BadRequestException({
            statusCode: 400,
            code: 'TRANSLATION_LEXICON_NOT_FOUND',
            message: 'defaultLexiconId does not refer to a lexicon of this project.',
          });
        data.defaultLexiconId = lexicon.id;
      }
    }

    if (input.defaultMaxMinutes !== undefined) {
      const v = input.defaultMaxMinutes;
      if (
        v !== null &&
        (!Number.isInteger(v) || v < 1 || v > MAX_CALL_MINUTES)
      )
        throw badRequest(
          `defaultMaxMinutes must be a whole number between 1 and ${MAX_CALL_MINUTES}.`,
        );
      data.defaultMaxMinutes = v;
    }

    // Budgets are clamped to the admin-set ceiling (not rejected).
    for (const f of ['dailyBudgetCredits', 'monthlyBudgetCredits'] as const) {
      const v = input[f];
      if (v === undefined) continue;
      if (v !== null && (!Number.isInteger(v) || v < 1))
        throw badRequest(
          `${f} must be a whole number of credits (at least 1), or null for no budget.`,
        );
      data[f] =
        v === null ? null : Math.min(v, config.translationMaxBudgetCredits);
    }

    if (input.alertThresholds !== undefined) {
      const t = input.alertThresholds;
      if (
        !Array.isArray(t) ||
        t.length > 10 ||
        t.some((v) => !Number.isInteger(v) || v < 1 || v > 100)
      )
        throw badRequest(
          'alertThresholds must be up to 10 whole percentages between 1 and 100.',
        );
      data.alertThresholds = Array.from(new Set(t)).sort((a, b) => a - b);
    }

    if (input.onLimit !== undefined) {
      if (!ON_LIMIT_ACTIONS.includes(input.onLimit as never))
        throw badRequest(
          `onLimit must be one of ${ON_LIMIT_ACTIONS.join(', ')}.`,
        );
      data.onLimit = input.onLimit;
    }

    const updated = await this.prisma.translationSettings.update({
      where: { projectId },
      data,
    });
    return presentSettings(updated);
  }
}
