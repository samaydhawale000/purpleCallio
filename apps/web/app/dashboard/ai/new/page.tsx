'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { AgentFormValues, EMPTY_AGENT_FORM, apiErrorMessages, buildCreateAgentPayload, useAiStatus } from '../../../lib/ai';
import { AgentForm } from '../_components/AgentForm';
import { AiDisabledNotice, AiLoading, AiUpgradeCard, BackLink } from '../_components/AiNotices';
import { Notice, PageHeader, Panel } from '../../_ui';
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
    <div className="max-w-4xl">
      <BackLink href="/dashboard/ai">AI Agents</BackLink>
      <PageHeader title="New agent" />
      {!status?.enabled ? (
        <AiDisabledNotice />
      ) : !status.paidPlan ? (
        <AiUpgradeCard />
      ) : projects.length === 0 ? (
        <Notice>You need a project first. Create one in the Projects page.</Notice>
      ) : (
        <Panel>
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
        </Panel>
      )}
    </div>
  );
}
