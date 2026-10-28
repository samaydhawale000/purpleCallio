'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { AI_LANGUAGES, AiAgentVersion } from '../../../lib/ai';
import { Loading, Pill, Section, Table, fmtDateTime } from '../../_ui';

/** Read-only list of the agent's config versions, newest first. */
export function VersionHistory({
  agentId,
  currentVersionId,
}: {
  agentId: string;
  currentVersionId: string | null;
}) {
  const [versions, setVersions] = useState<AiAgentVersion[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/ai/agents/${agentId}/versions`)
      .then((res) => !cancelled && setVersions(res.data ?? []))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
    // currentVersionId changes after a save that created a version.
  }, [agentId, currentVersionId]);

  return (
    <Section title="Version history" className="mb-0">
      {error ? (
        <p className="text-sm text-red-600">Could not load versions.</p>
      ) : versions === null ? (
        <Loading className="py-4" />
      ) : (
        <Table
          rows={versions}
          rowKey={(v) => v.id}
          columns={[
            {
              key: 'version',
              label: 'Version',
              render: (v) => (
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono text-[13px]">v{v.version}</span>
                  {v.id === currentVersionId && <Pill tone="accent">Current</Pill>}
                </span>
              ),
            },
            {
              key: 'language',
              label: 'Language',
              render: (v) => AI_LANGUAGES.find((l) => l.id === v.language)?.label ?? v.language,
            },
            { key: 'voice', label: 'Voice', render: (v) => v.voice || 'Default voice' },
            {
              key: 'max',
              label: 'Max duration',
              render: (v) =>
                v.maxDurationSeconds % 60 === 0 ? `${v.maxDurationSeconds / 60} min` : `${v.maxDurationSeconds}s`,
            },
            {
              key: 'created',
              label: 'Created',
              align: 'right',
              className: 'text-[#6B6478]',
              render: (v) => fmtDateTime(v.createdAt),
            },
          ]}
        />
      )}
    </Section>
  );
}
