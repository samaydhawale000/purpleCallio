'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMinutes } from '../../lib/duration';
import { getCallUsage, getCurrentUsage, type CallUsageRow } from '../../lib/billing';
import {
  Block,
  Empty,
  LineChart,
  PageHeader,
  Pager,
  Panel,
  Section,
  Segmented,
  Stat,
  Table,
  fmtDateTime,
  fmtDay,
  fmtNumber,
  useResource,
  type ChartSeries,
} from '../_ui';
import { RANGE_OPTIONS, getDailyUsage, sumBy, type DailyUsage } from '../_ui/usage-data';

const PRODUCTS: (ChartSeries & {
  credits: (d: DailyUsage) => number;
  minutes?: (d: DailyUsage) => number;
})[] = [
  { key: 'calls', label: 'Calls', color: '#7F40E8', credits: (d) => d.callCredits, minutes: (d) => d.callMinutes },
  { key: 'translate', label: 'Live Translate', color: '#0EA5E9', credits: (d) => d.translateCredits, minutes: (d) => d.translateMinutes },
  { key: 'ai', label: 'AI Agents', color: '#10B981', credits: (d) => d.aiCredits, minutes: (d) => d.aiMinutes },
  { key: 'reports', label: 'Post-call reports', color: '#F59E0B', credits: (d) => d.reportCredits },
];

const credits = (n: number) => `${n} ${n === 1 ? 'credit' : 'credits'}`;

export default function UsagePage() {
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);

  const daily = useResource(() => getDailyUsage(days), [days]);
  const rates = useResource(() => getCurrentUsage().then((u) => u.creditRates));
  const callUsage = useResource(() => getCallUsage(page), [page]);

  return (
    <>
      <PageHeader
        title="Usage"
        description="Credits used by each product."
        actions={<Segmented<number> label="Range" value={days} onChange={setDays} options={RANGE_OPTIONS} />}
      />

      <Block res={daily}>
        {(rows) => {
          const total = sumBy(rows, (r) => r.totalCredits);
          // Only chart products that were actually used in the window.
          const used = PRODUCTS.filter((p) => sumBy(rows, p.credits) > 0);
          const series = used.length ? used : PRODUCTS.slice(0, 1);
          return (
            <>
              <Section>
                <Panel>
                  <div className="mb-5">
                    <Stat label={`Credits used · last ${days} days`} value={fmtNumber(total)} unit="credits" />
                  </div>
                  <LineChart
                    ariaLabel="Credits used per day by product"
                    data={rows.map((r) => ({
                      label: fmtDay(r.date),
                      ...Object.fromEntries(series.map((p) => [p.key, p.credits(r)])),
                    }))}
                    series={series}
                    format={(n) => `${fmtNumber(n)} credits`}
                  />
                </Panel>
              </Section>

              <Section title="By product">
                <Table
                  rows={PRODUCTS}
                  rowKey={(p) => p.key}
                  columns={[
                    {
                      key: 'product',
                      label: 'Product',
                      render: (p) => (
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                          {p.label}
                        </span>
                      ),
                    },
                    {
                      key: 'usage',
                      label: 'Usage',
                      align: 'right',
                      render: (p) => (p.minutes ? formatMinutes(sumBy(rows, p.minutes)) : '—'),
                    },
                    {
                      key: 'credits',
                      label: 'Credits',
                      align: 'right',
                      render: (p) => fmtNumber(sumBy(rows, p.credits)),
                    },
                    {
                      key: 'share',
                      label: 'Share',
                      align: 'right',
                      className: 'text-[#6B6478]',
                      render: (p) => (total > 0 ? `${Math.round((sumBy(rows, p.credits) / total) * 100)}%` : '—'),
                    },
                  ]}
                />
                {rates.data && (
                  <p className="mt-3 text-xs text-[#6B6478]">
                    Calls are billed per participant-minute: {credits(rates.data.audioCreditsPerMinute)} audio,{' '}
                    {credits(rates.data.videoCreditsPerMinute)} video, {credits(rates.data.screenShareCreditsPerMinute)} screen
                    share. Usage is shown in participant-minutes (call length × people on the call).
                  </p>
                )}
              </Section>
            </>
          );
        }}
      </Block>

      <Section title="Billed calls" description="Most recent first. Select a call to see its details.">
        <Block res={callUsage}>
          {(res) => (
            <>
              <Table<CallUsageRow>
                rows={res.data}
                rowKey={(r) => r.id}
                onRowClick={(r) => router.push(`/dashboard/calls?call=${r.callId}`)}
                empty={<Empty title="No billed calls yet" body="Calls appear here once they end and are billed." />}
                columns={[
                  { key: 'date', label: 'Date', render: (r) => fmtDateTime(r.startedAt ?? r.createdAt) },
                  { key: 'call', label: 'Call ID', mono: true, render: (r) => r.callId.slice(0, 12) },
                  {
                    key: 'audio',
                    label: 'Audio',
                    align: 'right',
                    render: (r) => <span data-testid="call-audio">{formatMinutes(r.audioMinutes)}</span>,
                  },
                  {
                    key: 'video',
                    label: 'Video',
                    align: 'right',
                    render: (r) => <span data-testid="call-video">{formatMinutes(r.videoMinutes)}</span>,
                  },
                  {
                    key: 'screen',
                    label: 'Screen share',
                    align: 'right',
                    render: (r) => <span data-testid="call-screen">{formatMinutes(r.screenShareMinutes)}</span>,
                  },
                  { key: 'people', label: 'Participants', align: 'right', render: (r) => r.participants },
                  {
                    key: 'credits',
                    label: 'Credits',
                    align: 'right',
                    render: (r) => <span data-testid="call-credits">{fmtNumber(r.creditsCharged)}</span>,
                  },
                ]}
              />
              <Pager page={res.page} pageCount={res.pageCount} total={res.total} onChange={setPage} />
            </>
          )}
        </Block>
      </Section>
    </>
  );
}
