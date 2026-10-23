'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { api } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { MODE_LABEL } from '../../../lib/translation';
import { Card, ErrorBox, Loading, NoProjects, PageHeader, ProjectPicker, TranslationNav, useProjects } from '../_components/shared';

interface CallRow {
  id: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  callerLanguage?: string | null;
  receiverLanguage?: string | null;
  translationMode?: string | null;
}

const isTranslated = (c: CallRow) => !!c.translationMode && c.translationMode.toUpperCase() !== 'OFF';

/** Recent translated calls with links to their Post-Call Suite reports. */
export default function TranslationCallsPage() {
  const router = useRouter();
  const { projects, projectId, setProjectId, error: projectsError, loading: projectsLoading } = useProjects();
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [error, setError] = useState('');
  const [callId, setCallId] = useState('');

  const load = useCallback(() => {
    if (!projectId) return;
    setCalls(null);
    setError('');
    api
      .get('/dashboard/calls', { params: { page, projectId } })
      .then((r) => {
        setCalls(((r.data?.data ?? []) as CallRow[]).filter(isTranslated));
        setPageCount(r.data?.pageCount ?? 1);
      })
      .catch(() => setError('Could not load calls. Please try again.'));
  }, [projectId, page]);

  useEffect(load, [load]);

  const open = (e: FormEvent) => {
    e.preventDefault();
    const id = callId.trim();
    if (id) router.push(`/dashboard/translation/calls/${encodeURIComponent(id)}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Calls & reports"
        subtitle="Post-Call Suite reports for translated calls: transcript, summary in each language, action items and signals."
        actions={projects && projects.length > 0 ? <ProjectPicker projects={projects} value={projectId} onChange={(id) => { setPage(1); setProjectId(id); }} /> : undefined}
      />
      <TranslationNav />

      <Card title="Open a report by call ID">
        <form onSubmit={open} className="flex flex-wrap items-end gap-3">
          <div className="w-80 max-w-full">
            <Input label="Call ID" placeholder="call_…" value={callId} onChange={(e) => setCallId(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" disabled={!callId.trim()}>Open report</Button>
        </form>
      </Card>

      {projectsLoading ? (
        <Loading label="Loading projects…" />
      ) : projectsError ? (
        <ErrorBox>Could not load your projects. Please refresh the page.</ErrorBox>
      ) : !projects?.length ? (
        <NoProjects />
      ) : error ? (
        <ErrorBox onRetry={load}>{error}</ErrorBox>
      ) : !calls ? (
        <Loading label="Loading calls…" />
      ) : (
        <Card title="Translated calls" subtitle={pageCount > 1 ? `Page ${page} of ${pageCount} of this project's calls` : undefined}>
          {calls.length === 0 ? (
            <p className="text-sm text-[#3D3650] py-6 text-center">No translated calls on this page.</p>
          ) : (
            <ul className="divide-y divide-[#E7DFF5]">
              {calls.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-mono text-xs text-[#3D3650]">{c.id}</span>
                  <Badge variant="purple">{MODE_LABEL[(c.translationMode ?? '').toLowerCase()] ?? c.translationMode}</Badge>
                  {c.callerLanguage && c.receiverLanguage && (
                    <span className="text-xs text-[#3D3650] font-mono">{c.callerLanguage} ⇄ {c.receiverLanguage}</span>
                  )}
                  <span className="text-xs text-[#3D3650]">{new Date(c.startedAt ?? c.createdAt).toLocaleString('en-IN')}</span>
                  <Link href={`/dashboard/translation/calls/${c.id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[#6425C4] hover:text-[#170B2E]">
                    View report <ArrowUpRight size={13} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {pageCount > 1 && (
            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
