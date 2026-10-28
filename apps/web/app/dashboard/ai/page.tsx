'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Power, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { AiAgent, apiErrorMessages, useAiStatus } from '../../lib/ai';
import { Empty, ErrorNote, PageHeader, Pill, Table, buttonCls, fmtDateTime } from '../_ui';
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
    <>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <PageHeader
        title="AI Agents"
        description="Voice agents your users can talk to in real time."
        actions={
          enabled &&
          paidPlan &&
          projects.length > 0 && (
            <Link href="/dashboard/ai/new" className={buttonCls('primary')}>
              <Plus size={15} /> New agent
            </Link>
          )
        }
      />

      {!enabled ? (
        <AiDisabledNotice />
      ) : (
        <>
          <AiSectionNav />
          {!paidPlan && <AiUpgradeCard />}
          {loadError ? (
            <ErrorNote message={loadError} />
          ) : (
            <Table
              rows={agents}
              rowKey={(a) => a.id}
              empty={
                <Empty
                  title="No agents yet"
                  body={
                    projects.length === 0
                      ? 'You need a project first. Create one in the Projects page.'
                      : 'Create an agent, give it instructions, and talk to it in the playground.'
                  }
                />
              }
              columns={[
                {
                  key: 'name',
                  label: 'Name',
                  render: (agent) => (
                    <Link href={`/dashboard/ai/${agent.id}`} className="font-medium text-[#170B2E] hover:text-[#5B21B6]">
                      {agent.name}
                    </Link>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (agent) => (
                    <Pill tone={agent.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {agent.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                    </Pill>
                  ),
                },
                { key: 'project', label: 'Project', className: 'text-[#6B6478]', render: (a) => projectName(a.projectId) },
                { key: 'updated', label: 'Updated', className: 'text-[#6B6478]', render: (a) => fmtDateTime(a.updatedAt) },
                {
                  key: 'actions',
                  label: '',
                  align: 'right',
                  render: (agent) => (
                    <div className="flex items-center justify-end gap-1">
                      {(agent.status === 'ACTIVE' || paidPlan) && (
                        <button
                          onClick={() => toggle(agent)}
                          disabled={busy === agent.id}
                          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-[#6B6478] hover:bg-[#F7F6FA] hover:text-[#170B2E] disabled:opacity-40"
                        >
                          <Power size={14} /> {agent.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                      )}
                      <button
                        onClick={() => remove(agent)}
                        disabled={busy === agent.id}
                        className="rounded-md p-2 text-[#6B6478] hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        aria-label={`Delete ${agent.name}`}
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </>
  );
}
