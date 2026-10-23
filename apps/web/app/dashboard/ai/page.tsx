'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Plus, Power, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { AiAgent, apiErrorMessages, useAiStatus } from '../../lib/ai';
import { Badge } from '../../components/ui/Badge';
import { ToastHost, ToastState } from '../billing/Toast';
import { AiDisabledNotice, AiLoading, AiUpgradeCard } from './_components/AiNotices';
import { AiSectionNav } from './_components/AiSectionNav';

interface Project {
  id: string;
  name: string;
}

export default function AiAgentsPage() {
  const { status, loading: statusLoading } = useAiStatus();
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const enabled = status?.enabled === true;
  const paidPlan = status?.paidPlan === true;

  // Agents are listed per project; show every project's agents together.
  const load = useCallback(async () => {
    try {
      const projectsRes = await api.get('/projects');
      const list: Project[] = projectsRes.data ?? [];
      setProjects(list);
      const perProject = await Promise.all(
        list.map((p) => api.get('/ai/agents', { params: { projectId: p.id } }).then((r) => r.data as AiAgent[])),
      );
      setAgents(
        perProject.flat().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      );
    } catch (e) {
      setLoadError(apiErrorMessages(e, 'Failed to load agents')[0]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  async function toggle(agent: AiAgent) {
    setBusy(agent.id);
    try {
      const res = await api.patch(`/ai/agents/${agent.id}`, {
        status: agent.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
      });
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, ...res.data } : a)));
    } catch (e) {
      setToast({ id: Date.now(), type: 'error', message: apiErrorMessages(e, 'Failed to update agent')[0] });
    } finally {
      setBusy(null);
    }
  }

  async function remove(agent: AiAgent) {
    if (!confirm(`Delete agent "${agent.name}"? Past calls stay in your history.`)) return;
    setBusy(agent.id);
    try {
      await api.delete(`/ai/agents/${agent.id}`);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    } catch (e) {
      setToast({ id: Date.now(), type: 'error', message: apiErrorMessages(e, 'Failed to delete agent')[0] });
    } finally {
      setBusy(null);
    }
  }

  if (statusLoading || (enabled && loading)) return <AiLoading label="Loading agents…" />;

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="flex flex-col gap-6">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#170B2E]">AI Agents</h1>
          <p className="text-sm text-[#3D3650] mt-1">Voice agents your users can talk to in real time.</p>
        </div>
        {enabled && paidPlan && projects.length > 0 && (
          <Link
            href="/dashboard/ai/new"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2.5 rounded-lg"
            style={{ background: 'linear-gradient(135deg, #7F40E8 0%, #410686 100%)' }}
          >
            <Plus size={16} /> New agent
          </Link>
        )}
      </div>

      {!enabled ? (
        <AiDisabledNotice />
      ) : (
        <>
          <AiSectionNav />
          {!paidPlan && <AiUpgradeCard />}
          {loadError ? (
            <p className="text-sm text-red-600">{loadError}</p>
          ) : agents.length === 0 ? (
            <div className="rounded-2xl border border-[#E7DFF5] py-16 px-6 text-center" style={{ background: '#FFFFFF' }}>
              <div
                className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
                style={{ background: 'rgba(65,6,134,0.1)', border: '1px solid rgba(65,6,134,0.2)' }}
              >
                <Bot size={24} style={{ color: '#A05DF9' }} />
              </div>
              <p className="text-base font-semibold text-[#170B2E] mb-1">No agents yet</p>
              <p className="text-sm text-[#3D3650] max-w-sm mx-auto">
                {projects.length === 0
                  ? 'You need a project first. Create one in the Projects page.'
                  : 'Create an agent, give it instructions, and talk to it in the playground.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E7DFF5] rounded-2xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#FFFFFF' }}>
              {agents.map((agent) => (
                <div key={agent.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(65,6,134,0.1)', border: '1px solid rgba(65,6,134,0.2)' }}
                  >
                    <Bot size={17} style={{ color: '#A05DF9' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/dashboard/ai/${agent.id}`} className="text-sm font-semibold text-[#170B2E] hover:text-[#7F40E8]">
                        {agent.name}
                      </Link>
                      <Badge variant={agent.status === 'ACTIVE' ? 'success' : 'default'}>
                        {agent.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                      </Badge>
                    </div>
                    <p className="text-xs text-[#3D3650] mt-0.5">
                      {projectName(agent.projectId)} · Updated {new Date(agent.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {(agent.status === 'ACTIVE' || paidPlan) && (
                      <button
                        onClick={() => toggle(agent)}
                        disabled={busy === agent.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[#3D3650] hover:text-[#170B2E] hover:bg-[#7F40E8]/5 disabled:opacity-40"
                      >
                        <Power size={14} /> {agent.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </button>
                    )}
                    <button
                      onClick={() => remove(agent)}
                      disabled={busy === agent.id}
                      className="p-2 rounded-lg text-[#3D3650] hover:text-red-600 hover:bg-red-500/5 disabled:opacity-40"
                      aria-label={`Delete ${agent.name}`}
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
