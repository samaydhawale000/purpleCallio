import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { isSaneUsdInrRate, setLiveUsdInrRate } from './exchange-rate';

/** Free, keyless sources, tried in order. */
const SOURCES: { name: string; url: string; pick: (body: any) => unknown }[] = [
  { name: 'frankfurter', url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR', pick: (b) => b?.rates?.INR },
  { name: 'open-er-api', url: 'https://open.er-api.com/v6/latest/USD', pick: (b) => b?.rates?.INR },
];
const TIMEOUT_MS = 8_000;

/** Keeps the USD → INR rate current so provider costs follow the dollar. */
@Injectable()
export class ExchangeRateService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeRateService.name);

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    void this.refresh();
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async refresh(): Promise<number | null> {
    for (const source of SOURCES) {
      try {
        const res = await fetch(source.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const rate = source.pick(await res.json());
        if (!isSaneUsdInrRate(rate)) throw new Error('implausible rate');
        setLiveUsdInrRate(rate, source.name);
        this.logger.log(`event=usd_inr_rate_refreshed source=${source.name} rate=${rate}`);
        return rate;
      } catch (err) {
        this.logger.warn(`event=usd_inr_rate_refresh_failed source=${source.name} error=${(err as Error)?.message ?? 'unknown'}`);
      }
    }
    return null; // keep the last good rate
  }
}
