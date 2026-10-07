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
import { Button } from '../../../components/ui/Button';
import { ErrorText, Field, inputCls, Panel, rowCls, Spinner, Stat, StatusBadge, Table, tdCls, useAdminErrorHandler, useResource } from './ui';

const mins = (n: number) => `${Math.round(n ?? 0).toLocaleString('en-IN')} min`;

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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Prepaid revenue (net of refunds)" value={formatMoney(revenue.prepaidNetPaise)} hint={`${revenue.payments} payments`} />
        <Stat label="Last 30 days" value={formatMoney(revenue.last30DaysPaise)} />
        <Stat label="MRR" value={formatMoney(revenue.mrrPaise)} hint={`ARR ${formatMoney(revenue.arrPaise)}`} />
        <Stat label="Credits consumed this month" value={formatCredits(usage.creditsConsumed)} />
        <Stat label="Active paid subscriptions" value={revenue.activePaidSubscriptions} />
        <Stat label="Paying customers" value={revenue.payingCustomers} />
        <Stat label="Refunded" value={formatMoney(revenue.refundedPaise)} />
        <Stat
          label="All-time revenue"
          value={formatMoney(revenue.totalPaise)}
          hint={revenue.legacyUsageInvoicePaise ? `Includes ${formatMoney(revenue.legacyUsageInvoicePaise)} from legacy usage invoices` : undefined}
        />
      </div>

      <Panel title="Usage this month" subtitle={`Since ${formatDate(usage.since)}`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Audio" value={mins(usage.lineItems.audioMinutes)} hint="participant-minutes" />
          <Stat label="Video" value={mins(usage.lineItems.videoMinutes)} hint="participant-minutes" />
          <Stat label="Screen share" value={mins(usage.lineItems.screenShareMinutes)} hint="participant-minutes" />
          <Stat label="Calls" value={usage.lineItems.calls.toLocaleString('en-IN')} hint={`${usage.usage.activeAccounts} active accounts`} />
        </div>
      </Panel>

      <Panel title="Segment analytics" subtitle="Per-participant-minute media segments recorded this month.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Audio" value={mins(segments.totals.audioMins)} />
          <Stat label="Video" value={mins(segments.totals.videoMins)} />
          <Stat label="Screen share" value={mins(segments.totals.screenShareMins)} />
          <Stat label="Segments" value={segments.segmentCount.toLocaleString('en-IN')} hint={`${segments.totals.calls} calls`} />
        </div>
      </Panel>

      {revenue.recentPayments.length > 0 && (
        <Panel title="Recent payments">
          <Table headers={['Date', 'Customer', 'Purpose', 'Amount', 'Status']}>
            {revenue.recentPayments.slice(0, 10).map((p) => (
              <tr key={p.id} className={rowCls}>
                <td className={tdCls}>{formatDate(p.paidAt ?? p.createdAt)}</td>
                <td className={tdCls}>{p.user?.email ?? '—'}</td>
                <td className={tdCls}>{PURPOSE_LABEL[p.purpose] ?? p.purpose}</td>
                <td className={`${tdCls} text-[#170B2E] font-medium`}>{formatMoney(p.amount, p.currency)}</td>
                <td className={tdCls}><StatusBadge status={p.paymentStatus} /></td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      {migration && (
        <Panel title="Prepaid migration summary" subtitle="One-time move of existing accounts to prepaid plans.">
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            {Object.entries(migration).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-[#3D3650]">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                <dd className="text-[#170B2E] break-words">
                  {typeof v === 'object' && v !== null ? (Array.isArray(v) ? `${v.length} item(s)` : JSON.stringify(v)) : String(v)}
                </dd>
              </div>
            ))}
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
    <section className="rounded-2xl border border-dashed border-[#D6C4EE] bg-[#F8F4FD] p-5">
      <button onClick={toggle} className="flex items-center gap-2 text-sm font-semibold text-[#170B2E]" aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Internal cost rates (not customer-facing)
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-[#3D3650]">
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
          {rates && (
            <Button size="sm" onClick={save} loading={saving}>
              {saved ? 'Saved' : 'Save internal rates'}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
