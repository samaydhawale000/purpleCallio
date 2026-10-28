'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  getAdminUsageSummary,
  getInternalRates,
  getMigrationSummary,
  getRevenue,
  getSegmentAnalytics,
  updateInternalRates,
  type InternalRates,
} from '../../../lib/admin-billing';
import { formatCredits, formatDate, formatMoney, PURPOSE_LABEL } from '../../../lib/billing';
import { formatMinutes as mins } from '../../../lib/duration';
import { useCanWrite } from '../../../lib/admin-access';
import { AiUsagePanel } from './AiUsagePanel';
import { Button, ErrorText, Field, inputCls, Panel, rowCls, Spinner, Stat, StatRow, StatusBadge, Table, tdCls, useAdminErrorHandler, useResource } from './ui';


export function OverviewTab() {
  const { data, loading, error } = useResource(
    async () => {
      const [revenue, usage, segments, migration] = await Promise.all([
        getRevenue(),
        getAdminUsageSummary(),
        getSegmentAnalytics(),
        getMigrationSummary().catch(() => null),
      ]);
      return { revenue, usage, segments, migration };
    },
    [],
  );

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorText>{error || 'Failed to load'}</ErrorText>;
  const { revenue, usage, segments, migration } = data;

  const line = usage.lineItems;
  const seg = segments.totals;
  const mediaRows = [
    { key: 'audio', label: 'Audio', billed: line.audioMinutes, recorded: seg.audioMins },
    { key: 'video', label: 'Video', billed: line.videoMinutes, recorded: seg.videoMins },
    { key: 'screen', label: 'Screen share', billed: line.screenShareMinutes, recorded: seg.screenShareMins },
  ];

  return (
    <div className="flex flex-col gap-10">
      <Panel title="Revenue" flush>
        <StatRow>
          <Stat label="Prepaid revenue (net of refunds)" value={formatMoney(revenue.prepaidNetPaise)} hint={`${revenue.payments} payments`} />
          <Stat label="Last 30 days" value={formatMoney(revenue.last30DaysPaise)} />
          <Stat label="Refunded" value={formatMoney(revenue.refundedPaise)} />
          <Stat
            label="All-time revenue"
            value={formatMoney(revenue.totalPaise)}
            hint={revenue.legacyUsageInvoicePaise ? `Includes ${formatMoney(revenue.legacyUsageInvoicePaise)} from legacy usage invoices` : undefined}
          />
        </StatRow>
        <p className="mt-3 text-[13px] text-[#6B6478]">
          {revenue.payingCustomers.toLocaleString('en-IN')} paying customers · Legacy: MRR {formatMoney(revenue.mrrPaise)}, ARR{' '}
          {formatMoney(revenue.arrPaise)}, {revenue.activePaidSubscriptions} paid records (historical only)
        </p>
      </Panel>

      <Panel
        title="Usage this month"
        subtitle={`Since ${formatDate(usage.since)} · ${formatCredits(usage.creditsConsumed)} credits consumed · ${line.calls.toLocaleString('en-IN')} calls across ${usage.usage.activeAccounts} active accounts`}
        flush
      >
        <Table headers={['Media', 'Billed participant time', 'Recorded segments']}>
          {mediaRows.map((r) => (
            <tr key={r.key} className={rowCls}>
              <td className={tdCls}>{r.label}</td>
              <td className={`${tdCls} tabular-nums`}>{mins(r.billed)}</td>
              <td className={`${tdCls} tabular-nums`}>{mins(r.recorded)}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-[#6B6478]">
          {segments.segmentCount.toLocaleString('en-IN')} per-participant-minute segments recorded across {seg.calls} calls.
        </p>
      </Panel>

      {revenue.recentPayments.length > 0 && (
        <Panel title="Recent payments" flush>
          <Table headers={['Date', 'Customer', 'Purpose', 'Amount', 'Status']}>
            {revenue.recentPayments.slice(0, 10).map((p) => (
              <tr key={p.id} className={rowCls}>
                <td className={tdCls}>{formatDate(p.paidAt ?? p.createdAt)}</td>
                <td className={tdCls}>{p.user?.email ?? '—'}</td>
                <td className={tdCls}>{PURPOSE_LABEL[p.purpose] ?? p.purpose}</td>
                <td className={`${tdCls} font-medium tabular-nums`}>{formatMoney(p.amount, p.currency)}</td>
                <td className={tdCls}><StatusBadge status={p.paymentStatus} /></td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      <AiUsagePanel />

      {migration && (
        <Panel title="Prepaid migration summary" subtitle="One-time move of existing accounts to prepaid wallets.">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(migration).map(([k, v]) => {
              const label = k.replace(/([A-Z])/g, ' $1').toLowerCase();
              return (
                <div key={k}>
                  <dt className="text-[13px] text-[#6B6478]">{label.charAt(0).toUpperCase() + label.slice(1)}</dt>
                  <dd className="break-words text-[#170B2E]">
                    {typeof v === 'object' && v !== null ? (Array.isArray(v) ? `${v.length} item(s)` : JSON.stringify(v)) : String(v)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Panel>
      )}

      <InternalRatesEditor />
    </div>
  );
}

function InternalRatesEditor() {
  const handle = useAdminErrorHandler();
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<InternalRates | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const canWrite = useCanWrite();

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !rates) {
      try {
        setRates(await getInternalRates());
      } catch (e) {
        setError(handle(e, 'Failed to load internal rates'));
      }
    }
  };

  const save = async () => {
    if (!rates) return;
    setSaving(true);
    setError('');
    try {
      await updateInternalRates({ audioPaise: rates.audioPaise, videoPaise: rates.videoPaise, screenSharePaise: rates.screenSharePaise });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(handle(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl bg-[#F7F6FA] p-5">
      <button type="button" onClick={toggle} className="flex items-center gap-2 text-sm font-medium text-[#170B2E]" aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Internal cost rates (not customer-facing)
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-[13px] text-[#6B6478]">
            Paise per participant-minute used only to estimate PurpleCallio&apos;s infrastructure cost in analytics. Customers
            are never charged these rates — they consume credits at the configured credit rates.
          </p>
          {rates ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(['audioPaise', 'videoPaise', 'screenSharePaise'] as const).map((k) => (
                <Field key={k} label={`${k.replace('Paise', '').replace('screenShare', 'Screen share').replace(/^./, (c) => c.toUpperCase())} (paise/min)`}>
                  <input
                    type="number"
                    min={0}
                    readOnly={!canWrite}
                    className={inputCls}
                    value={rates[k]}
                    onChange={(e) => setRates({ ...rates, [k]: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Field>
              ))}
            </div>
          ) : (
            !error && <Spinner tall={false} />
          )}
          <ErrorText>{error}</ErrorText>
          {canWrite && rates && (
            <Button size="sm" onClick={save} loading={saving}>
              {saved ? 'Saved' : 'Save internal rates'}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
