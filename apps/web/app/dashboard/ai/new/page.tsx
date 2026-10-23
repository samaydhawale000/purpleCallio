'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../../lib/api';
import { AgentFormValues, EMPTY_AGENT_FORM, apiErrorMessages, buildCreateAgentPayload, useAiStatus } from '../../../lib/ai';
import { AgentForm } from '../_components/AgentForm';
import { AiDisabledNotice, AiLoading, AiUpgradeCard } from '../_components/AiNotices';
import { Select } from '../_components/fields';

interface Project {
  id: string;
  name: string;
}

export default function NewAiAgentPage() {
  const router = useRouter();
  const { status, loading } = useAiStatus();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    api
      .get('/projects')
      .then((res) => {
        const list: Project[] = res.data ?? [];
        setProjects(list);
        if (list.length > 0) setProjectId(list[0].id);
      })
      .catch(() => setProjects([]));
  }, []);

  async function create(values: AgentFormValues) {
    try {
      const res = await api.post('/ai/agents', buildCreateAgentPayload(projectId, values));
      router.push(`/dashboard/ai/${res.data.id}`);
    } catch (e) {
      return apiErrorMessages(e, 'Failed to create agent');
    }
  }

  if (loading || projects === null) return <AiLoading label="Loading…" />;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <Link href="/dashboard/ai" className="inline-flex items-center gap-1.5 text-sm text-[#3D3650] hover:text-[#170B2E]">
          <ArrowLeft size={15} /> AI Agents
        </Link>
        <h1 className="text-2xl font-bold text-[#170B2E] mt-2">New agent</h1>
      </div>
      {!status?.enabled ? (
        <AiDisabledNotice />
      ) : !status.paidPlan ? (
        <AiUpgradeCard />
      ) : projects.length === 0 ? (
        <p className="text-sm text-amber-700">You need a project first. Create one in the Projects page.</p>
      ) : (
        <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <AgentForm
            // Preselect a provider that can actually take calls.
            initial={{ ...EMPTY_AGENT_FORM, provider: status.providers?.[0] ?? '' }}
            submitLabel="Create agent"
            onSubmit={create}
            providers={status.providers}
            header={
              <Select id="agent-project" label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            }
          />
        </div>
      )}
    </div>
  );
}
