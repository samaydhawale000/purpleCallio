'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CUSTOM_PLAN_STATUS_LABEL, CUSTOM_PLAN_STATUSES, listCustomPlans } from '../../../lib/admin-billing';
import { formatDate } from '../../../lib/billing';
import { Pagination } from '../../../components/ui/Pagination';
import { SearchBox } from './SubscriptionsTab';
import { ErrorText, inputCls, Panel, rowCls, Spinner, StatusBadge, Table, tdCls, useResource } from './ui';

export function CustomPlansTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('OPEN');
  const [search, setSearch] = useState('');
  const { data, loading, error } = useResource(() => listCustomPlans({ page, status, search }), [page, status, search]);

  return (
    <Panel title="Custom plan requests" subtitle="Customers who asked to talk to our team. Each request is a support conversation plus sales details.">
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <SearchBox placeholder="Search customer or company… (Enter)" onSearch={(q) => { setPage(1); setSearch(q); }} />
        <select aria-label="Status" className={`${inputCls} w-auto`} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="OPEN">Open</option>
          <option value="">All</option>
          {CUSTOM_PLAN_STATUSES.map((s) => (
            <option key={s} value={s}>{CUSTOM_PLAN_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      {loading ? (
        <Spinner tall={false} />
      ) : error || !data ? (
        <ErrorText>{error || 'Failed to load'}</ErrorText>
      ) : (
        <>
          <Table
            headers={['Customer', 'Company', 'Status', 'Assignee', 'Offers', 'Conversation', 'Requested']}
            empty={data.data.length === 0 ? 'No custom plan requests match these filters.' : undefined}
          >
            {data.data.map((r) => (
              <tr key={r.id} className={rowCls} style={r.hasUnread ? { background: 'rgba(127,64,232,0.04)' } : undefined}>
                <td className={tdCls}>
                  <Link href={`/admin/billing/custom-plans/${r.id}`} className={`text-[#170B2E] hover:text-[#6425C4] ${r.hasUnread ? 'font-semibold' : ''}`}>
                    {r.customer.name || r.customer.email}
                  </Link>
                  <div className="text-[11px]">{r.customer.email}</div>
                </td>
                <td className={tdCls}>{r.customer.companyName ?? '—'}</td>
                <td className={tdCls}><StatusBadge status={r.status} label={CUSTOM_PLAN_STATUS_LABEL[r.status]} /></td>
                <td className={tdCls}>{r.assignedAdmin ? r.assignedAdmin.name || r.assignedAdmin.email : <span className="text-[#6B6478]">Unassigned</span>}</td>
                <td className={tdCls}>{r.offers}</td>
                <td className={tdCls}>
                  <Link href={`/admin/support/${r.ticketId}`} className="font-mono text-xs text-[#6425C4] hover:text-[#170B2E]">
                    {r.ticketNumber}
                  </Link>
                  {r.hasUnread && (
                    <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#7F40E8] text-white" aria-label="Unread">
                      New
                    </span>
                  )}
                </td>
                <td className={`${tdCls} whitespace-nowrap`}>{formatDate(r.requestedAt)}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageCount={data.pageCount} totalItems={data.total} pageSize={data.pageSize} onPageChange={setPage} />
        </>
      )}
    </Panel>
  );
}
