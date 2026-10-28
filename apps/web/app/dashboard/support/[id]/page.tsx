'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { useAuthStore } from '../../../store/auth.store';
import { api } from '../../../lib/api';
import { useRealtimeEvent } from '../../../lib/realtime';
import {
  apiErrorMessage,
  docLabel,
  type SupportMessage,
  type SupportTicket,
} from '../../../lib/support';
import { TicketStatusBadge } from '../../../components/support/TicketStatusBadge';
import { TicketThread } from '../../../components/support/TicketThread';
import { CustomPlanBadge } from '../../../components/support/CustomPlanBadge';
import { ToastHost, ToastState } from '../../billing/Toast';
import { ErrorNote, Loading } from '../../_ui';

type TicketDetail = SupportTicket & { messages: SupportMessage[]; type?: 'GENERAL' | 'CUSTOM_PLAN' };

function TicketConversation() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthed } = useRequireAuth();
  const user = useAuthStore((s) => s.user);

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/support/tickets/${id}`);
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
    if (isAuthed) load();
  }, [isAuthed, load]);

  // New messages / status changes from the other side appear without a refresh.
  useRealtimeEvent<{ ticketId?: string }>('support:ticket-updated', (e) => {
    if (e.ticketId === id) load();
  });

  // Arriving from the create form: confirm, then drop the flag from the URL.
  useEffect(() => {
    if (searchParams.get('created')) {
      setToast({ id: Date.now(), type: 'success', message: 'Ticket created' });
      router.replace(`/dashboard/support/${id}`);
    }
  }, [searchParams, router, id]);

  async function reply(message: string) {
    try {
      await api.post(`/support/tickets/${id}/messages`, { message });
      await load();
      setToast({ id: Date.now(), type: 'success', message: 'Reply sent' });
      return true;
    } catch (e) {
      setToast({ id: Date.now(), type: 'error', message: apiErrorMessage(e, 'Failed to send reply') });
      return false;
    }
  }

  const backLink = (
    <Link
      href="/dashboard/support"
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

  const doc = docLabel(ticket.documentationId);

  return (
    <div className="flex flex-col gap-4">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      {backLink}

      <TicketThread
        messages={ticket.messages}
        viewer="CUSTOMER"
        customerLabel={user?.name || 'You'}
        placeholder="Write a reply..."
        submitLabel="Send"
        onReply={reply}
        header={
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-mono text-xs text-[#6B6478]">{ticket.ticketNumber}</span>
              <TicketStatusBadge status={ticket.status} />
              {ticket.type === 'CUSTOM_PLAN' && <CustomPlanBadge />}
            </div>
            <h1 className="break-words text-lg font-semibold text-[#170B2E]">{ticket.subject}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-[#6B6478]">
              <span>Created {new Date(ticket.createdAt).toLocaleString()}</span>
              {doc && (
                <Link
                  href={`/docs/${ticket.documentationId}`}
                  className="inline-flex items-center gap-1 text-[#5B21B6] hover:underline"
                >
                  <BookOpen size={12} /> {doc}
                </Link>
              )}
            </div>
            {ticket.type === 'CUSTOM_PLAN' && (
              <p className="mt-2 text-xs text-[#6B6478]" data-testid="custom-plan-note">
                Our team will continue the conversation here.
              </p>
            )}
          </>
        }
      />
    </div>
  );
}

export default function TicketPage() {
  return (
    <Suspense fallback={null}>
      <TicketConversation />
    </Suspense>
  );
}
