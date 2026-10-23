'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TranslationMetrics,
  dateInput,
  fmtInr,
  fmtMs,
  fmtNumber,
  fmtRate,
  getMetrics,
  humanizeGuardReason,
  translationErrorText,
} from '../../lib/translation';
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  NoProjects,
  PageHeader,
  ProjectPicker,
  Tile,
  TranslationNav,
  useProjects,
} from './_components/shared';

const RANGES = [7, 30, 90];
const th = 'py-2 pr-4 text-left text-xs font-medium text-[#3D3650] whitespace-nowrap';
const td = 'py-2.5 pr-4 text-sm text-[#170B2E] tabular-nums';

/** Translation Observability: latency, reliability, MeaningGuard and cost per project. */
export default function TranslationOverviewPage() {
  const { projects, projectId, setProjectId, error: projectsError, loading: projectsLoading } = useProjects();
  const [from, setFrom] = useState(dateInput(29));
  const [to, setTo] = useState(dateInput(0));
  const [metrics, setMetrics] = useState<TranslationMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    getMetrics(projectId, { from, to })
      .then(setMetrics)
      .catch((e) => {
        setMetrics(null);
        setError(translationErrorText(e, 'Could not load translation metrics. Please try again.'));
      })
      .finally(() => setLoading(false));
  }, [projectId, from, to]);

  useEffect(load, [load]);

  const preset = (days: number) => {
    setFrom(dateInput(days - 1));
    setTo(dateInput(0));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Live Translate"
        subtitle="Two-way voice and caption translation for 1:1 calls. See how fast, reliable and costly translation is for each project."
        actions={
          projects && projects.length > 0 ? (
            <>
              <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="metrics-from" className="text-sm font-medium text-[#3D3650]">From</label>
                <input id="metrics-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 rounded-lg text-sm border border-[#D6C4EE] text-[#170B2E]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="metrics-to" className="text-sm font-medium text-[#3D3650]">To</label>
                <input id="metrics-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 rounded-lg text-sm border border-[#D6C4EE] text-[#170B2E]" />
              </div>
              <div className="flex gap-1 pb-0.5" role="group" aria-label="Quick ranges">
                {RANGES.map((d) => (
                  <button key={d} onClick={() => preset(d)} className="px-2.5 py-2 rounded-md text-xs border border-[#E7DFF5] text-[#3D3650] hover:text-[#170B2E]">
                    {d}d
                  </button>
                ))}
              </div>
            </>
          ) : undefined
        }
      />
      <TranslationNav />

      {projectsLoading ? (
        <Loading label="Loading projects…" />
      ) : projectsError ? (
        <ErrorBox>Could not load your projects. Please refresh the page.</ErrorBox>
      ) : !projects?.length ? (
        <NoProjects />
      ) : error ? (
        <ErrorBox onRetry={load}>{error}</ErrorBox>
      ) : !metrics ? (
        <Loading label="Loading metrics…" />
      ) : metrics.totals.sessions === 0 ? (
        <Empty title="No translated calls in this period">
          Start a call with <code className="font-mono text-xs">translation.mode</code> set to{' '}
          <code className="font-mono text-xs">captions</code> or <code className="font-mono text-xs">voice</code> and metrics will appear here.
        </Empty>
      ) : (
        <MetricsView m={metrics} dim={loading} />
      )}
    </div>
  );
}

function MetricsView({ m, dim }: { m: TranslationMetrics; dim: boolean }) {
  const reasons = Object.entries(m.guard.byReason ?? {}).sort((a, b) => b[1] - a[1]);
  const totalMinutes = (m.totals.voiceMinutes ?? 0) + (m.totals.captionsMinutes ?? 0);
  return (
    <div className={`flex flex-col gap-6 ${dim ? 'opacity-60' : ''}`} data-testid="translation-metrics">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile
          label="Time to first translated audio"
          value={fmtMs(m.latency.firstAudioMsP50)}
          hint={`p50 · p95 ${fmtMs(m.latency.firstAudioMsP95)}`}
          testId="tile-first-audio"
        />
        <Tile
          label="Caption delay"
          value={fmtMs(m.latency.captionDelayMsP50)}
          hint={`p50 · p95 ${fmtMs(m.latency.captionDelayMsP95)}`}
        />
        <Tile
          label="Cost per call-minute"
          value={`${fmtNumber(m.totals.avgCreditsPerCallMinute, 1)} credits`}
          hint={m.totals.approxInrPerCallMinute != null ? `≈ ${fmtInr(m.totals.approxInrPerCallMinute)} per minute` : undefined}
          testId="tile-cost"
        />
        <Tile
          label="Translated calls"
          value={fmtNumber(m.totals.calls)}
          hint={`${fmtNumber(m.totals.sessions)} directions · ${fmtNumber(m.totals.credits)} credits`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <Card title="Reliability" subtitle="Problems the translation pipeline ran into.">
          <dl className="grid grid-cols-2 gap-4">
            <Stat label="Provider failures" value={m.reliability.providerFailures} />
            <Stat label="Fallbacks to another route" value={m.reliability.fallbacks} />
            <Stat label="Dropped audio frames" value={m.reliability.droppedFrames} />
            <Stat label="Failed directions" value={m.reliability.failedSessions} />
          </dl>
        </Card>

        <Card title="Minutes by mode" subtitle="Per listener direction.">
          <ModeBar label="Voice translation" minutes={m.totals.voiceMinutes} total={totalMinutes} />
          <ModeBar label="Captions" minutes={m.totals.captionsMinutes} total={totalMinutes} />
        </Card>

        <Card title="Listener actions" subtitle="How often people asked to hear something again.">
          <dl className="grid grid-cols-2 gap-4">
            <Stat label="Replays of original audio" value={m.guard.replays} />
            <Stat label="Repeat requests" value={m.guard.repeats} />
            <Stat label="PurpleLex terms enforced" value={m.guard.lexiconHits} />
            <Stat label="Phrases translated" value={m.guard.phrases} />
          </dl>
        </Card>
      </div>

      <Card
        title="MeaningGuard flags"
        subtitle={`${fmtNumber(m.guard.flags)} of ${fmtNumber(m.guard.phrases)} phrases (${fmtRate(m.guard.flagRate)}) were flagged as possibly not accurate. Flags are hints for review, not a score.`}
        testId="guard-reasons"
      >
        {reasons.length === 0 ? (
          <p className="text-sm text-[#3D3650]">No phrases were flagged in this period.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reasons.map(([reason, count]) => (
              <li key={reason} className="flex items-center gap-3 text-sm">
                <span className="flex-1 text-[#170B2E]">{humanizeGuardReason(reason)}</span>
                <span className="tabular-nums text-[#3D3650]">
                  {fmtNumber(count)} · {fmtRate(m.guard.phrases ? count / m.guard.phrases : null)} of phrases
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="By language pair">
        {m.byPair.length === 0 ? (
          <p className="text-sm text-[#3D3650]">No language pairs in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E7DFF5]">
                  <th className={th}>Pair</th>
                  <th className={th}>Directions</th>
                  <th className={th}>Minutes</th>
                  <th className={th}>First audio p50</th>
                  <th className={th}>Flag rate</th>
                </tr>
              </thead>
              <tbody>
                {m.byPair.map((p) => (
                  <tr key={`${p.pair}-${p.route ?? ''}`} className="border-b border-[#E7DFF5]/60 last:border-0">
                    <td className={`${td} font-mono text-xs`}>{p.pair}</td>
                    <td className={td}>{fmtNumber(p.sessions)}</td>
                    <td className={td}>{fmtNumber(p.minutes, 1)}</td>
                    <td className={td}>{fmtMs(p.firstAudioMsP50)}</td>
                    <td className={td}>{fmtRate(p.flagRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Benchmarks" subtitle="Term preservation measured on our reference test sets." testId="benchmarks">
        {m.benchmarks.length === 0 || m.benchmarks.every((b) => b.termPreservation == null) ? (
          <p className="text-sm text-[#3D3650]">
            Benchmarks are pending Phase 0 — results will appear here once the reference test sets have been run.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E7DFF5]">
                  <th className={th}>Pair</th>
                  <th className={th}>Term preservation</th>
                  <th className={th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {m.benchmarks.map((b) => (
                  <tr key={`${b.pair}-${b.route ?? ''}`} className="border-b border-[#E7DFF5]/60 last:border-0">
                    <td className={`${td} font-mono text-xs`}>{b.pair}</td>
                    <td className={td}>{b.termPreservation == null ? 'Pending Phase 0' : fmtRate(b.termPreservation)}</td>
                    <td className={`${td} text-[#3D3650]`}>{b.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-[#3D3650]">{label}</dt>
      <dd className="text-lg font-semibold text-[#170B2E] tabular-nums">{fmtNumber(value)}</dd>
    </div>
  );
}

function ModeBar({ label, minutes, total }: { label: string; minutes: number; total: number }) {
  const pct = total > 0 ? Math.round((minutes / total) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-[#170B2E]">{label}</span>
        <span className="tabular-nums text-[#3D3650]">{fmtNumber(minutes, 1)} min</span>
      </div>
      <div className="h-2 rounded-full bg-[#F0E9FA]" role="img" aria-label={`${label}: ${pct}% of translated minutes`}>
        <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #7F40E8, #410686)' }} />
      </div>
    </div>
  );
}
