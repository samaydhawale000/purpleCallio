'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../../../lib/api';
import { AI_LANGUAGES, AiAgentVersion } from '../../../lib/ai';
import { Badge } from '../../../components/ui/Badge';

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
    <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <div className="flex items-center gap-2 mb-3">
        <History size={16} style={{ color: '#7F40E8' }} />
        <p className="text-sm font-semibold text-[#170B2E]">Version history</p>
      </div>
      {error ? (
        <p className="text-sm text-red-600">Could not load versions.</p>
      ) : versions === null ? (
        <p className="text-sm text-[#3D3650]">Loading…</p>
      ) : (
        <ul className="divide-y divide-[#E7DFF5]">
          {versions.map((v) => (
            <li key={v.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-mono text-[#170B2E]">v{v.version}</span>
              {v.id === currentVersionId && <Badge variant="purple">Current</Badge>}
              <span className="text-[#3D3650]">
                {AI_LANGUAGES.find((l) => l.id === v.language)?.label ?? v.language}
                {' · '}
                {v.voice || 'Default voice'}
                {' · '}
                {v.maxDurationSeconds % 60 === 0 ? `${v.maxDurationSeconds / 60} min` : `${v.maxDurationSeconds}s`} max
              </span>
              <span className="ml-auto text-xs text-[#6B6478]">{new Date(v.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
