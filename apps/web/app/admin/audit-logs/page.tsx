'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { Block, Empty, PageHeader, Pager, Pill, Table, fmtDateTime, useResource, type Tone } from '../../dashboard/_ui';

type AuditLog = {
  id: string;
  action: string;
  actor: string;
  metadata: any;
  createdAt: string;
};
type AuditLogPage = { data: AuditLog[]; total: number; page: number; pageCount: number; pageSize?: number };

const ACTION_TONES: Record<string, Tone> = {
  USER_REGISTERED: 'accent',
  PROJECT_CREATED: 'accent',
  PLAN_CHANGED: 'warning',
  ACCOUNT_SUSPENDED: 'danger',
  ACCOUNT_RESUMED: 'success',
};

const actionLabel = (a: string) => a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, ' ');

export default function AdminAuditLogsPage() {
  const [page, setPage] = useState(1);
  const logs = useResource(
    () => api.get<AuditLogPage>(`/admin/audit-logs?page=${page}`).then((r) => r.data),
    [page],
    (e: any) => e?.response?.data?.message || e?.message || 'Failed to load',
  );

  return (
    <>
      <PageHeader title="Audit logs" description="Recent platform activity" />
      <Block res={logs} loadingLabel="Loading audit logs…">
        {(res) => (
          <>
            <Table
              rows={res.data ?? []}
              rowKey={(l) => l.id}
              empty={<Empty title="No audit logs yet." />}
              columns={[
                {
                  key: 'action',
                  label: 'Action',
                  render: (l) => <Pill tone={ACTION_TONES[l.action] ?? 'neutral'}>{actionLabel(l.action)}</Pill>,
                },
                { key: 'actor', label: 'Actor', render: (l) => l.actor },
                {
                  key: 'details',
                  label: 'Details',
                  mono: true,
                  className: 'max-w-[420px] truncate text-xs text-[#6B6478]',
                  render: (l) => {
                    const text = l.metadata ? JSON.stringify(l.metadata) : '—';
                    return <span title={l.metadata ? text : undefined}>{text}</span>;
                  },
                },
                { key: 'time', label: 'Timestamp', className: 'text-[#6B6478]', render: (l) => fmtDateTime(l.createdAt) },
              ]}
            />
            <Pager page={res.page ?? page} pageCount={res.pageCount ?? 1} total={res.total ?? 0} onChange={setPage} />
          </>
        )}
      </Block>
    </>
  );
}
