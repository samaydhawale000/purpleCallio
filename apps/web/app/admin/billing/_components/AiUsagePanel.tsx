'use client';

import { useState } from 'react';
import { getAdminAiUsage } from '../../../lib/admin-billing';
import { formatCredits, formatMoney } from '../../../lib/billing';
import { ErrorText, Field, inputCls, Panel, Spinner, Stat, useResource } from './ui';

const day = (d: Date) => d.toISOString().slice(0, 10);

function monthToDate() {
  const now = new Date();
  return { from: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: day(now) };
}

const CREDIT_VALUE_SOURCE = {
  env: 'AI_CREDIT_VALUE_PAISE',
  topup: 'lowest active top-up price per credit, before GST',
  none: 'no active top-ups to value credits',
} as const;

/**
 * AI voice calls billed in a date range: minutes, credits charged, what the
 * provider cost us and the margin. Internal numbers — admins only.
 */
export function AiUsagePanel() {
  const [range, setRange] = useState(monthToDate);
  const { data, loading, error } = useResource(() => getAdminAiUsage(range), [range.from, range.to]);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to;

  return (
    <Panel
      title="AI voice agents"
      subtitle="AI calls billed in the range. Provider cost and margin are internal and never shown to customers."
    >
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="From">
          <input
            type="date"
            className={`${inputCls} w-44`}
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            className={`${inputCls} w-44`}
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
          />
        </Field>
      </div>

      {!valid ? (
        <ErrorText>Pick a start date on or before the end date.</ErrorText>
      ) : loading ? (
        <Spinner tall={false} />
      ) : error || !data ? (
        <ErrorText>{error || 'Failed to load'}</ErrorText>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4" data-testid="ai-usage-summary">
            <Stat
              label="AI minutes"
              value={data.minutes.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              hint={`${data.sessions.toLocaleString('en-IN')} calls`}
            />
            <Stat
              label="Credits charged"
              value={formatCredits(data.creditsCharged)}
              hint={data.creditsShortfall > 0 ? `${formatCredits(data.creditsShortfall)} not covered by balances` : undefined}
            />
            <Stat
              label="Provider cost"
              value={formatMoney(data.providerCostPaise)}
              hint={`at ₹${data.usdInrRate}/USD`}
            />
            <Stat
              label="Credit value"
              value={data.revenuePaise == null ? '—' : formatMoney(data.revenuePaise)}
              hint={data.creditValuePaise == null ? undefined : `${formatMoney(data.creditValuePaise)}/credit`}
            />
            <Stat
              label="Margin"
              value={data.marginPaise == null ? '—' : formatMoney(data.marginPaise)}
              hint={data.marginPercent == null ? undefined : `${data.marginPercent}%`}
            />
          </div>
          <p className="mt-3 text-xs text-[#3D3650]">
            Credits are valued at {CREDIT_VALUE_SOURCE[data.creditValueSource]}. Provider cost uses list audio prices per
            model on {formatCredits(data.inputTokens)} input and {formatCredits(data.outputTokens)} output tokens.
          </p>
        </>
      )}
    </Panel>
  );
}
