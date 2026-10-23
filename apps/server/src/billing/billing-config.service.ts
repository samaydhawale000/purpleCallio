import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  BillingConfig,
  NotificationType,
  Prisma,
  TopUpExpiryPolicy,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BillingAuditService } from './billing-audit.service';

export interface MediaMinutes {
  audioMinutes: number;
  videoMinutes: number;
  screenShareMinutes: number;
}

export interface MediaCredits {
  audioCredits: number;
  videoCredits: number;
  screenShareCredits: number;
  totalCredits: number;
}

export type BillingConfigUpdate = Partial<
  Pick<
    BillingConfig,
    | 'audioCreditsPerMinute'
    | 'videoCreditsPerMinute'
    | 'screenShareCreditsPerMinute'
    | 'aiCreditsPerMinute'
    | 'taxPercent'
    | 'lowCreditThresholds'
    | 'minimumCreditsToStartCall'
    | 'topUpExpiryPolicy'
    | 'topUpExpiryDays'
    | 'renewalReminderDays'
    | 'pendingCheckoutTtlHours'
    | 'autoRenewDefault'
    | 'autoRenewGraceHours'
    // Live Translate (translation/PROTOCOL.md §4)
    | 'translationVoiceCreditsPerMinute'
    | 'translationCaptionsCreditsPerMinute'
    | 'translationIndicVoiceCreditsPerMinute'
    | 'translationMinimumCredits'
    | 'translationTrialMinutes'
    | 'postCallReportCredits'
    | 'translationProviderCostsPaise'
    | 'translationMarginWarnPercent'
    | 'translationDefaultMaxMinutes'
    | 'translationMaxBudgetCredits'
  >
>;

/** Translation fields that are whole numbers with a lower bound (and optional upper bound). */
const TRANSLATION_INT_FIELDS: {
  field: keyof BillingConfigUpdate;
  min: number;
  max?: number;
  nullable?: boolean;
}[] = [
  { field: 'translationVoiceCreditsPerMinute', min: 1 },
  { field: 'translationCaptionsCreditsPerMinute', min: 1 },
  { field: 'translationIndicVoiceCreditsPerMinute', min: 1, nullable: true },
  { field: 'translationMinimumCredits', min: 0, nullable: true },
  { field: 'translationTrialMinutes', min: 0 },
  { field: 'postCallReportCredits', min: 0 },
  { field: 'translationMarginWarnPercent', min: 0, max: 100 },
  { field: 'translationDefaultMaxMinutes', min: 1, max: 600 },
  { field: 'translationMaxBudgetCredits', min: 1 },
];

/** Customer-facing translation prices: a change notifies recent translation users. */
export const TRANSLATION_RATE_FIELDS = [
  'translationVoiceCreditsPerMinute',
  'translationCaptionsCreditsPerMinute',
  'translationIndicVoiceCreditsPerMinute',
  'postCallReportCredits',
] as const;

const PROVIDER_COST_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const INT_FIELDS = [
  'audioCreditsPerMinute',
  'videoCreditsPerMinute',
  'screenShareCreditsPerMinute',
  'aiCreditsPerMinute',
  'taxPercent',
  'minimumCreditsToStartCall',
  'renewalReminderDays',
  'pendingCheckoutTtlHours',
  'autoRenewGraceHours',
] as const;

/** Whole credits for fractional usage, rounding up (tolerant of float noise). */
export function toCredits(minutes: number, creditsPerMinute: number): number {
  const raw = minutes * creditsPerMinute;
  if (!(raw > 0)) return 0;
  return Math.ceil(raw - 1e-6);
}

/**
 * Admin-editable billing configuration (singleton row "default"): credit
 * conversion rates per participant-minute, tax, low-credit thresholds and
 * top-up expiry policy. The only place usage minutes become credits.
 */
@Injectable()
export class BillingConfigService {
  private readonly logger = new Logger(BillingConfigService.name);

  constructor(
    private prisma: PrismaService,
    private audit: BillingAuditService,
    @Optional() private notifications?: NotificationService,
  ) {}

  async get(
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<BillingConfig> {
    const existing = await client.billingConfig.findUnique({
      where: { key: 'default' },
    });
    if (existing) return existing;
    return client.billingConfig.upsert({
      where: { key: 'default' },
      create: { key: 'default' },
      update: {},
    });
  }

  /**
   * Participant-minutes → credits. Each media type rounds up to whole
   * credits independently, so the customer-facing breakdown always sums to
   * the total actually debited.
   */
  creditsFor(minutes: MediaMinutes, config: BillingConfig): MediaCredits {
    const audioCredits = toCredits(
      minutes.audioMinutes,
      config.audioCreditsPerMinute,
    );
    const videoCredits = toCredits(
      minutes.videoMinutes,
      config.videoCreditsPerMinute,
    );
    const screenShareCredits = toCredits(
      minutes.screenShareMinutes,
      config.screenShareCreditsPerMinute,
    );
    return {
      audioCredits,
      videoCredits,
      screenShareCredits,
      totalCredits: audioCredits + videoCredits + screenShareCredits,
    };
  }

  async update(input: BillingConfigUpdate, actorId: string) {
    const current = await this.get();
    const data: Prisma.BillingConfigUpdateInput = {};

    for (const field of INT_FIELDS) {
      const value = input[field];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value < 0) {
        throw new BadRequestException(
          `${field} must be a non-negative whole number.`,
        );
      }
      (data as Record<string, unknown>)[field] = value;
    }
    if (input.taxPercent !== undefined && input.taxPercent > 100) {
      throw new BadRequestException('taxPercent must be between 0 and 100.');
    }
    // AI calls have a real provider cost, and the per-session balance cap
    // divides by this rate.
    if (
      input.aiCreditsPerMinute !== undefined &&
      input.aiCreditsPerMinute < 1
    ) {
      throw new BadRequestException('aiCreditsPerMinute must be at least 1.');
    }
    if (
      input.pendingCheckoutTtlHours !== undefined &&
      input.pendingCheckoutTtlHours < 1
    ) {
      throw new BadRequestException(
        'pendingCheckoutTtlHours must be at least 1.',
      );
    }
    if (input.autoRenewDefault !== undefined) {
      if (typeof input.autoRenewDefault !== 'boolean') {
        throw new BadRequestException(
          'autoRenewDefault must be true or false.',
        );
      }
      data.autoRenewDefault = input.autoRenewDefault;
    }
    if (input.lowCreditThresholds !== undefined) {
      const t = input.lowCreditThresholds;
      if (
        !Array.isArray(t) ||
        t.some((v) => !Number.isInteger(v) || v < 1 || v > 100)
      ) {
        throw new BadRequestException(
          'lowCreditThresholds must be whole percentages between 1 and 100.',
        );
      }
      data.lowCreditThresholds = Array.from(new Set(t)).sort((a, b) => a - b);
    }
    if (input.topUpExpiryPolicy !== undefined) {
      if (!Object.values(TopUpExpiryPolicy).includes(input.topUpExpiryPolicy)) {
        throw new BadRequestException('Invalid topUpExpiryPolicy.');
      }
      data.topUpExpiryPolicy = input.topUpExpiryPolicy;
    }
    if (input.topUpExpiryDays !== undefined) {
      if (
        input.topUpExpiryDays !== null &&
        (!Number.isInteger(input.topUpExpiryDays) || input.topUpExpiryDays < 1)
      ) {
        throw new BadRequestException(
          'topUpExpiryDays must be a whole number of days (at least 1).',
        );
      }
      data.topUpExpiryDays = input.topUpExpiryDays;
    }
    for (const { field, min, max, nullable } of TRANSLATION_INT_FIELDS) {
      const value = input[field] as unknown;
      if (value === undefined) continue;
      if (value === null) {
        if (!nullable)
          throw new BadRequestException(`${field} cannot be empty.`);
        (data as Record<string, unknown>)[field] = null;
        continue;
      }
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < min ||
        (max !== undefined && value > max)
      ) {
        throw new BadRequestException(
          max !== undefined
            ? `${field} must be a whole number between ${min} and ${max}.`
            : `${field} must be a whole number of at least ${min}.`,
        );
      }
      (data as Record<string, unknown>)[field] = value;
    }
    if (input.translationProviderCostsPaise !== undefined) {
      const costs = input.translationProviderCostsPaise as unknown;
      if (
        typeof costs !== 'object' ||
        costs === null ||
        Array.isArray(costs) ||
        Object.entries(costs).some(
          ([k, v]) =>
            !PROVIDER_COST_KEY.test(k) ||
            typeof v !== 'number' ||
            !Number.isInteger(v) ||
            v < 0,
        )
      ) {
        throw new BadRequestException(
          'translationProviderCostsPaise must map route ids to non-negative whole paise per minute.',
        );
      }
      data.translationProviderCostsPaise = costs as Prisma.InputJsonValue;
    }
    const policy = input.topUpExpiryPolicy ?? current.topUpExpiryPolicy;
    const days =
      input.topUpExpiryDays !== undefined
        ? input.topUpExpiryDays
        : current.topUpExpiryDays;
    if (policy === 'DAYS' && !days) {
      throw new BadRequestException(
        'Set topUpExpiryDays when top-ups expire after N days.',
      );
    }

    const updated = await this.prisma.billingConfig.update({
      where: { key: 'default' },
      data: { ...data, updatedById: actorId },
    });
    await this.audit.log({
      action: 'BILLING_CONFIG_UPDATED',
      actorId,
      entity: 'BillingConfig',
      entityId: updated.id,
      oldValue: pickChanged(current, input),
      newValue: pickChanged(updated, input),
    });
    const ratesChanged = TRANSLATION_RATE_FIELDS.some(
      (f) => input[f] !== undefined && current[f] !== updated[f],
    );
    if (ratesChanged) {
      // Fire-and-forget: notifying customers must never fail the admin edit.
      void this.notifyTranslationRateChange(current, updated).catch((err) =>
        this.logger.warn(
          `Translation rate change notification failed: ${String(err)}`,
        ),
      );
    }
    return updated;
  }

  /**
   * Tells every customer who used Live Translate in the last 30 days that
   * the translation price changed. New rates apply to NEW translation
   * sessions only: each TranslationSession locks voiceRate/captionsRate at
   * its start, so a call in progress keeps the price it started with.
   * Customers with a TranslationRateOverride for a changed field are still
   * notified (their override keeps applying; the message says so).
   */
  async notifyTranslationRateChange(
    before: BillingConfig,
    after: BillingConfig,
  ): Promise<number> {
    if (!this.notifications) return 0;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const owners = await this.prisma.translationSession.findMany({
      where: { startedAt: { gte: since } },
      distinct: ['ownerId'],
      select: { ownerId: true },
    });
    if (!owners.length) return 0;
    const parts: string[] = [];
    const describe = (label: string, a: number | null, b: number | null) => {
      if (a !== b)
        parts.push(`${label}: ${a ?? 'standard'} → ${b ?? 'standard'} credits`);
    };
    describe(
      'Voice translation per minute',
      before.translationVoiceCreditsPerMinute,
      after.translationVoiceCreditsPerMinute,
    );
    describe(
      'Captions per minute',
      before.translationCaptionsCreditsPerMinute,
      after.translationCaptionsCreditsPerMinute,
    );
    describe(
      'Indian-language voice per minute',
      before.translationIndicVoiceCreditsPerMinute,
      after.translationIndicVoiceCreditsPerMinute,
    );
    describe(
      'Post-call report',
      before.postCallReportCredits,
      after.postCallReportCredits,
    );
    const message =
      `${parts.join('; ')}. New prices apply to translation sessions started from now on; ` +
      'sessions already in progress keep their price. Custom prices agreed with you are unchanged.';
    const stamp = after.updatedAt?.getTime?.() ?? Date.now();
    await Promise.all(
      owners.map(({ ownerId }) =>
        this.notifications!.createNotification({
          userId: ownerId,
          type: NotificationType.TRANSLATION_RATE_CHANGED,
          title: 'Live Translate pricing updated',
          message,
          dedupeKey: `translation-rate:${stamp}`,
        }),
      ),
    );
    return owners.length;
  }
}

function pickChanged(row: BillingConfig, input: BillingConfigUpdate) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input))
    out[key] = (row as Record<string, unknown>)[key];
  return out;
}
