'use client';

import { formatRate, usePublicPricing } from '../lib/public-pricing';

/** The live GST rate set in Admin → Billing → Settings, e.g. "18%". */
export function GstRate({ fallback = 'the applicable rate' }: { fallback?: string }) {
  const state = usePublicPricing();
  return <>{state.status === 'ready' ? `${formatRate(state.data.creditRates.taxPercent)}%` : fallback}</>;
}
