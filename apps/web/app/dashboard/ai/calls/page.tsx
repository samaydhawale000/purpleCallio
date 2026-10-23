'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, PhoneCall } from 'lucide-react';
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
import { Badge } from '../../../components/ui/Badge';
import { AiDisabledNotice, AiLoading } from '../_components/AiNotices';
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#170B2E]">AI Calls</h1>
        <p className="text-sm text-[#3D3650] mt-1">Every call your agents have taken.</p>
      </div>

      {!enabled ? (
        <AiDisabledNotice />
      ) : (
        <>
          <AiSectionNav />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
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
            <p className="text-sm text-red-600">{error}</p>
          ) : loading && !data ? (
            <AiLoading label="Loading calls…" />
          ) : !data || data.items.length === 0 ? (
            <div className="rounded-2xl border border-[#E7DFF5] py-16 px-6 text-center" style={{ background: '#FFFFFF' }}>
              <div
                className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
                style={{ background: 'rgba(65,6,134,0.1)', border: '1px solid rgba(65,6,134,0.2)' }}
              >
                <PhoneCall size={24} style={{ color: '#A05DF9' }} />
              </div>
              <p className="text-base font-semibold text-[#170B2E] mb-1">No calls in this period</p>
              <p className="text-sm text-[#3D3650] max-w-sm mx-auto">
                Calls from the playground and from your API show up here.
              </p>
            </div>
          ) : (
            <div className={`rounded-2xl border border-[#E7DFF5] overflow-hidden ${loading ? 'opacity-60' : ''}`} style={{ background: '#FFFFFF' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Agent</th>
                      <th className="px-4 py-3 font-medium">Participant</th>
                      <th className="px-4 py-3 font-medium">Duration</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Ended by</th>
                      <th className="px-4 py-3 font-medium text-right">Credits</th>
                      <th className="px-4 py-3 font-medium text-right">Tool calls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E7DFF5]">
                    {data.items.map((c) => {
                      const badge = sessionStatusBadge(c.status);
                      return (
                        <tr key={c.sessionId} className="hover:bg-[#F8F4FD]">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <Link href={`/dashboard/ai/calls/${c.sessionId}`} className="text-[#170B2E] hover:text-[#7F40E8] font-medium">
                              {new Date(c.date).toLocaleString()}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-[#3D3650]">{c.agentName ?? '—'}</td>
                          <td className="px-4 py-3 text-[#3D3650]">
                            {c.participantName ? `${c.participantName} (${c.participantId})` : c.participantId}
                          </td>
                          <td className="px-4 py-3 text-[#3D3650] tabular-nums">{formatDuration(c.durationSeconds)}</td>
                          <td className="px-4 py-3">
                            <Badge variant={badge.tone}>{badge.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-[#3D3650]">{terminationLabel(c.terminationReason)}</td>
                          <td className="px-4 py-3 text-[#3D3650] text-right tabular-nums">{c.creditsCharged ?? '—'}</td>
                          <td className="px-4 py-3 text-[#3D3650] text-right tabular-nums">{c.toolCallCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#E7DFF5] text-xs text-[#3D3650]">
                <span>
                  {data.total.toLocaleString('en-US')} call{data.total === 1 ? '' : 's'} · page {data.page} of {pages}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page <= 1 || loading}
                    className="p-1.5 rounded-md hover:bg-[#7F40E8]/5 disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= pages || loading}
                    className="p-1.5 rounded-md hover:bg-[#7F40E8]/5 disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
