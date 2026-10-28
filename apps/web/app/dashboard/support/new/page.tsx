'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  apiErrorMessage,
  DOC_PAGES,
  MESSAGE_MAX_LENGTH,
  SUBJECT_MAX_LENGTH,
} from '../../../lib/support';
import { PageHeader, Panel, buttonCls, inputCls } from '../../_ui';
import { ToastHost, ToastState } from '../../billing/Toast';

function NewTicketForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?doc=<slug> is set by "Contact Support" on a documentation page.
  const presetDoc = searchParams.get('doc') ?? '';

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [documentationId, setDocumentationId] = useState(
    DOC_PAGES.some((d) => d.id === presetDoc) ? presetDoc : '',
  );
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!subject.trim()) next.subject = 'Subject is required.';
    if (!message.trim()) next.message = 'Message is required.';
    setErrors(next);
    if (next.subject || next.message) return;

    setSubmitting(true);
    try {
      const res = await api.post('/support/tickets', {
        subject: subject.trim(),
        message: message.trim(),
        ...(documentationId ? { documentationId } : {}),
      });
      router.push(`/dashboard/support/${res.data.id}?created=1`);
    } catch (err) {
      setToast({ id: Date.now(), type: 'error', message: apiErrorMessage(err, 'Failed to create ticket') });
      setSubmitting(false);
    }
  }

  const labelCls = 'mb-1 block text-[13px] text-[#6B6478]';
  const errorCls = 'border-red-300 focus:border-red-400 focus:ring-red-100';

  return (
    <div className="max-w-3xl">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <Link
        href="/dashboard/support"
        className="mb-4 inline-flex items-center gap-1 text-[13px] text-[#6B6478] hover:text-[#170B2E]"
      >
        <ArrowLeft size={14} /> Back to Support
      </Link>
      <PageHeader title="New ticket" description="Describe the problem and include any relevant error message." />

      <Panel>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div>
            <label htmlFor="ticket-subject" className={labelCls}>Subject</label>
            <input
              id="ticket-subject"
              className={`${inputCls} ${errors.subject ? errorCls : ''}`}
              placeholder="e.g. Webhook call.ended not received"
              value={subject}
              maxLength={SUBJECT_MAX_LENGTH}
              onChange={(e) => {
                setSubject(e.target.value);
                if (errors.subject) setErrors((p) => ({ ...p, subject: undefined }));
              }}
              autoFocus
            />
            {errors.subject && <p className="mt-1 text-xs text-red-600">{errors.subject}</p>}
          </div>

          <div>
            <label htmlFor="ticket-message" className={labelCls}>Message</label>
            <textarea
              id="ticket-message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (errors.message) setErrors((p) => ({ ...p, message: undefined }));
              }}
              placeholder="What were you trying to do, what happened, and any error output…"
              rows={8}
              maxLength={MESSAGE_MAX_LENGTH}
              className={`${inputCls} resize-y ${errors.message ? errorCls : ''}`}
            />
            {errors.message && <p className="mt-1 text-xs text-red-600">{errors.message}</p>}
          </div>

          <div>
            <label htmlFor="ticket-doc" className={labelCls}>
              Related documentation (optional)
            </label>
            <select
              id="ticket-doc"
              value={documentationId}
              onChange={(e) => setDocumentationId(e.target.value)}
              className={inputCls}
            >
              <option value="">None</option>
              {DOC_PAGES.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button type="submit" className={buttonCls('primary')} disabled={submitting}>
              Create Ticket
            </button>
            <Link href="/dashboard/support" className={buttonCls('ghost')}>
              Cancel
            </Link>
          </div>
        </form>
      </Panel>
    </div>
  );
}

export default function NewTicketPage() {
  return (
    <Suspense fallback={null}>
      <NewTicketForm />
    </Suspense>
  );
}
