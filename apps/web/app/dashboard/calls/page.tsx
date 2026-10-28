'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import {
  Block,
  DetailList,
  Drawer,
  Empty,
  PageHeader,
  Pager,
  Pill,
  Segmented,
  Table,
  fmtDateTime,
  inputCls,
  useResource,
} from '../_ui';
import { STATUS_FILTERS, callDuration, callStatus, callTypeLabel, type CallRow } from './call-format';

type CallPage = { data: CallRow[]; total: number; page: number; pageCount: number };

const EVENT_LABEL: Record<string, string> = {
  CALL_CREATED: 'Call created',
  CALL_STARTED: 'Call started',
  CALL_ENDED: 'Call ended',
  CALL_EXPIRED: 'Call expired',
  PARTICIPANT_JOINED: 'Participant joined',
  PARTICIPANT_LEFT: 'Participant left',
};
const eventLabel = (e: string) =>
  EVENT_LABEL[e] ?? e.charAt(0) + e.slice(1).toLowerCase().replace(/_/g, ' ');

export default function CallsPage() {
  return (
    <Suspense fallback={null}>
      <CallsView />
    </Suspense>
  );
}

function CallsView() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params?.get('call') ?? null;

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const calls = useResource(() => {
    const q = new URLSearchParams({ page: String(page) });
    if (query) q.set('search', query);
    if (status !== 'ALL') q.set('status', status);
    return api.get<CallPage>(`/dashboard/calls?${q}`).then((r) => r.data);
  }, [page, query, status]);

  const detail = useResource(
    () => (openId ? api.get<CallRow>(`/dashboard/calls/${openId}`).then((r) => r.data) : Promise.resolve(null)),
    [openId],
  );

  const open = (id: string | null) => router.replace(id ? `/dashboard/calls?call=${id}` : '/dashboard/calls');

  return (
    <>
      <PageHeader title="Calls" description="Every call across your projects." />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative md:w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9C95A8]" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search call ID, participant or project"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search calls"
          />
        </div>
        <div className="overflow-x-auto">
          <Segmented
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={STATUS_FILTERS}
          />
        </div>
      </div>

      <Block res={calls} loadingLabel="Loading calls…">
        {(res) => (
          <>
            <Table
              rows={res.data}
              rowKey={(c) => c.id}
              onRowClick={(c) => open(c.id)}
              empty={
                <Empty
                  title={query || status !== 'ALL' ? 'No calls match these filters' : 'No calls yet'}
                  body={query || status !== 'ALL' ? 'Try a different search or status.' : 'Calls you start from your app will appear here.'}
                />
              }
              columns={[
                { key: 'time', label: 'Started', render: (c) => fmtDateTime(c.createdAt) },
                { key: 'type', label: 'Type', render: (c) => callTypeLabel(c.type) },
                {
                  key: 'status',
                  label: 'Status',
                  render: (c) => <Pill tone={callStatus(c.status).tone}>{callStatus(c.status).label}</Pill>,
                },
                { key: 'project', label: 'Project', render: (c) => c.project?.name ?? '—' },
                {
                  key: 'participants',
                  label: 'Participants',
                  className: 'max-w-[220px] truncate text-[#6B6478]',
                  render: (c) => `${c.callerName || c.callerId} → ${c.receiverName || c.receiverId}`,
                },
                { key: 'duration', label: 'Duration', align: 'right', render: (c) => callDuration(c) },
                { key: 'id', label: 'Call ID', mono: true, className: 'text-[#6B6478]', render: (c) => c.id.slice(0, 8) },
              ]}
            />
            <Pager page={res.page} pageCount={res.pageCount} total={res.total} onChange={setPage} />
          </>
        )}
      </Block>

      {openId && (
        <Drawer title="Call details" onClose={() => open(null)}>
          <Block res={detail}>
            {(c) =>
              c && (
                <>
                  <DetailList
                    items={[
                      { label: 'Status', value: <Pill tone={callStatus(c.status).tone}>{callStatus(c.status).label}</Pill> },
                      { label: 'Type', value: callTypeLabel(c.type) },
                      { label: 'Project', value: c.project?.name ?? '—' },
                      { label: 'Caller', value: c.callerName || c.callerId, mono: !c.callerName },
                      { label: 'Receiver', value: c.receiverName || c.receiverId, mono: !c.receiverName },
                      { label: 'Started', value: fmtDateTime(c.startedAt ?? c.createdAt) },
                      { label: 'Ended', value: fmtDateTime(c.endedAt) },
                      { label: 'Duration', value: callDuration(c) },
                      { label: 'Call ID', value: c.id, mono: true },
                    ]}
                  />
                  {c.events && c.events.length > 0 && (
                    <div className="mt-8">
                      <h3 className="mb-3 text-sm font-semibold text-[#170B2E]">Timeline</h3>
                      <ol className="space-y-3 border-l border-[#ECE8F2] pl-4">
                        {c.events.map((ev) => (
                          <li key={ev.id} className="relative">
                            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[#7F40E8]" />
                            <p className="text-sm text-[#170B2E]">{eventLabel(ev.event)}</p>
                            <p className="text-xs text-[#6B6478]">{fmtDateTime(ev.createdAt)}</p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              )
            }
          </Block>
        </Drawer>
      )}
    </>
  );
}
