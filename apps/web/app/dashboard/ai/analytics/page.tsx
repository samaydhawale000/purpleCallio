'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { AiAnalytics, apiErrorMessages, dateInputValue, formatDuration, useAiStatus } from '../../../lib/ai';
import { AiDisabledNotice, AiLoading } from '../_components/AiNotices';
import { AiSectionNav } from '../_components/AiSectionNav';
import { Select } from '../_components/fields';

const RANGES = [7, 30, 90];

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <p className="text-xs text-[#3D3650]">{label}</p>
      <p className="text-2xl font-bold text-[#170B2E] mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-[#3D3650] mt-1">{hint}</p>}
    </div>
  );
}

const fmtMinutes = (m: number) => m.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** "2026-10-17" → "Oct 17", read as a UTC day like the server buckets. */
function dayLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

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

  const finished = data ? data.completed + data.failed : 0;
  const successRate = data && finished > 0 ? `${Math.round((data.completed / finished) * 100)}%` : '—';
  const maxMinutes = data ? Math.max(...data.minutesPerDay.map((d) => d.minutes), 1) : 1;
  // Label every nth day so long ranges stay readable.
  const labelEvery = data ? Math.ceil(data.minutesPerDay.length / 15) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#170B2E]">AI Analytics</h1>
          <p className="text-sm text-[#3D3650] mt-1">How your voice agents are being used.</p>
        </div>
        {enabled && (
          <div className="w-40">
            <Select id="analytics-range" label="Period" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              {RANGES.map((d) => (
                <option key={d} value={d}>Last {d} days</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {!enabled ? (
        <AiDisabledNotice />
      ) : (
        <>
          <AiSectionNav />
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : !data ? (
            <AiLoading label="Loading analytics…" />
          ) : (
            <div className={`flex flex-col gap-6 ${loading ? 'opacity-60' : ''}`}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Tile label="Sessions" value={data.totalSessions.toLocaleString('en-US')} hint={data.inProgress ? `${data.inProgress} in progress` : undefined} />
                <Tile label="Minutes" value={fmtMinutes(data.totalMinutes)} />
                <Tile label="Average duration" value={formatDuration(data.averageDurationSeconds)} hint="Answered calls only" />
                <Tile
                  label="Success rate"
                  value={successRate}
                  hint={`${data.completed} completed · ${data.failed} failed${data.expired ? ` · ${data.expired} never connected` : ''}`}
                />
                <Tile label="Tool calls" value={data.toolCalls.toLocaleString('en-US')} />
                <Tile label="Credits used" value={data.creditsUsed.toLocaleString('en-US')} />
                <Tile label="Peak concurrent calls" value={String(data.peakConcurrency)} />
              </div>

              <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
                <div className="mb-6">
                  <p className="text-sm font-semibold text-[#170B2E]">Minutes per day</p>
                  <p className="text-xs text-[#3D3650] mt-0.5">Days are in UTC.</p>
                </div>
                {data.totalMinutes === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-[#3D3650]">
                    No AI call minutes in this period.
                  </div>
                ) : (
                  <div className="flex h-48 items-end justify-between gap-0.5" role="img" aria-label="AI call minutes per day">
                    {data.minutesPerDay.map((d, i) => (
                      <div
                        key={d.date}
                        className="group relative flex h-full flex-1 min-w-0 flex-col items-center justify-end gap-2"
                        title={`${dayLabel(d.date)}: ${fmtMinutes(d.minutes)} min, ${d.sessions} call${d.sessions === 1 ? '' : 's'}`}
                      >
                        <div className="flex h-full w-full items-end">
                          <div
                            className="w-full rounded-t-[4px] transition-all group-hover:opacity-80"
                            style={{
                              height: d.minutes > 0 ? `${Math.max(2, (d.minutes / maxMinutes) * 100)}%` : '0%',
                              background: 'linear-gradient(180deg, #7F40E8, rgba(127,64,232,0.25))',
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-[#3D3650] whitespace-nowrap h-3">
                          {i % labelEvery === 0 ? dayLabel(d.date) : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
