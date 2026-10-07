'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Ticket, TriangleAlert } from 'lucide-react';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { api } from '../../lib/api';
import { useRealtimeEvent } from '../../lib/realtime';
import type { SupportTicket } from '../../lib/support';
import { Button } from '../../components/ui/Button';
import { TicketStatusBadge } from '../../components/support/TicketStatusBadge';
import { NewMessageTag, UnreadDot } from '../../components/support/UnreadIndicators';
import { EmptyState } from '../../components/ui/EmptyState';
import { CustomPlanBadge } from '../../components/support/CustomPlanBadge';

export default function SupportPage() {
  const { isAuthed } = useRequireAuth();
  const [tickets, setTickets] = useState<(SupportTicket & { type?: 'GENERAL' | 'CUSTOM_PLAN' })[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // `silent` refreshes in place (realtime pushes) without the loading state.
  const load = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setFailed(false);
    api
      .get('/support/tickets')
      .then((res) => setTickets(Array.isArray(res.data) ? res.data : []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isAuthed) load();
  }, [isAuthed, load]);

  useRealtimeEvent('support:ticket-updated', () => load({ silent: true }));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-[#7F40E8]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-[#3D3650]">Loading tickets…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#170B2E]">Support</h1>
          <p className="text-sm text-[#3D3650] mt-1">
            Report integration or development issues and follow up with our team.
          </p>
        </div>
        <Link href="/dashboard/support/new">
          <Button>
            <Plus size={16} className="mr-1.5" /> Create Ticket
          </Button>
        </Link>
      </div>

      {failed ? (
        <EmptyState
          icon={TriangleAlert}
          tone="error"
          title="Couldn't load your tickets"
          body="Something went wrong while contacting the support service. Please try again in a moment."
          action={
            <Button variant="secondary" onClick={() => load()}>
              <RefreshCw size={15} className="mr-1.5" /> Try again
            </Button>
          }
        />
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="No support tickets yet"
          body="Stuck on an integration? Create a ticket and our team will reply right here in your dashboard."
          action={
            <Link href="/dashboard/support/new">
              <Button>
                <Plus size={15} className="mr-1.5" /> Create Ticket
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="rounded-2xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#FFFFFF' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E7DFF5] text-left">
                  <th className="px-5 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Ticket</th>
                  <th className="px-5 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Subject</th>
                  <th className="px-5 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Status</th>
                  <th className="px-5 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Last updated</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[#E7DFF5]/60 last:border-0 hover:bg-[#7F40E8]/[0.03]"
                    style={t.hasUnread ? { background: 'rgba(127,64,232,0.04)' } : undefined}
                  >
                    <td className="px-5 py-3 font-mono text-xs text-[#6425C4] whitespace-nowrap">
                      <UnreadDot unread={t.hasUnread} />
                      <Link href={`/dashboard/support/${t.id}`}>{t.ticketNumber}</Link>
                    </td>
                    <td className="px-5 py-3 text-[#170B2E] max-w-md">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          href={`/dashboard/support/${t.id}`}
                          className={`hover:text-[#6425C4] line-clamp-1 ${t.hasUnread ? 'font-semibold' : ''}`}
                        >
                          {t.subject}
                        </Link>
                        {t.type === 'CUSTOM_PLAN' && <CustomPlanBadge />}
                        {t.hasUnread && <NewMessageTag label="New" />}
                      </div>
                    </td>
                    <td className="px-5 py-3"><TicketStatusBadge status={t.status} /></td>
                    <td className="px-5 py-3 text-[#3D3650] whitespace-nowrap">
                      {new Date(t.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
