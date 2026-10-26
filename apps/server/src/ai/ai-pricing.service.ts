import { Injectable } from '@nestjs/common';

import { usdInrRate } from '../exchange-rate/exchange-rate';

/** Provider list price for one realtime model, USD per 1M tokens. */
export interface AiModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

interface ProviderPrices {
  /** Used when the session's model isn't listed (or is null). */
  default: AiModelPrice;
  models?: Record<string, AiModelPrice>;
}

/**
 * Provider audio prices (admin analytics only). Token counts from the
 * providers' usage events are mostly audio, so audio rates are applied to
 * the totals. Review these when a provider changes its price list.
 */
export const AI_PROVIDER_PRICES: Record<string, ProviderPrices> = {
  gemini: {
    default: { inputUsdPerMillion: 3, outputUsdPerMillion: 12 },
    models: {
      'gemini-3.8-live': { inputUsdPerMillion: 3, outputUsdPerMillion: 12 },
    },
  },
  // https://developers.openai.com/api/docs/pricing (checked 2026-10).
  openai: {
    default: { inputUsdPerMillion: 32, outputUsdPerMillion: 64 },
    models: {
      'gpt-realtime-2.1': { inputUsdPerMillion: 32, outputUsdPerMillion: 64 },
      'gpt-realtime': { inputUsdPerMillion: 32, outputUsdPerMillion: 64 },
      'gpt-realtime-mini': { inputUsdPerMillion: 10, outputUsdPerMillion: 20 },
    },
  },
};

export { DEFAULT_USD_INR_RATE } from '../exchange-rate/exchange-rate';

export interface AiUsageForCost {
  provider: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

/**
 * What an AI session cost us at the provider, in paise. Internal only:
 * customers are billed in credits and never see this number.
 */
@Injectable()
export class AiPricingService {
  /** USD → INR: AI_USD_INR_RATE when pinned, else the live rate (exchange-rate.ts). */
  usdInrRate(): number {
    return usdInrRate();
  }

  priceFor(provider: string, model: string | null): AiModelPrice | null {
    const prices = AI_PROVIDER_PRICES[provider];
    if (!prices) return null;
    return (model && prices.models?.[model]) || prices.default;
  }

  /** null when the provider has no configured price. */
  providerCostPaise(usage: AiUsageForCost): number | null {
    const price = this.priceFor(usage.provider, usage.model);
    if (!price) return null;
    const usd =
      (Math.max(0, usage.inputTokens) * price.inputUsdPerMillion +
        Math.max(0, usage.outputTokens) * price.outputUsdPerMillion) /
      1_000_000;
    return Math.round(usd * this.usdInrRate() * 100);
  }
}
