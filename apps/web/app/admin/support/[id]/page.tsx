'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { api } from '../../../lib/api';
import { useRealtimeEvent } from '../../../lib/realtime';
import {
  apiErrorMessage,
  docLabel,
  TICKET_STATUSES,
  type SupportMessage,
  type SupportTicket,
  type TicketStatus,
} from '../../../lib/support';
import { TicketStatusBadge, ticketStatusLabel } from '../../../components/support/TicketStatusBadge';
import { TicketThread } from '../../../components/support/TicketThread';
import { ToastHost, ToastState } from '../../../dashboard/billing/Toast';
import { CustomPlanBadge, CustomPlanContextPanel } from '../_components/CustomPlanContext';
import { useCanWrite } from '../../../lib/admin-access';
import { DetailList, ErrorNote, Loading, Panel, inputCls } from '../../../dashboard/_ui';

type AdminTicketDetail = SupportTicket & {
  type?: 'GENERAL' | 'CUSTOM_PLAN';
  customPlanRequest?: { id: string; status: string } | null;
  messages: SupportMessage[];
  customer: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    companyName: string | null;
    jobTitle: string | null;
    country: string | null;
    companyWebsite: string | null;
    status: string;
    createdAt: string;
  };
};

export default function AdminTicketPage() {
  const { id } = useParams<{ id: string }>();
  const canWrite = useCanWrite();
  const [ticket, setTicket] = useState<AdminTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/support/tickets/${id}`);
      setTicket(res.data);
      setError('');
    } catch (e: any) {
      setError(
        e?.response?.status === 404
          ? 'Ticket not found.'
          : apiErrorMessage(e, 'Failed to load ticket'),
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // New messages / status changes from the other side appear without a refresh.
  useRealtimeEvent<{ ticketId?: string }>('support:ticket-updated', (e) => {
    if (e.ticketId === id) load();
  });

  async function reply(message: string) {
    try {
      await api.post(`/admin/support/tickets/${id}/messages`, { message });
      await load();
      setToast({ id: Date.now(), type: 'success', message: 'Response sent' });
      return true;
    } catch (e) {
      setToast({ id: Date.now(), type: 'error', message: apiErrorMessage(e, 'Failed to send response') });
      return false;
    }
  }

  async function changeStatus(status: TicketStatus) {
    if (!ticket || status === ticket.status) return;
    setSavingStatus(true);
    try {
      const res = await api.patch(`/admin/support/tickets/${id}`, { status });
      setTicket((t) => (t ? { ...t, status: res.data.status, updatedAt: res.data.updatedAt } : t));
      setToast({ id: Date.now(), type: 'success', message: `Status set to ${ticketStatusLabel(status)}` });
    } catch (e) {
      setToast({ id: Date.now(), type: 'error', message: apiErrorMessage(e, 'Failed to update status') });
    } finally {
      setSavingStatus(false);
    }
  }

  const backLink = (
    <Link
      href="/admin/support"
      className="inline-flex items-center gap-1 text-[13px] text-[#6B6478] hover:text-[#170B2E]"
    >
      <ArrowLeft size={14} /> Back to Support
    </Link>
  );

  if (loading) {
    return <Loading label="Loading ticket…" />;
  }

  if (error || !ticket) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <ErrorNote message={error || 'Ticket not found.'} />
      </div>
    );
  }

  const c = ticket.customer;
  const doc = docLabel(ticket.documentationId);
  const customerRows: [string, string | null][] = [
    ['Email', c.email],
    ['Phone', c.phone],
    ['Company', c.companyName],
    ['Role', c.jobTitle],
    ['Country', c.country],
    ['Website', c.companyWebsite],
    ['Account', c.status],
    ['Customer since', new Date(c.createdAt).toLocaleDateString()],
  ];

  return (
    <div className="flex flex-col gap-4">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      {backLink}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <TicketThread
            messages={ticket.messages}
            viewer="ADMIN"
            customerLabel={c.name || c.email}
            placeholder="Write response..."
            submitLabel="Send Response"
            onReply={canWrite ? reply : undefined}
            header={
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-[#6B6478]">{ticket.ticketNumber}</span>
                  <TicketStatusBadge status={ticket.status} />
                  {ticket.type === 'CUSTOM_PLAN' && <CustomPlanBadge />}
                </div>
                <h1 className="break-words text-lg font-semibold text-[#170B2E]">{ticket.subject}</h1>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#6B6478]">
                  <span>Created {new Date(ticket.createdAt).toLocaleString()}</span>
                  <span>Updated {new Date(ticket.updatedAt).toLocaleString()}</span>
                  {doc && (
                    <Link
                      href={`/docs/${ticket.documentationId}`}
                      className="inline-flex items-center gap-1 text-[#5B21B6] hover:underline"
                    >
                      <BookOpen size={12} /> {doc}
                    </Link>
                  )}
                </div>
              </>
            }
          />
        </div>

        <div className="space-y-4">
          {ticket.type === 'CUSTOM_PLAN' && ticket.customPlanRequest && (
            <CustomPlanContextPanel requestId={ticket.customPlanRequest.id} />
          )}
          {canWrite && (
            <Panel>
              <label htmlFor="ticket-status" className="mb-2 block text-sm font-semibold text-[#170B2E]">
                Status
              </label>
              <select
                id="ticket-status"
                value={ticket.status}
                disabled={savingStatus}
                onChange={(e) => changeStatus(e.target.value as TicketStatus)}
                className={`${inputCls} disabled:opacity-50`}
              >
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>{ticketStatusLabel(s)}</option>
                ))}
              </select>
            </Panel>
          )}

          <Panel>
            <p className="mb-1 text-sm font-semibold text-[#170B2E]">Customer</p>
            <Link href={`/admin/customers/${c.id}`} className="text-sm font-medium text-[#5B21B6] hover:underline">
              {c.name || c.email}
            </Link>
            <div className="mt-2">
              <DetailList
                items={customerRows
                  .filter(([, v]) => v)
                  .map(([k, v]) => ({ label: k, value: v }))}
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
