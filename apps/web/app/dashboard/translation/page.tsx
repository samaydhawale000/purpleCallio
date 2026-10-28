'use client';

import { useState } from 'react';
import { formatMinutes } from '../../lib/duration';
import { dateInput, fmtInr, fmtMs, fmtNumber, getMetrics, translationErrorText } from '../../lib/translation';
import { Block, LineChart, Panel, Section, Segmented, Stat, fmtDay, useResource } from '../_ui';
import { RANGE_OPTIONS, getDailyUsage } from '../_ui/usage-data';
import { Empty, ErrorBox, Loading, NoProjects, PageHeader, ProjectPicker, TranslationNav, useProjects } from './_components/shared';

/** Live Translate at a glance: how much was translated, what it cost and how fast it was. */
export default function TranslationOverviewPage() {
  const { projects, projectId, setProjectId, error: projectsError, loading: projectsLoading } = useProjects();
  const [days, setDays] = useState(30);

  const metrics = useResource(
    () => (projectId ? getMetrics(projectId, { from: dateInput(days - 1), to: dateInput(0) }) : Promise.resolve(null)),
    [projectId, days],
    (e) => translationErrorText(e, 'Could not load translation metrics. Please try again.'),
  );
  const daily = useResource(() => (projectId ? getDailyUsage(days, projectId) : Promise.resolve([])), [projectId, days]);

  return (
    <>
      <PageHeader
        title="Live Translate"
        subtitle="Real-time voice and caption translation for 1:1 calls."
        actions={
          projects && projects.length > 0 ? (
            <>
              <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
              <Segmented<number> label="Range" value={days} onChange={setDays} options={RANGE_OPTIONS} />
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
      ) : metrics.error ? (
        <ErrorBox onRetry={metrics.reload}>{metrics.error}</ErrorBox>
      ) : !metrics.data ? (
        <Loading label="Loading…" />
      ) : metrics.data.totals.sessions === 0 ? (
        <Empty title="No translated calls in this period">
          Start a call with <code className="font-mono text-xs">translation.mode</code> set to{' '}
          <code className="font-mono text-xs">captions</code> or <code className="font-mono text-xs">voice</code> and it will show up here.
        </Empty>
      ) : (
        <div data-testid="translation-metrics">
          {(() => {
            const t = metrics.data.totals;
            return (
              <Panel className="mb-10">
                <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                  <Stat label="Translated calls" value={fmtNumber(t.calls)} />
                  <Stat
                    label="Minutes translated"
                    value={formatMinutes(t.voiceMinutes + t.captionsMinutes)}
                    hint={`${formatMinutes(t.voiceMinutes)} voice · ${formatMinutes(t.captionsMinutes)} captions`}
                  />
                  <div data-testid="tile-cost">
                    <Stat
                      label="Credits used"
                      value={fmtNumber(t.credits)}
                      hint={
                        t.avgCreditsPerCallMinute != null
                          ? `${fmtNumber(t.avgCreditsPerCallMinute, 1)} credits per call-minute${
                              t.approxInrPerCallMinute != null ? ` (≈ ${fmtInr(t.approxInrPerCallMinute)})` : ''
                            }`
                          : undefined
                      }
                    />
                  </div>
                  <div data-testid="tile-first-audio">
                    <Stat
                      label="Translation delay"
                      value={fmtMs(metrics.data.latency.firstAudioMsP50)}
                      hint="Typical wait before the translated voice starts"
                    />
                  </div>
                </div>
              </Panel>
            );
          })()}

          <Section title="Minutes translated per day">
            <Panel>
              <Block res={daily}>
                {(rows) => (
                  <LineChart
                    ariaLabel="Minutes translated per day"
                    data={rows.map((r) => ({ label: fmtDay(r.date), minutes: r.translateMinutes }))}
                    series={[{ key: 'minutes', label: 'Minutes', color: '#0EA5E9' }]}
                    format={(n) => formatMinutes(n)}
                  />
                )}
              </Block>
            </Panel>
          </Section>
        </div>
      )}
    </>
  );
}
