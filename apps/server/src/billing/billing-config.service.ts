import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingConfig, Prisma, TopUpExpiryPolicy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
    | 'taxPercent'
    | 'lowCreditThresholds'
    | 'minimumCreditsToStartCall'
    | 'topUpExpiryPolicy'
    | 'topUpExpiryDays'
    | 'renewalReminderDays'
    | 'pendingCheckoutTtlHours'
    | 'autoRenewDefault'
    | 'autoRenewGraceHours'
  >
>;

const INT_FIELDS = [
  'audioCreditsPerMinute',
  'videoCreditsPerMinute',
  'screenShareCreditsPerMinute',
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
  constructor(
    private prisma: PrismaService,
    private audit: BillingAuditService,
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
    return updated;
  }
}

function pickChanged(row: BillingConfig, input: BillingConfigUpdate) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input))
    out[key] = (row as Record<string, unknown>)[key];
  return out;
}
