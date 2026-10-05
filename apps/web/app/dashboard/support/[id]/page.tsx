'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { useAuthStore } from '../../../store/auth.store';
import { api } from '../../../lib/api';
import {
  apiErrorMessage,
  docLabel,
  type SupportMessage,
  type SupportTicket,
} from '../../../lib/support';
import { TicketStatusBadge } from '../../../components/support/TicketStatusBadge';
import { TicketThread } from '../../../components/support/TicketThread';
import { ToastHost, ToastState } from '../../billing/Toast';

type TicketDetail = SupportTicket & { messages: SupportMessage[] };

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
      <div className="flex flex-col gap-4">
        {backLink}
        <p className="text-sm text-red-600 py-10 text-center">{error || 'Ticket not found.'}</p>
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
              <span className="font-mono text-xs text-[#6425C4]">{ticket.ticketNumber}</span>
              <TicketStatusBadge status={ticket.status} />
            </div>
            <h1 className="text-lg font-bold text-[#170B2E] break-words">{ticket.subject}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-[#3D3650]">
              <span>Created {new Date(ticket.createdAt).toLocaleString()}</span>
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
  );
}

export default function TicketPage() {
  return (
    <Suspense fallback={null}>
      <TicketConversation />
    </Suspense>
  );
}
