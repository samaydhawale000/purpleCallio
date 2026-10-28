'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { MODE_LABEL } from '../../../lib/translation';
import { Pill, Table, buttonCls, fmtDateTime, inputCls, type Column } from '../../_ui';
import { Empty, ErrorBox, Loading, NoProjects, PageHeader, ProjectPicker, TranslationNav, useProjects } from '../_components/shared';

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

const COLUMNS: Column<CallRow>[] = [
  { key: 'date', label: 'Date', render: (c) => fmtDateTime(c.startedAt ?? c.createdAt) },
  {
    key: 'pair',
    label: 'Languages',
    render: (c) => (c.callerLanguage && c.receiverLanguage ? `${c.callerLanguage} ⇄ ${c.receiverLanguage}` : '—'),
  },
  {
    key: 'mode',
    label: 'Mode',
    render: (c) => <Pill tone="accent">{MODE_LABEL[(c.translationMode ?? '').toLowerCase()] ?? c.translationMode}</Pill>,
  },
  { key: 'id', label: 'Call ID', mono: true, className: 'text-[#6B6478]', render: (c) => c.id },
  {
    key: 'report',
    label: '',
    align: 'right',
    render: (c) => (
      <Link href={`/dashboard/translation/calls/${c.id}`} className="text-sm font-medium text-[#5B21B6] hover:underline">
        View report
      </Link>
    ),
  },
];

/** Recent translated calls with links to their reports. */
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
    <>
      <PageHeader
        title="Calls & reports"
        subtitle="Translated calls and their post-call reports."
        actions={
          projects && projects.length > 0 ? (
            <ProjectPicker
              projects={projects}
              value={projectId}
              onChange={(id) => {
                setPage(1);
                setProjectId(id);
              }}
            />
          ) : undefined
        }
      />
      <TranslationNav />

      <form onSubmit={open} className="mb-6 flex flex-wrap items-center gap-2">
        <label htmlFor="report-call-id" className="text-[13px] text-[#6B6478]">
          Open a report by call ID
        </label>
        <input
          id="report-call-id"
          className={`${inputCls} w-64 max-w-full py-1.5`}
          placeholder="call_…"
          value={callId}
          onChange={(e) => setCallId(e.target.value)}
        />
        <button type="submit" className={buttonCls('secondary', 'py-1.5')} disabled={!callId.trim()}>
          Open report
        </button>
      </form>

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
        <>
          <Table
            columns={COLUMNS}
            rows={calls}
            rowKey={(c) => c.id}
            empty={<Empty title="No translated calls on this page">Calls that used captions or voice translation appear here.</Empty>}
          />
          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between text-[13px] text-[#6B6478]">
              <span>
                Page {page} of {pageCount}
              </span>
              <div className="flex gap-2">
                <button type="button" className={buttonCls('secondary', 'px-3 py-1.5')} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button
                  type="button"
                  className={buttonCls('secondary', 'px-3 py-1.5')}
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
