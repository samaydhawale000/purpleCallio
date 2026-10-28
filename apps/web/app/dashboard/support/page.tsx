'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { api } from '../../lib/api';
import { useRealtimeEvent } from '../../lib/realtime';
import type { SupportTicket } from '../../lib/support';
import { TicketStatusBadge } from '../../components/support/TicketStatusBadge';
import { NewMessageTag, UnreadDot } from '../../components/support/UnreadIndicators';
import { CustomPlanBadge } from '../../components/support/CustomPlanBadge';
import { Empty, ErrorNote, Loading, PageHeader, Table, buttonCls, fmtDateTime } from '../_ui';

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

  if (loading) return <Loading label="Loading tickets…" />;

  return (
    <>
      <PageHeader
        title="Support"
        description="Report integration or development issues and follow up with our team."
        actions={
          <Link href="/dashboard/support/new" className={buttonCls('primary')}>
            Create Ticket
          </Link>
        }
      />

      {failed ? (
        <ErrorNote message="Couldn't load your tickets. Please try again in a moment." onRetry={() => load()} />
      ) : (
        <Table
          rows={tickets}
          rowKey={(t) => t.id}
          empty={
            <Empty
              title="No support tickets yet"
              body="Stuck on an integration? Create a ticket and our team will reply right here."
            />
          }
          columns={[
            {
              key: 'ticket',
              label: 'Ticket',
              mono: true,
              render: (t) => (
                <>
                  <UnreadDot unread={t.hasUnread} />
                  <Link href={`/dashboard/support/${t.id}`} className="text-[#5B21B6] hover:underline">
                    {t.ticketNumber}
                  </Link>
                </>
              ),
            },
            {
              key: 'subject',
              label: 'Subject',
              className: 'max-w-md',
              render: (t) => (
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={`/dashboard/support/${t.id}`}
                    className={`truncate hover:text-[#5B21B6] ${t.hasUnread ? 'font-semibold' : ''}`}
                  >
                    {t.subject}
                  </Link>
                  {t.type === 'CUSTOM_PLAN' && <CustomPlanBadge />}
                  {t.hasUnread && <NewMessageTag label="New" />}
                </div>
              ),
            },
            { key: 'status', label: 'Status', render: (t) => <TicketStatusBadge status={t.status} /> },
            {
              key: 'updated',
              label: 'Last updated',
              className: 'text-[#6B6478]',
              render: (t) => fmtDateTime(t.updatedAt),
            },
          ]}
        />
      )}
    </>
  );
}
