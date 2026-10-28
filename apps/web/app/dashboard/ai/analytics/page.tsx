'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { AiAnalytics, apiErrorMessages, dateInputValue, formatDuration, useAiStatus } from '../../../lib/ai';
import { ErrorNote, LineChart, PageHeader, Panel, Section, Segmented, Stat, fmtDay, fmtNumber } from '../../_ui';
import { AiDisabledNotice, AiLoading } from '../_components/AiNotices';
import { AiSectionNav } from '../_components/AiSectionNav';

const RANGES = [7, 30, 90].map((d) => ({ value: d, label: `${d} days` }));

const fmtMinutes = (m: number) => m.toLocaleString('en-IN', { maximumFractionDigits: 1 });

export default function AiAnalyticsPage() {
  const { status, loading: statusLoading } = useAiStatus();
  const enabled = status?.enabled === true;
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AiAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    api
      .get('/ai/analytics', { params: { from: dateInputValue(days - 1), to: dateInputValue(0) } })
      .then((r) => setData(r.data))
      .catch((e) => setError(apiErrorMessages(e, 'Failed to load analytics')[0]))
      .finally(() => setLoading(false));
  }, [enabled, days]);

  if (statusLoading) return <AiLoading label="Loading analytics…" />;

  return (
    <>
      <PageHeader
        title="AI Analytics"
        description="How your voice agents are being used."
        actions={enabled && <Segmented<number> label="Period" value={days} onChange={setDays} options={RANGES} />}
      />

      {!enabled ? (
        <AiDisabledNotice />
      ) : (
        <>
          <AiSectionNav />
          {error ? (
            <ErrorNote message={error} />
          ) : !data ? (
            <AiLoading label="Loading analytics…" />
          ) : (
            <Section className={loading ? 'opacity-60' : ''}>
              <Panel>
                <div className="mb-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
                  <Stat
                    label="Sessions"
                    value={fmtNumber(data.totalSessions)}
                    hint={data.inProgress ? `${data.inProgress} in progress` : undefined}
                  />
                  <Stat label="Minutes" value={fmtMinutes(data.totalMinutes)} />
                  <Stat label="Average duration" value={formatDuration(data.averageDurationSeconds)} hint="Answered calls only" />
                  <Stat label="Credits used" value={fmtNumber(data.creditsUsed)} />
                </div>
                {data.totalMinutes === 0 ? (
                  <p className="py-16 text-center text-[13px] text-[#6B6478]">No AI call minutes in this period.</p>
                ) : (
                  <LineChart
                    ariaLabel="AI call minutes per day"
                    data={data.minutesPerDay.map((d) => ({ label: fmtDay(d.date), minutes: d.minutes }))}
                    series={[{ key: 'minutes', label: 'Minutes', color: '#7F40E8' }]}
                    format={(n) => `${fmtMinutes(n)} min`}
                  />
                )}
                <p className="mt-2 text-xs text-[#6B6478]">Minutes per day. Days are in UTC.</p>
              </Panel>
            </Section>
          )}
        </>
      )}
    </>
  );
}
