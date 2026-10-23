import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, TranslationRateOverride } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { BillingConfigService } from '../billing/billing-config.service';
import { BillingAuditService } from '../billing/billing-audit.service';
import {
  DEFAULT_FEATURES,
  FeatureKey,
} from '../billing/plans/feature-registry';
import { creditValuePaise, round2 } from './translation-estimate.service';

const badRequest = (message: string) =>
  new BadRequestException({ statusCode: 400, code: 'TRANSLATION_INVALID_REQUEST', message });

export interface RateOverrideInput {
  voiceCreditsPerMinute?: number | null;
  captionsCreditsPerMinute?: number | null;
  postCallReportCredits?: number | null;
  note?: string | null;
}

interface MarginBucket {
  sessions: number;
  minutes: number;
  revenueCredits: number;
  providerCostPaise: number;
}

/**
 * Admin side of Live Translate: per-customer rate overrides and the gross
 * margin report (the only place provider cost is ever returned).
 */
@Injectable()
export class TranslationAdminService implements OnModuleInit {
  private readonly logger = new Logger(TranslationAdminService.name);

  constructor(
    private prisma: PrismaService,
    private billingConfig: BillingConfigService,
    private audit: BillingAuditService,
  ) {}

  /**
   * DEFAULT_FEATURES is only seeded into an empty Feature table, so existing
   * databases get the TRANSLATION registry row here (never added to plans
   * automatically — admins choose which plans include it).
   */
  async onModuleInit() {
    const row = DEFAULT_FEATURES.find((f) => f.key === FeatureKey.TRANSLATION);
    if (!row) return;
    try {
      const count = await this.prisma.feature.count();
      await this.prisma.feature.upsert({
        where: { key: row.key },
        create: { ...row, displayOrder: count },
        update: {},
      });
    } catch (err) {
      this.logger.warn(`Could not register the TRANSLATION feature: ${String(err)}`);
    }
  }

  async listOverrides() {
    const rows = await this.prisma.translationRateOverride.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { user: { select: { id: true, email: true, name: true, companyName: true } } },
      take: 500,
    });
    return rows.map((r) => ({
      userId: r.userId,
      voiceCreditsPerMinute: r.voiceCreditsPerMinute,
      captionsCreditsPerMinute: r.captionsCreditsPerMinute,
      postCallReportCredits: r.postCallReportCredits,
      note: r.note,
      updatedAt: r.updatedAt,
      updatedById: r.updatedById,
      user: { email: r.user.email, name: r.user.name, companyName: r.user.companyName },
    }));
  }

  async getOverride(userId: string) {
    const row = await this.prisma.translationRateOverride.findUnique({
      where: { userId },
    });
    if (!row) throw new NotFoundException({ statusCode: 404, code: 'TRANSLATION_NOT_FOUND', message: 'No translation rate override for this customer' });
    return row;
  }

  async putOverride(userId: string, input: RateOverrideInput, actorId: string) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw badRequest('Body must be an object.');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException({ statusCode: 404, code: 'TRANSLATION_NOT_FOUND', message: 'Customer not found' });

    const data: Record<string, number | string | null> = {};
    for (const f of [
      'voiceCreditsPerMinute',
      'captionsCreditsPerMinute',
      'postCallReportCredits',
    ] as const) {
      const v = input[f];
      if (v === undefined) continue;
      const min = f === 'postCallReportCredits' ? 0 : 1;
      if (v !== null && (!Number.isInteger(v) || v < min))
        throw badRequest(
          `${f} must be a whole number of at least ${min}, or null for the standard rate.`,
        );
      data[f] = v;
    }
    if (input.note !== undefined) {
      if (input.note !== null && (typeof input.note !== 'string' || input.note.length > 500))
        throw badRequest('note must be at most 500 characters.');
      data.note = input.note?.trim() || null;
    }

    const before = await this.prisma.translationRateOverride.findUnique({
      where: { userId },
    });
    const saved = await this.prisma.translationRateOverride.upsert({
      where: { userId },
      create: { userId, ...data, updatedById: actorId },
      update: { ...data, updatedById: actorId },
    });
    await this.audit.log({
      action: 'BILLING_CONFIG_UPDATED',
      actorId,
      entity: 'TranslationRateOverride',
      entityId: saved.id,
      oldValue: before ? pickRates(before) : null,
      newValue: pickRates(saved),
      extra: { userId },
    });
    return saved;
  }

  async deleteOverride(userId: string, actorId: string) {
    const before = await this.prisma.translationRateOverride.findUnique({
      where: { userId },
    });
    if (!before) throw new NotFoundException({ statusCode: 404, code: 'TRANSLATION_NOT_FOUND', message: 'No translation rate override for this customer' });
    await this.prisma.translationRateOverride.delete({ where: { userId } });
    await this.audit.log({
      action: 'BILLING_CONFIG_UPDATED',
      actorId,
      entity: 'TranslationRateOverride',
      entityId: before.id,
      oldValue: pickRates(before),
      newValue: null,
      extra: { userId, deleted: true },
    });
    return { deleted: true };
  }

  /**
   * Gross margin by route and by language pair for sessions billed in the
   * window. Revenue ₹ uses the same credit value as the AI report.
   */
  async margin(from: Date, to: Date) {
    const [sessions, reports, config, value] = await Promise.all([
      this.prisma.translationSession.findMany({
        where: { usageRecordedAt: { gte: from, lt: to } },
        select: {
          route: true,
          sourceLanguage: true,
          targetLanguage: true,
          voiceSeconds: true,
          captionsSeconds: true,
          creditsCharged: true,
          providerCostPaise: true,
        },
        take: 200_000,
      }),
      this.prisma.translationReport.aggregate({
        where: { createdAt: { gte: from, lt: to }, status: 'READY' },
        _sum: { creditsCharged: true },
        _count: true,
      }),
      this.billingConfig.get(),
      creditValuePaise(this.prisma),
    ]);
    const warnBelow = config.translationMarginWarnPercent;
    const byRoute = new Map<string, MarginBucket>();
    const byPair = new Map<string, MarginBucket>();
    const total: MarginBucket = { sessions: 0, minutes: 0, revenueCredits: 0, providerCostPaise: 0 };
    const add = (map: Map<string, MarginBucket>, key: string, s: (typeof sessions)[number]) => {
      const b = map.get(key) ?? { sessions: 0, minutes: 0, revenueCredits: 0, providerCostPaise: 0 };
      b.sessions++;
      b.minutes += (s.voiceSeconds + s.captionsSeconds) / 60;
      b.revenueCredits += s.creditsCharged;
      b.providerCostPaise += s.providerCostPaise;
      map.set(key, b);
    };
    for (const s of sessions) {
      add(byRoute, s.route, s);
      add(byPair, `${s.sourceLanguage}-${s.targetLanguage}|${s.route}`, s);
      total.sessions++;
      total.minutes += (s.voiceSeconds + s.captionsSeconds) / 60;
      total.revenueCredits += s.creditsCharged;
      total.providerCostPaise += s.providerCostPaise;
    }
    const present = (b: MarginBucket) => {
      const revenuePaise =
        value.paise == null ? null : Math.round(b.revenueCredits * value.paise);
      const marginPaise = revenuePaise == null ? null : revenuePaise - b.providerCostPaise;
      const marginPercent =
        revenuePaise && marginPaise != null ? round2((marginPaise / revenuePaise) * 100) : null;
      return {
        sessions: b.sessions,
        minutes: round2(b.minutes),
        revenueCredits: b.revenueCredits,
        revenueInr: revenuePaise == null ? null : round2(revenuePaise / 100),
        providerCostInr: round2(b.providerCostPaise / 100),
        marginInr: marginPaise == null ? null : round2(marginPaise / 100),
        marginPercent,
        warn:
          (marginPercent != null && marginPercent < warnBelow) ||
          (revenuePaise === 0 && b.providerCostPaise > 0),
      };
    };
    const reportCredits = reports._sum.creditsCharged ?? 0;
    return {
      from,
      to,
      currency: 'INR',
      creditValuePaise: value.paise,
      creditValueSource: value.source,
      warnPercent: warnBelow,
      providerCostsPaisePerMinute: config.translationProviderCostsPaise,
      total: present(total),
      byRoute: [...byRoute.entries()]
        .map(([route, b]) => ({ route, ...present(b) }))
        .sort((a, b) => b.minutes - a.minutes),
      byPair: [...byPair.entries()]
        .map(([key, b]) => {
          const [pair, route] = key.split('|');
          return { pair, route, ...present(b) };
        })
        .sort((a, b) => b.minutes - a.minutes),
      reports: {
        count: reports._count,
        revenueCredits: reportCredits,
        revenueInr: value.paise == null ? null : round2((reportCredits * value.paise) / 100),
      },
    };
  }
}

function pickRates(row: TranslationRateOverride): Prisma.JsonObject {
  return {
    voiceCreditsPerMinute: row.voiceCreditsPerMinute,
    captionsCreditsPerMinute: row.captionsCreditsPerMinute,
    postCallReportCredits: row.postCallReportCredits,
    note: row.note,
  };
}
