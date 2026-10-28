'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Check, Copy, Power, Trash2 } from 'lucide-react';
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
import { PageHeader, Panel, Pill, buttonCls } from '../../_ui';
import { ToastHost, ToastState } from '../../billing/Toast';
import { AgentForm } from '../_components/AgentForm';
import { AiDisabledNotice, AiLoading, AiUpgradeCard, BackLink } from '../_components/AiNotices';
import { ToolsPanel } from '../_components/ToolsPanel';
import { TranscriptSettings } from '../_components/TranscriptSettings';
import { VersionHistory } from '../_components/VersionHistory';

type Tab = 'configuration' | 'tools';

const TABS: { id: Tab; label: string }[] = [
  { id: 'configuration', label: 'Configuration' },
  { id: 'tools', label: 'Tools' },
];

/** The id integrators pass as `agentId` to POST /ai/sessions. */
function AgentIdField({ agentId }: { agentId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(agentId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Panel className="mb-8 flex flex-col gap-2">
      <span className="text-[13px] text-[#6B6478]">Agent ID</span>
      <div className="flex flex-wrap items-center gap-2">
        <code
          data-testid="agent-id"
          className="min-w-0 flex-1 break-all rounded-lg border border-[#ECE8F2] bg-white px-3 py-2 font-mono text-[13px] text-[#170B2E]"
        >
          {agentId}
        </code>
        <button type="button" className={buttonCls('secondary', 'px-3 py-1.5 text-[13px]')} onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-xs text-[#6B6478]">
        Pass this as <code className="font-mono">agentId</code> when your server creates a session with{' '}
        <code className="font-mono">POST /ai/sessions</code>.{' '}
        <Link href="/docs/ai-agents#server-session" className="font-medium text-[#5B21B6] hover:underline">
          Integration guide
        </Link>
      </p>
    </Panel>
  );
}

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

  const back = <BackLink href="/dashboard/ai">AI Agents</BackLink>;

  if (statusLoading) return <AiLoading label="Loading agent…" />;
  if (!enabled) {
    return (
      <div>
        {back}
        <AiDisabledNotice />
      </div>
    );
  }
  if (notFound) {
    return (
      <div>
        {back}
        <p className="text-sm text-[#6B6478]">This agent doesn&apos;t exist or was deleted.</p>
      </div>
    );
  }
  if (!agent) return <AiLoading label="Loading agent…" />;

  return (
    <div className="max-w-5xl">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      {back}
      <PageHeader
        title={
          <span className="inline-flex min-w-0 items-center gap-2.5">
            <span className="truncate">{agent.name}</span>
            <Pill tone={agent.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {agent.status === 'ACTIVE' ? 'Active' : 'Disabled'}
            </Pill>
          </span>
        }
        description={agent.description || undefined}
        actions={
          <>
            {(agent.status === 'ACTIVE' || paidPlan) && (
              <button type="button" className={buttonCls('secondary')} onClick={toggleStatus} disabled={busy}>
                <Power size={14} /> {agent.status === 'ACTIVE' ? 'Disable' : 'Enable'}
              </button>
            )}
            <button type="button" className={buttonCls('danger')} onClick={remove} disabled={busy}>
              <Trash2 size={14} /> Delete
            </button>
          </>
        }
      />

      <AgentIdField agentId={agent.id} />

      {!paidPlan && <AiUpgradeCard />}

      <div role="tablist" className="mb-6 flex gap-6 border-b border-[#ECE8F2]">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${
              tab === t.id
                ? 'border-[#7F40E8] font-medium text-[#170B2E]'
                : 'border-transparent text-[#6B6478] hover:text-[#170B2E]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'configuration' && (
        <div className="flex flex-col gap-8">
          <Panel>
            <AgentForm
              // Re-seed the form from the server copy after a save (but not
              // after an enable/disable, which would drop unsaved edits).
              key={`${agent.currentVersionId}:${agent.name}:${agent.description}`}
              initial={agentToForm(agent)}
              submitLabel="Save changes"
              onSubmit={save}
              providers={status?.providers}
            />
          </Panel>
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
    </div>
  );
}
