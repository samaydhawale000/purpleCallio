'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { formatCredits } from '../../lib/billing';
import { formatMinutes } from '../../lib/duration';
import { useCanWrite } from '../../lib/admin-access';
import { Block, Empty, PageHeader, Pager, Pill, Table, buttonCls, fmtDate, fmtNumber, useResource } from '../../dashboard/_ui';

type Customer = { id: string; name: string | null; email: string; companyName: string | null; profileCompleted: boolean; plan: string | null; planType: 'FREE' | 'PAID' | 'CUSTOM' | null; creditBalance: number; status: string; lastActiveAt: string | null; projectCount: number; minutesUsed: number };
type CustomerPage = { data: Customer[]; total: number; page: number; pageCount: number; pageSize?: number };

export default function AdminCustomersPage() {
  const canWrite = useCanWrite();
  const [page, setPage] = useState(1);
  const customers = useResource(
    () => api.get<CustomerPage>(`/admin/customers?page=${page}`).then((r) => r.data),
    [page],
    (e: any) => e?.response?.data?.message || e?.message || 'Failed to load',
  );

  const update = async (id: string, path: string, body: object) => {
    await api.patch(`/admin/customers/${id}/${path}`, body);
    void customers.reload();
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description={customers.data ? `${fmtNumber(customers.data.total ?? 0)} registered companies` : 'Registered companies'}
      />
      <Block res={customers} loadingLabel="Loading customers…">
        {(res) => (
          <>
            <Table
              rows={res.data ?? []}
              rowKey={(c) => c.id}
              empty={<Empty title="No customers yet." />}
              columns={[
                {
                  key: 'company',
                  label: 'Company',
                  render: (c) => (
                    <span className="inline-flex items-center gap-2">
                      <Link href={`/admin/customers/${c.id}`} className="font-medium text-[#170B2E] hover:text-[#5B21B6] hover:underline">
                        {c.companyName || c.name || 'Unnamed'}
                      </Link>
                      {!c.profileCompleted && <Pill tone="warning">Profile incomplete</Pill>}
                    </span>
                  ),
                },
                {
                  key: 'owner',
                  label: 'Owner',
                  render: (c) => (
                    <div className="leading-tight">
                      {c.companyName && c.name ? <p className="text-[#170B2E]">{c.name}</p> : null}
                      <p className="text-[13px] text-[#6B6478]">{c.email}</p>
                    </div>
                  ),
                },
                {
                  key: 'plan',
                  label: 'Plan',
                  render: (c) => <Pill tone={c.planType && c.planType !== 'FREE' ? 'accent' : 'neutral'}>{c.plan ?? 'Free'}</Pill>,
                },
                { key: 'credits', label: 'Credits', align: 'right', render: (c) => formatCredits(c.creditBalance) },
                { key: 'projects', label: 'Projects', align: 'right', render: (c) => c.projectCount },
                { key: 'time', label: 'Call time', align: 'right', render: (c) => formatMinutes(c.minutesUsed) },
                { key: 'active', label: 'Last active', className: 'text-[#6B6478]', render: (c) => fmtDate(c.lastActiveAt) },
                {
                  key: 'status',
                  label: 'Status',
                  render: (c) => <Pill tone={c.status === 'ACTIVE' ? 'success' : c.status === 'SUSPENDED' ? 'danger' : 'neutral'}>{c.status}</Pill>,
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  align: 'right',
                  render: (c) =>
                    canWrite && (
                      <button
                        type="button"
                        onClick={() => update(c.id, 'status', { status: c.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' })}
                        className={buttonCls(c.status === 'ACTIVE' ? 'danger' : 'secondary', 'px-2.5 py-1 text-xs')}
                      >
                        {c.status === 'ACTIVE' ? 'Suspend' : 'Resume'}
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
