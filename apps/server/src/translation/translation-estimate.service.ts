import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingConfig, TranslationRateOverride } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { BillingConfigService } from '../billing/billing-config.service';
import { creditValuePaise } from '../billing/credit-value';
import { TranslationModeName } from './translation-config';

const badRequest = (message: string) =>
  new BadRequestException({ statusCode: 400, code: 'TRANSLATION_INVALID_REQUEST', message });

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export interface EffectiveTranslationRates {
  voiceRate: number;
  captionsRate: number;
  reportCredits: number;
  overridden: boolean;
}

/** Admin config + optional per-customer override (override wins field by field). */
export function effectiveRates(
  config: BillingConfig,
  override?: Pick<
    TranslationRateOverride,
    'voiceCreditsPerMinute' | 'captionsCreditsPerMinute' | 'postCallReportCredits'
  > | null,
): EffectiveTranslationRates {
  return {
    voiceRate:
      override?.voiceCreditsPerMinute ?? config.translationVoiceCreditsPerMinute,
    captionsRate:
      override?.captionsCreditsPerMinute ??
      config.translationCaptionsCreditsPerMinute,
    reportCredits:
      override?.postCallReportCredits ?? config.postCallReportCredits,
    overridden: !!(
      override &&
      (override.voiceCreditsPerMinute != null ||
        override.captionsCreditsPerMinute != null ||
        override.postCallReportCredits != null)
    ),
  };
}

function positiveNumber(
  raw: string | undefined,
  name: string,
  fallback: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v > max)
    throw badRequest(`${name} must be a number between 0 and ${max}.`);
  return v;
}

/**
 * Public price calculator (GET /translation/estimate). Billing is per
 * listener: each person who has translation on is one direction at the
 * per-minute rate, so `listeners` is 1 (one side) or 2 (both sides).
 * Rounded up once per call, like billing.
 */
@Injectable()
export class TranslationEstimateService {
  constructor(
    private prisma: PrismaService,
    private billingConfig: BillingConfigService,
  ) {}

  async ratesFor(userId?: string | null): Promise<EffectiveTranslationRates> {
    const [config, override] = await Promise.all([
      this.billingConfig.get(),
      userId
        ? this.prisma.translationRateOverride.findUnique({ where: { userId } })
        : Promise.resolve(null),
    ]);
    return effectiveRates(config, override);
  }

  async estimate(
    query: { mode?: string; minutes?: string; calls?: string; listeners?: string },
    userId?: string | null,
  ) {
    const mode = (query.mode ?? 'voice') as TranslationModeName;
    if (mode !== 'voice' && mode !== 'captions')
      throw badRequest('mode must be voice or captions.');
    const minutes = positiveNumber(query.minutes, 'minutes', 10, 600);
    const calls = Math.ceil(positiveNumber(query.calls, 'calls', 1, 1_000_000));
    const listeners = query.listeners === undefined || query.listeners === '' ? 2 : Number(query.listeners);
    if (listeners !== 1 && listeners !== 2)
      throw badRequest('listeners must be 1 or 2.');
    const [rates, value] = await Promise.all([
      this.ratesFor(userId),
      creditValuePaise(this.prisma),
    ]);
    const ratePerMinute = mode === 'voice' ? rates.voiceRate : rates.captionsRate;
    const creditsPerCall = Math.ceil(ratePerMinute * minutes * listeners - 1e-6);
    const totalCredits = creditsPerCall * calls;
    const inr = (credits: number) =>
      value.paise == null ? null : round2((credits * value.paise) / 100);
    return {
      mode,
      ratePerMinute,
      approxInrPerMinute: inr(ratePerMinute),
      listeners,
      /** @deprecated same as listeners. */
      directions: listeners,
      minutes,
      calls,
      creditsPerCall,
      totalCredits,
      approxInrPerCall: inr(creditsPerCall),
      approxInrTotal: inr(totalCredits),
      creditValuePaise: value.paise,
      personalized: rates.overridden,
      note:
        'Billed per translated listener-minute: one person translating is 1× the rate, both is 2×. ' +
        'Call minutes are billed separately. Rates are locked when translation starts. ' +
        (value.paise == null
          ? '₹ unavailable.'
          : '₹ at the published credit price, before GST.'),
    };
  }
}
