'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Inbox, RefreshCw, Search, SearchX, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { useRealtimeEvent } from '../../lib/realtime';
import { TICKET_STATUSES, type SupportTicket, type TicketStatus } from '../../lib/support';
import { Pagination } from '../../components/ui/Pagination';
import { TicketStatusBadge, ticketStatusLabel } from '../../components/support/TicketStatusBadge';
import { NewMessageTag, UnreadDot } from '../../components/support/UnreadIndicators';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
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
  const [pageSize, setPageSize] = useState(10);
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
        setPageSize(res.data.pageSize ?? 10);
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[#170B2E]">Support</h1>
        <p className="text-[#3D3650] text-sm mt-1">Customer support tickets</p>
      </header>

      <div className="flex flex-wrap gap-3">
        <form onSubmit={submitSearch} className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D3650]" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search ticket #, subject, customer… (Enter)"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm text-[#170B2E] placeholder:text-[#6B6478] bg-white border border-[#D6C4EE] outline-none focus:border-[#7F40E8]/60"
          />
        </form>
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as TicketStatus | '');
          }}
          className="px-3 py-2.5 rounded-lg text-sm text-[#170B2E] bg-white border border-[#D6C4EE] outline-none focus:border-[#7F40E8]/60"
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
          className="px-3 py-2.5 rounded-lg text-sm text-[#170B2E] bg-white border border-[#D6C4EE] outline-none focus:border-[#7F40E8]/60"
        >
          <option value="">All types</option>
          <option value="CUSTOM_PLAN">Custom plan</option>
        </select>
      </div>

      {loading ? (
        <div className="text-[#3D3650] text-sm py-20 text-center">Loading tickets…</div>
      ) : failed ? (
        <EmptyState
          icon={TriangleAlert}
          tone="error"
          title="Couldn't load tickets"
          body="Something went wrong while contacting the support service. Please try again."
          action={
            <Button variant="secondary" onClick={() => load()}>
              <RefreshCw size={15} className="mr-1.5" /> Try again
            </Button>
          }
        />
      ) : tickets.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No matching tickets"
            body="No tickets match your search or filters."
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="No support tickets yet"
            body="When customers create tickets from their dashboard, they'll appear here."
          />
        )
      ) : (
        <div className="rounded-xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#FFFFFF' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E7DFF5] text-left">
                  {['Ticket', 'Customer', 'Subject', 'Status', 'Last updated', 'Created'].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[#E7DFF5]/60 hover:bg-[#7F40E8]/[0.03]"
                    style={t.hasUnread ? { background: 'rgba(127,64,232,0.04)' } : undefined}
                  >
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                      <UnreadDot unread={t.hasUnread} />
                      <Link href={`/admin/support/${t.id}`} className="text-[#6425C4] hover:text-[#170B2E]">
                        {t.ticketNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[#170B2E]">{t.customer.name || t.customer.email}</p>
                      <p className="text-xs text-[#3D3650]">
                        {t.customer.companyName ? `${t.customer.companyName} · ` : ''}{t.customer.email}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[#170B2E] max-w-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          href={`/admin/support/${t.id}`}
                          className={`hover:text-[#6425C4] line-clamp-1 ${t.hasUnread ? 'font-semibold' : ''}`}
                        >
                          {t.subject}
                        </Link>
                        {t.type === 'CUSTOM_PLAN' && <CustomPlanBadge />}
                        {t.hasUnread && <NewMessageTag label="New" />}
                      </div>
                    </td>
                    <td className="px-4 py-3"><TicketStatusBadge status={t.status} /></td>
                    <td className="px-4 py-3 text-[#3D3650] whitespace-nowrap">{new Date(t.updatedAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-[#3D3650] whitespace-nowrap">{new Date(t.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <Pagination
              page={page}
              pageCount={pageCount}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
