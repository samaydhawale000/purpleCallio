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
      className="inline-flex items-center gap-1.5 text-sm text-[#3D3650] hover:text-[#170B2E]"
    >
      <ArrowLeft size={14} /> Back to Support
    </Link>
  );

  if (loading) {
    return <div className="text-[#3D3650] text-sm py-20 text-center">Loading ticket…</div>;
  }

  if (error || !ticket) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="text-red-600 text-sm py-10 text-center">{error || 'Ticket not found.'}</p>
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
    <div className="space-y-4">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      {backLink}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px] items-start">
        <div className="min-w-0">
          <TicketThread
            messages={ticket.messages}
            viewer="ADMIN"
            customerLabel={c.name || c.email}
            placeholder="Write response..."
            submitLabel="Send Response"
            onReply={reply}
            header={
              <>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-mono text-xs text-[#6425C4]">{ticket.ticketNumber}</span>
                  <TicketStatusBadge status={ticket.status} />
                  {ticket.type === 'CUSTOM_PLAN' && <CustomPlanBadge />}
                </div>
                <h1 className="text-lg font-bold text-[#170B2E] break-words">{ticket.subject}</h1>
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-[#3D3650]">
                  <span>Created {new Date(ticket.createdAt).toLocaleString()}</span>
                  <span>Updated {new Date(ticket.updatedAt).toLocaleString()}</span>
                  {doc && (
                    <Link
                      href={`/docs/${ticket.documentationId}`}
                      className="inline-flex items-center gap-1 text-[#6425C4] hover:text-[#170B2E]"
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
          <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-mono uppercase tracking-widest text-[#3D3650] mb-3">Status</p>
            <select
              value={ticket.status}
              disabled={savingStatus}
              onChange={(e) => changeStatus(e.target.value as TicketStatus)}
              className="w-full px-3 py-2.5 rounded-lg text-sm text-[#170B2E] bg-white border border-[#D6C4EE] outline-none focus:border-[#7F40E8]/60 disabled:opacity-50"
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>{ticketStatusLabel(s)}</option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
            <p className="text-xs font-mono uppercase tracking-widest text-[#3D3650] mb-3">Customer</p>
            <Link
              href={`/admin/customers/${c.id}`}
              className="text-sm font-semibold text-[#170B2E] hover:text-[#6425C4]"
            >
              {c.name || c.email}
            </Link>
            <dl className="mt-3 space-y-2 text-xs">
              {customerRows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-[#3D3650] shrink-0">{k}</dt>
                    <dd className="text-[#170B2E] text-right break-all">{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
