'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../../../lib/api';
import {
  AiCallDetail,
  formatDuration,
  sessionStatusBadge,
  terminationLabel,
  toolErrorText,
  toolStatusText,
  useAiStatus,
} from '../../../../lib/ai';
import { Badge } from '../../../../components/ui/Badge';
import { AiDisabledNotice, AiLoading } from '../../_components/AiNotices';

const EVENT_LABEL: Record<string, string> = {
  AI_SESSION_CREATED: 'Session created',
  AI_SESSION_CONNECTED: 'Caller connected',
  AI_AGENT_SPEAKING: 'Agent spoke',
  AI_SESSION_ENDED: 'Call ended',
  AI_SESSION_EXPIRED: 'Session expired before connecting',
  AI_BILLING_RECORDED: 'Credits charged',
};

const ROLE_LABEL = { user: 'Caller', assistant: 'Agent', tool: 'Tool' } as const;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <p className="text-sm font-semibold text-[#170B2E] mb-3">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[#3D3650]">{label}</p>
      <p className="text-sm text-[#170B2E] mt-0.5 break-words">{children}</p>
    </div>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString();

export default function AiCallDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { status, loading: statusLoading } = useAiStatus();
  const enabled = status?.enabled === true;
  const [call, setCall] = useState<AiCallDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    api
      .get(`/ai/calls/${sessionId}`)
      .then((r) => setCall(r.data))
      .catch(() => setNotFound(true));
  }, [enabled, sessionId]);

  const back = (
    <Link href="/dashboard/ai/calls" className="inline-flex items-center gap-1.5 text-sm text-[#3D3650] hover:text-[#170B2E]">
      <ArrowLeft size={15} /> AI Calls
    </Link>
  );

  if (statusLoading) return <AiLoading label="Loading call…" />;
  if (!enabled || notFound) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        {!enabled ? <AiDisabledNotice /> : <p className="text-sm text-[#3D3650]">This call doesn&apos;t exist.</p>}
      </div>
    );
  }
  if (!call) return <AiLoading label="Loading call…" />;

  const badge = sessionStatusBadge(call.status);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex flex-col gap-2">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-[#170B2E]">Call with {call.participantName || call.participantId}</h1>
          <Badge variant={badge.tone}>{badge.label}</Badge>
        </div>
        <p className="text-sm text-[#3D3650]">{new Date(call.date).toLocaleString()}</p>
      </div>

      <Card title="Summary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Agent">
            <Link href={`/dashboard/ai/${call.agentId}`} className="hover:text-[#7F40E8]">{call.agentName ?? '—'}</Link>
          </Field>
          <Field label="Participant ID">{call.participantId}</Field>
          <Field label="Duration">{formatDuration(call.durationSeconds)} of {formatDuration(call.maxDurationSeconds)} max</Field>
          <Field label="Ended by">{terminationLabel(call.terminationReason)}</Field>
          <Field label="Credits charged">{call.creditsCharged ?? '—'}</Field>
          <Field label="Tool calls">{call.toolCallCount}</Field>
          <Field label="Session ID">{call.sessionId}</Field>
          <Field label="Call ID">{call.callId}</Field>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card title="Timeline">
          {call.events.length === 0 ? (
            <p className="text-sm text-[#3D3650]">No events.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {call.events.map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-xs text-[#3D3650] tabular-nums w-20 shrink-0 pt-0.5">{time(e.createdAt)}</span>
                  <span className="text-[#170B2E]">{EVENT_LABEL[e.event] ?? e.event}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Tool calls">
          {call.toolInvocations.length === 0 ? (
            <p className="text-sm text-[#3D3650]">The agent didn&apos;t call any tools.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {call.toolInvocations.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-xs text-[#3D3650] tabular-nums w-20 shrink-0">{time(t.createdAt)}</span>
                  <span className="font-mono text-[#170B2E]">{t.toolName}</span>
                  <Badge variant={t.status === 'SUCCESS' ? 'success' : t.status === 'REJECTED' ? 'default' : 'error'}>
                    {toolStatusText(t.status.toLowerCase())}
                  </Badge>
                  <span className="text-xs text-[#3D3650]">{t.latencyMs} ms</span>
                  {t.errorCode && <span className="text-xs text-red-600 w-full pl-[92px]">{toolErrorText(t.errorCode)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Transcript">
        {!call.transcriptStored ? (
          <p className="text-sm text-[#3D3650]">
            No transcript for this call. Turn on &quot;Store call transcripts&quot; on the agent&apos;s Configuration tab to keep
            them for future calls. Stored transcripts are deleted when their retention period ends.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {call.transcript.map((m, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="text-xs text-[#3D3650] tabular-nums w-20 shrink-0 pt-0.5">{time(m.createdAt)}</span>
                <span
                  className={`text-xs font-medium w-14 shrink-0 pt-0.5 ${
                    m.role === 'assistant' ? 'text-[#7F40E8]' : 'text-[#3D3650]'
                  }`}
                >
                  {ROLE_LABEL[m.role]}
                </span>
                <span className={`whitespace-pre-wrap ${m.role === 'tool' ? 'font-mono text-xs text-[#3D3650]' : 'text-[#170B2E]'}`}>
                  {m.content}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
