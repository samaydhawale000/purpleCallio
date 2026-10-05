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
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
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

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <div>
        <Link
          href="/dashboard/support"
          className="inline-flex items-center gap-1.5 text-sm text-[#3D3650] hover:text-[#170B2E] mb-3"
        >
          <ArrowLeft size={14} /> Back to Support
        </Link>
        <h1 className="text-2xl font-bold text-[#170B2E]">Create Ticket</h1>
        <p className="text-sm text-[#3D3650] mt-1">
          Describe the problem and include any relevant error message.
        </p>
      </div>

      <form
        onSubmit={submit}
        noValidate
        className="rounded-2xl border border-[#E7DFF5] p-5 flex flex-col gap-4"
        style={{ background: '#FFFFFF' }}
      >
        <Input
          label="Subject"
          placeholder="e.g. Webhook call.ended not received"
          value={subject}
          maxLength={SUBJECT_MAX_LENGTH}
          onChange={(e) => {
            setSubject(e.target.value);
            if (errors.subject) setErrors((p) => ({ ...p, subject: undefined }));
          }}
          error={errors.subject}
          autoFocus
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ticket-message" className="text-sm font-medium text-[#3D3650]">Message</label>
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
            className={`w-full px-3 py-2.5 rounded-lg text-sm text-[#170B2E] placeholder:text-[#6B6478] bg-white border outline-none transition-all resize-y ${
              errors.message
                ? 'border-red-500/50 focus:border-red-500/70'
                : 'border-[#D6C4EE] focus:border-[#7F40E8]/60 focus:shadow-[0_0_0_3px_rgba(127,64,232,0.1)]'
            }`}
          />
          {errors.message && <p className="text-xs text-red-600">{errors.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ticket-doc" className="text-sm font-medium text-[#3D3650]">
            Related documentation <span className="font-normal">(optional)</span>
          </label>
          <select
            id="ticket-doc"
            value={documentationId}
            onChange={(e) => setDocumentationId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm text-[#170B2E] bg-[#FFFFFF] border border-[#D6C4EE] outline-none focus:border-[#7F40E8]/60"
          >
            <option value="">None</option>
            {DOC_PAGES.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <Button type="submit" loading={submitting}>Create Ticket</Button>
          <Link href="/dashboard/support">
            <Button type="button" variant="ghost">Cancel</Button>
          </Link>
        </div>
      </form>
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
