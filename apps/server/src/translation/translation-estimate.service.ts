import { BadRequestException, Injectable } from '@nestjs/common';
import { BillingConfig, TranslationRateOverride } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { BillingConfigService } from '../billing/billing-config.service';
import { TranslationModeName } from './translation-config';
import { isIndic } from './languages';
import { parsePairLoose } from './translation-pair';

const badRequest = (message: string) =>
  new BadRequestException({ statusCode: 400, code: 'TRANSLATION_INVALID_REQUEST', message });

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Rupee value of one credit, the same way AiBillingService.adminSummary
 * derives it: AI_CREDIT_VALUE_PAISE, else the cheapest active top-up.
 */
export async function creditValuePaise(
  prisma: PrismaService,
): Promise<{ paise: number | null; source: 'env' | 'topup' | 'none' }> {
  const raw = process.env.AI_CREDIT_VALUE_PAISE;
  const fromEnv = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return { paise: fromEnv, source: 'env' };
  }
  const topUps = await prisma.topUpPackage.findMany({
    where: { status: 'ACTIVE', credits: { gt: 0 } },
    select: { pricePaise: true, credits: true },
  });
  if (!topUps.length) return { paise: null, source: 'none' };
  const lowest = Math.min(...topUps.map((t) => t.pricePaise / t.credits));
  return { paise: round2(lowest), source: 'topup' };
}

export interface EffectiveTranslationRates {
  voiceRate: number;
  /** Voice rate for Indian-language pairs (falls back to voiceRate). */
  indicVoiceRate: number;
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
  const voiceOverride = override?.voiceCreditsPerMinute ?? null;
  const voiceRate = voiceOverride ?? config.translationVoiceCreditsPerMinute;
  return {
    voiceRate,
    // A customer voice override applies to every route (incl. Indic).
    indicVoiceRate:
      voiceOverride ??
      config.translationIndicVoiceCreditsPerMinute ??
      config.translationVoiceCreditsPerMinute,
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
 * Public price calculator (GET /translation/estimate). Two translated
 * directions per 1:1 call, so a call-minute costs 2 × the per-listener
 * rate. Rounded up once per call, like billing.
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
    query: { mode?: string; minutes?: string; calls?: string; pair?: string },
    userId?: string | null,
  ) {
    const mode = (query.mode ?? 'voice') as TranslationModeName;
    if (mode !== 'voice' && mode !== 'captions')
      throw badRequest('mode must be voice or captions.');
    const minutes = positiveNumber(query.minutes, 'minutes', 10, 600);
    const calls = Math.ceil(positiveNumber(query.calls, 'calls', 1, 1_000_000));
    // pair: "hi-mr" (Indian-language voice rate applies when both are Indic) or "indic".
    const pair = parsePairLoose(query.pair);
    const indic =
      query.pair === 'indic' ||
      (!!pair && isIndic(pair.source) && isIndic(pair.target));
    const [rates, value] = await Promise.all([
      this.ratesFor(userId),
      creditValuePaise(this.prisma),
    ]);
    const ratePerMinute =
      mode === 'voice'
        ? indic
          ? rates.indicVoiceRate
          : rates.voiceRate
        : rates.captionsRate;
    const directions = 2;
    const creditsPerCall = Math.ceil(ratePerMinute * minutes * directions - 1e-6);
    const totalCredits = creditsPerCall * calls;
    return {
      mode,
      ratePerMinute,
      directions,
      minutes,
      calls,
      creditsPerCall,
      totalCredits,
      approxInrPerCall:
        value.paise == null ? null : round2((creditsPerCall * value.paise) / 100),
      personalized: rates.overridden,
      note:
        'Billed per translated participant-minute (each listener direction) while both people are connected; ' +
        'call minutes are billed separately. Rates are locked when translation starts. ' +
        (value.source === 'topup'
          ? '₹ based on the lowest-priced credit pack.'
          : value.source === 'env'
            ? '₹ based on the standard credit value.'
            : '₹ unavailable.'),
    };
  }
}
