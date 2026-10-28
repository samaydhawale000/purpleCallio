'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useRealtimeEvent } from '../../lib/realtime';
import { TICKET_STATUSES, type SupportTicket, type TicketStatus } from '../../lib/support';
import { TicketStatusBadge, ticketStatusLabel } from '../../components/support/TicketStatusBadge';
import {
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  Pager,
  Pill,
  Table,
  buttonCls,
  fmtDate,
  fmtDateTime,
  inputCls,
} from '../../dashboard/_ui';
import { CustomPlanBadge } from './_components/CustomPlanContext';

type AdminTicket = SupportTicket & {
  type?: 'GENERAL' | 'CUSTOM_PLAN';
  customer: { id: string; name: string | null; email: string; companyName: string | null };
};

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [type, setType] = useState<'' | 'CUSTOM_PLAN'>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  // `silent` refreshes in place (realtime pushes) without the loading state.
  const load = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFailed(false);
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    api
      .get(`/admin/support/tickets?${params}`)
      .then((res) => {
        setTickets(res.data.data ?? []);
        setTotal(res.data.total ?? 0);
        setPageCount(res.data.pageCount ?? 1);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [page, search, status, type]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeEvent('support:ticket-updated', () => load({ silent: true }));

  const filtered = !!search || !!status || !!type;

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setType('');
    setPage(1);
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const selectCls = `${inputCls} w-auto`;

  return (
    <>
      <PageHeader title="Support" description="Customer support tickets" />

      <div className="mb-4 flex flex-wrap gap-3">
        <form onSubmit={submitSearch} className="relative min-w-[220px] max-w-md flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9C95A8]" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search ticket #, subject, customer… (Enter)"
            aria-label="Search tickets"
            className={`${inputCls} pl-9`}
          />
        </form>
        <select
          aria-label="Ticket status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as TicketStatus | '');
          }}
          className={selectCls}
        >
          <option value="">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>{ticketStatusLabel(s)}</option>
          ))}
        </select>
        <select
          aria-label="Ticket type"
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value as '' | 'CUSTOM_PLAN');
          }}
          className={selectCls}
        >
          <option value="">All types</option>
          <option value="CUSTOM_PLAN">Custom plan</option>
        </select>
      </div>

      {loading ? (
        <Loading label="Loading tickets…" />
      ) : failed ? (
        <ErrorNote
          message="Couldn't load tickets. Something went wrong while contacting the support service."
          onRetry={() => load()}
        />
      ) : (
        <>
          <Table
            rows={tickets}
            rowKey={(t) => t.id}
            empty={
              filtered ? (
                <Empty
                  title="No matching tickets"
                  body="No tickets match your search or filters."
                  action={
                    <button type="button" className={buttonCls('secondary')} onClick={clearFilters}>
                      Clear filters
                    </button>
                  }
                />
              ) : (
                <Empty
                  title="No support tickets yet"
                  body="When customers create tickets from their dashboard, they'll appear here."
                />
              )
            }
            columns={[
              {
                key: 'ticket',
                label: 'Ticket',
                render: (t) => (
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${t.hasUnread ? 'bg-[#7F40E8]' : 'bg-transparent'}`}
                      aria-label={t.hasUnread ? 'Unread' : undefined}
                    />
                    <Link href={`/admin/support/${t.id}`} className="font-mono text-[13px] text-[#5B21B6] hover:underline">
                      {t.ticketNumber}
                    </Link>
                  </span>
                ),
              },
              {
                key: 'customer',
                label: 'Customer',
                render: (t) => (
                  <div className="leading-tight">
                    <p className="text-[#170B2E]">{t.customer.name || t.customer.email}</p>
                    <p className="text-xs text-[#6B6478]">
                      {t.customer.companyName ? `${t.customer.companyName} · ` : ''}{t.customer.email}
                    </p>
                  </div>
                ),
              },
              {
                key: 'subject',
                label: 'Subject',
                render: (t) => (
                  <div className="flex min-w-0 max-w-xs items-center gap-2">
                    <Link
                      href={`/admin/support/${t.id}`}
                      className={`truncate hover:text-[#5B21B6] ${t.hasUnread ? 'font-semibold' : ''}`}
                    >
                      {t.subject}
                    </Link>
                    {t.type === 'CUSTOM_PLAN' && <CustomPlanBadge />}
                    {t.hasUnread && <Pill tone="accent">New</Pill>}
                  </div>
                ),
              },
              { key: 'status', label: 'Status', render: (t) => <TicketStatusBadge status={t.status} /> },
              { key: 'updated', label: 'Last updated', className: 'text-[#6B6478]', render: (t) => fmtDateTime(t.updatedAt) },
              { key: 'created', label: 'Created', className: 'text-[#6B6478]', render: (t) => fmtDate(t.createdAt) },
            ]}
          />
          <Pager page={page} pageCount={pageCount} total={total} onChange={setPage} />
        </>
      )}
    </>
  );
}
