'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Power, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  AgentFormValues,
  AiAgent,
  AiAgentTool,
  agentToForm,
  apiErrorMessages,
  buildAgentPatch,
  useAiStatus,
} from '../../../lib/ai';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ToastHost, ToastState } from '../../billing/Toast';
import { AgentForm } from '../_components/AgentForm';
import { AgentPlayground } from '../_components/AgentPlayground';
import { AiDisabledNotice, AiLoading, AiUpgradeCard } from '../_components/AiNotices';
import { ToolsPanel } from '../_components/ToolsPanel';
import { TranscriptSettings } from '../_components/TranscriptSettings';
import { VersionHistory } from '../_components/VersionHistory';

type Tab = 'configuration' | 'tools' | 'playground';

const TABS: { id: Tab; label: string }[] = [
  { id: 'configuration', label: 'Configuration' },
  { id: 'tools', label: 'Tools' },
  { id: 'playground', label: 'Playground' },
];

export default function AiAgentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status, loading: statusLoading } = useAiStatus();
  const [agent, setAgent] = useState<AiAgent | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>('configuration');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const enabled = status?.enabled === true;
  const paidPlan = status?.paidPlan === true;

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/ai/agents/${id}`);
      setAgent(res.data);
    } catch {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  async function save(values: AgentFormValues) {
    if (!agent) return;
    const patch = buildAgentPatch(agentToForm(agent), values);
    if (Object.keys(patch).length === 0) {
      setToast({ id: Date.now(), type: 'success', message: 'No changes to save' });
      return;
    }
    try {
      const res = await api.patch(`/ai/agents/${agent.id}`, patch);
      const updated: AiAgent = res.data;
      const newVersion = updated.currentVersionId !== agent.currentVersionId;
      setAgent(updated);
      setToast({
        id: Date.now(),
        type: 'success',
        message: newVersion ? `Saved as version ${updated.currentVersion?.version}` : 'Saved',
      });
    } catch (e) {
      return apiErrorMessages(e, 'Failed to save agent');
    }
  }

  async function toggleStatus() {
    if (!agent) return;
    setBusy(true);
    try {
      const res = await api.patch(`/ai/agents/${agent.id}`, {
        status: agent.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
      });
      setAgent(res.data);
    } catch (e) {
      setToast({ id: Date.now(), type: 'error', message: apiErrorMessages(e, 'Failed to update agent')[0] });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!agent || !confirm(`Delete agent "${agent.name}"? Past calls stay in your history.`)) return;
    setBusy(true);
    try {
      await api.delete(`/ai/agents/${agent.id}`);
      router.push('/dashboard/ai');
    } catch (e) {
      setToast({ id: Date.now(), type: 'error', message: apiErrorMessages(e, 'Failed to delete agent')[0] });
      setBusy(false);
    }
  }

  const back = (
    <Link href="/dashboard/ai" className="inline-flex items-center gap-1.5 text-sm text-[#3D3650] hover:text-[#170B2E]">
      <ArrowLeft size={15} /> AI Agents
    </Link>
  );

  if (statusLoading) return <AiLoading label="Loading agent…" />;
  if (!enabled) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <AiDisabledNotice />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <p className="text-sm text-[#3D3650]">This agent doesn&apos;t exist or was deleted.</p>
      </div>
    );
  }
  if (!agent) return <AiLoading label="Loading agent…" />;

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <div className="flex flex-col gap-2">
        {back}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-2xl font-bold text-[#170B2E] truncate">{agent.name}</h1>
            <Badge variant={agent.status === 'ACTIVE' ? 'success' : 'default'}>
              {agent.status === 'ACTIVE' ? 'Active' : 'Disabled'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {(agent.status === 'ACTIVE' || paidPlan) && (
              <Button variant="secondary" size="sm" onClick={toggleStatus} disabled={busy}>
                <Power size={14} /> {agent.status === 'ACTIVE' ? 'Disable' : 'Enable'}
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        </div>
        {agent.description && <p className="text-sm text-[#3D3650]">{agent.description}</p>}
      </div>

      {!paidPlan && <AiUpgradeCard />}

      <div role="tablist" className="flex gap-1 border-b border-[#E7DFF5]">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm -mb-px border-b-2 transition-colors ${
              tab === t.id
                ? 'border-[#7F40E8] text-[#170B2E] font-medium'
                : 'border-transparent text-[#3D3650] hover:text-[#170B2E]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'configuration' && (
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
            <AgentForm
              // Re-seed the form from the server copy after a save (but not
              // after an enable/disable, which would drop unsaved edits).
              key={`${agent.currentVersionId}:${agent.name}:${agent.description}`}
              initial={agentToForm(agent)}
              submitLabel="Save changes"
              onSubmit={save}
              providers={status?.providers}
            />
          </div>
          <TranscriptSettings
            key={`${agent.storeTranscript}:${agent.transcriptRetentionDays}`}
            agent={agent}
            onSaved={(updated, message) => {
              setAgent(updated);
              setToast({ id: Date.now(), type: 'success', message });
            }}
            onError={(message) => setToast({ id: Date.now(), type: 'error', message })}
          />
          <VersionHistory agentId={agent.id} currentVersionId={agent.currentVersionId} />
        </div>
      )}

      {tab === 'tools' && (
        <ToolsPanel
          agentId={agent.id}
          tools={agent.tools ?? []}
          onChange={(tools: AiAgentTool[]) => setAgent((a) => (a ? { ...a, tools } : a))}
        />
      )}

      {tab === 'playground' && (
        <AgentPlayground agentId={agent.id} agentActive={agent.status === 'ACTIVE'} canStart={paidPlan} />
      )}
    </div>
  );
}
