'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { useCanWrite } from '../../lib/admin-access';
import { Block, Empty, PageHeader, Pager, Pill, Table, buttonCls, fmtNumber, useResource } from '../../dashboard/_ui';

type LiveCall = { id: string; type: 'AUDIO' | 'VIDEO'; status: string; startedAt: string | null; createdAt: string; company: string; participants: number; duration: number };
type LiveCallPage = { data: LiveCall[]; total: number; page: number; pageCount: number; pageSize?: number };

export default function AdminCallsPage() {
  const canWrite = useCanWrite();
  const [page, setPage] = useState(1);
  const calls = useResource(
    () => api.get<LiveCallPage>(`/admin/calls?page=${page}`).then((r) => r.data),
    [page],
    (e: any) => e?.response?.data?.message || e?.message || 'Failed to load',
  );

  const endCall = async (id: string) => {
    await api.patch(`/admin/calls/${id}/end`);
    void calls.reload();
  };

  return (
    <>
      <PageHeader
        title="Live calls"
        description={calls.data ? `${fmtNumber(calls.data.total ?? 0)} active calls` : 'Calls in progress right now'}
      />
      <Block res={calls} loadingLabel="Loading live calls…">
        {(res) => (
          <>
            <Table
              rows={res.data ?? []}
              rowKey={(c) => c.id}
              empty={<Empty title="No active calls right now." />}
              columns={[
                { key: 'id', label: 'Call ID', mono: true, className: 'text-[#6B6478]', render: (c) => c.id.slice(0, 8) },
                { key: 'company', label: 'Company', className: 'font-medium', render: (c) => c.company },
                { key: 'participants', label: 'Participants', align: 'right', render: (c) => c.participants },
                { key: 'type', label: 'Type', render: (c) => (c.type === 'VIDEO' ? 'Video' : 'Audio') },
                {
                  key: 'started',
                  label: 'Started at',
                  className: 'text-[#6B6478]',
                  render: (c) => (c.startedAt ? new Date(c.startedAt).toLocaleTimeString() : '—'),
                },
                { key: 'duration', label: 'Duration', align: 'right', render: (c) => `${Math.round(c.duration)} min` },
                { key: 'status', label: 'Status', render: (c) => <Pill tone="success">{c.status}</Pill> },
                {
                  key: 'actions',
                  label: 'Actions',
                  align: 'right',
                  render: (c) =>
                    canWrite && (
                      <button type="button" onClick={() => endCall(c.id)} className={buttonCls('danger', 'px-2.5 py-1 text-xs')}>
                        End Call
                      </button>
                    ),
                },
              ]}
            />
            <Pager page={res.page ?? page} pageCount={res.pageCount ?? 1} total={res.total ?? 0} onChange={setPage} />
          </>
        )}
      </Block>
    </>
  );
}
