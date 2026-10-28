'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import {
  AiAgent,
  AiCallList,
  apiErrorMessages,
  dateInputValue,
  formatDuration,
  sessionStatusBadge,
  terminationLabel,
  useAiStatus,
} from '../../../lib/ai';
import { Empty, ErrorNote, PageHeader, Pager, Pill, Table, fmtDateTime, fmtNumber } from '../../_ui';
import { AiDisabledNotice, AiLoading, pillTone } from '../_components/AiNotices';
import { AiSectionNav } from '../_components/AiSectionNav';
import { Select, TextInput } from '../_components/fields';

/** Agents across every project, for the filter (the API lists per project). */
async function loadAgents(): Promise<AiAgent[]> {
  const projects: { id: string }[] = (await api.get('/projects')).data ?? [];
  const perProject = await Promise.all(
    projects.map((p) => api.get('/ai/agents', { params: { projectId: p.id } }).then((r) => r.data as AiAgent[])),
  );
  return perProject.flat().sort((a, b) => a.name.localeCompare(b.name));
}

export default function AiCallsPage() {
  const router = useRouter();
  const { status, loading: statusLoading } = useAiStatus();
  const enabled = status?.enabled === true;

  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [agentId, setAgentId] = useState('');
  const [from, setFrom] = useState(() => dateInputValue(29));
  const [to, setTo] = useState(() => dateInputValue(0));
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AiCallList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (enabled) loadAgents().then(setAgents).catch(() => setAgents([]));
  }, [enabled]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/ai/calls', {
        params: { from, to, page, ...(agentId ? { agentId } : {}) },
      });
      setData(res.data);
    } catch (e) {
      setError(apiErrorMessages(e, 'Failed to load calls')[0]);
    } finally {
      setLoading(false);
    }
  }, [agentId, from, to, page]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  if (statusLoading) return <AiLoading label="Loading calls…" />;

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader title="AI Calls" description="Every call your agents have taken." />

      {!enabled ? (
        <AiDisabledNotice />
      ) : (
        <>
          <AiSectionNav />
          <div className="mb-4 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
            <Select id="calls-agent" label="Agent" value={agentId} onChange={(e) => resetPage(setAgentId)(e.target.value)}>
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <TextInput
              id="calls-from"
              label="From"
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && resetPage(setFrom)(e.target.value)}
            />
            <TextInput
              id="calls-to"
              label="To"
              type="date"
              value={to}
              min={from}
              onChange={(e) => e.target.value && resetPage(setTo)(e.target.value)}
            />
          </div>

          {error ? (
            <ErrorNote message={error} onRetry={load} />
          ) : loading && !data ? (
            <AiLoading label="Loading calls…" />
          ) : (
            <div className={loading ? 'opacity-60' : ''}>
              <Table
                rows={data?.items ?? []}
                rowKey={(c) => c.sessionId}
                onRowClick={(c) => router.push(`/dashboard/ai/calls/${c.sessionId}`)}
                empty={
                  <Empty
                    title="No calls in this period"
                    body="Calls from the playground and from your API show up here."
                  />
                }
                columns={[
                  {
                    key: 'date',
                    label: 'Date',
                    render: (c) => (
                      // A real link keeps the row reachable by keyboard.
                      <Link href={`/dashboard/ai/calls/${c.sessionId}`} onClick={(e) => e.stopPropagation()}>
                        {fmtDateTime(c.date)}
                      </Link>
                    ),
                  },
                  { key: 'agent', label: 'Agent', render: (c) => c.agentName ?? '—' },
                  {
                    key: 'participant',
                    label: 'Participant',
                    className: 'max-w-[240px] truncate text-[#6B6478]',
                    render: (c) => (c.participantName ? `${c.participantName} (${c.participantId})` : c.participantId),
                  },
                  { key: 'duration', label: 'Duration', align: 'right', render: (c) => formatDuration(c.durationSeconds) },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (c) => {
                      const badge = sessionStatusBadge(c.status);
                      return <Pill tone={pillTone(badge.tone)}>{badge.label}</Pill>;
                    },
                  },
                  {
                    key: 'ended',
                    label: 'Ended by',
                    className: 'text-[#6B6478]',
                    render: (c) => terminationLabel(c.terminationReason),
                  },
                  {
                    key: 'credits',
                    label: 'Credits',
                    align: 'right',
                    render: (c) => (c.creditsCharged == null ? '—' : fmtNumber(c.creditsCharged)),
                  },
                  { key: 'tools', label: 'Tool calls', align: 'right', render: (c) => c.toolCallCount },
                ]}
              />
              {data && (
                <Pager page={data.page} pageCount={pages} total={data.total} onChange={(p) => !loading && setPage(p)} />
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
