'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
import { DetailList, PageHeader, Panel, Pill, Section, fmtDateTime } from '../../../_ui';
import { AiDisabledNotice, AiLoading, BackLink, pillTone } from '../../_components/AiNotices';

const EVENT_LABEL: Record<string, string> = {
  AI_SESSION_CREATED: 'Session created',
  AI_SESSION_CONNECTED: 'Caller connected',
  AI_AGENT_SPEAKING: 'Agent spoke',
  AI_SESSION_ENDED: 'Call ended',
  AI_SESSION_EXPIRED: 'Session expired before connecting',
  AI_BILLING_RECORDED: 'Credits charged',
};

const ROLE_LABEL = { user: 'Caller', assistant: 'Agent', tool: 'Tool' } as const;

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

  const back = <BackLink href="/dashboard/ai/calls">AI Calls</BackLink>;

  if (statusLoading) return <AiLoading label="Loading call…" />;
  if (!enabled || notFound) {
    return (
      <div>
        {back}
        {!enabled ? <AiDisabledNotice /> : <p className="text-sm text-[#6B6478]">This call doesn&apos;t exist.</p>}
      </div>
    );
  }
  if (!call) return <AiLoading label="Loading call…" />;

  const badge = sessionStatusBadge(call.status);

  return (
    <div className="max-w-5xl">
      {back}
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2.5">
            Call with {call.participantName || call.participantId}
            <Pill tone={pillTone(badge.tone)}>{badge.label}</Pill>
          </span>
        }
        description={fmtDateTime(call.date)}
      />

      <Section title="Summary">
        <Panel>
          <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
            <DetailList
              items={[
                {
                  label: 'Agent',
                  value: (
                    <Link href={`/dashboard/ai/${call.agentId}`} className="text-[#5B21B6] hover:underline">
                      {call.agentName ?? '—'}
                    </Link>
                  ),
                },
                { label: 'Participant ID', value: call.participantId, mono: true },
                {
                  label: 'Duration',
                  value: `${formatDuration(call.durationSeconds)} of ${formatDuration(call.maxDurationSeconds)} max`,
                },
                { label: 'Ended by', value: terminationLabel(call.terminationReason) },
              ]}
            />
            <DetailList
              items={[
                { label: 'Credits charged', value: call.creditsCharged ?? '—' },
                { label: 'Tool calls', value: call.toolCallCount },
                { label: 'Session ID', value: call.sessionId, mono: true },
                { label: 'Call ID', value: call.callId, mono: true },
              ]}
            />
          </div>
        </Panel>
      </Section>

      <div className="grid grid-cols-1 items-start gap-x-6 lg:grid-cols-2">
        <Section title="Timeline">
          <Panel>
            {call.events.length === 0 ? (
              <p className="text-sm text-[#6B6478]">No events.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {call.events.map((e, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="w-20 shrink-0 pt-0.5 text-xs tabular-nums text-[#6B6478]">{time(e.createdAt)}</span>
                    <span className="text-[#170B2E]">{EVENT_LABEL[e.event] ?? e.event}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </Section>

        <Section title="Tool calls">
          <Panel>
            {call.toolInvocations.length === 0 ? (
              <p className="text-sm text-[#6B6478]">The agent didn&apos;t call any tools.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {call.toolInvocations.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="w-20 shrink-0 text-xs tabular-nums text-[#6B6478]">{time(t.createdAt)}</span>
                    <span className="font-mono text-[13px] text-[#170B2E]">{t.toolName}</span>
                    <Pill tone={t.status === 'SUCCESS' ? 'success' : t.status === 'REJECTED' ? 'neutral' : 'danger'}>
                      {toolStatusText(t.status.toLowerCase())}
                    </Pill>
                    <span className="text-xs text-[#6B6478]">{t.latencyMs} ms</span>
                    {t.errorCode && <span className="w-full pl-[92px] text-xs text-red-600">{toolErrorText(t.errorCode)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Section>
      </div>

      <Section title="Transcript">
        <Panel>
          {!call.transcriptStored ? (
            <p className="text-sm text-[#6B6478]">
              No transcript for this call. Turn on &quot;Store call transcripts&quot; on the agent&apos;s Configuration tab to
              keep them for future calls. Stored transcripts are deleted when their retention period ends.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {call.transcript.map((m, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="w-20 shrink-0 pt-0.5 text-xs tabular-nums text-[#6B6478]">{time(m.createdAt)}</span>
                  <span
                    className={`w-14 shrink-0 pt-0.5 text-xs font-medium ${
                      m.role === 'assistant' ? 'text-[#5B21B6]' : 'text-[#6B6478]'
                    }`}
                  >
                    {ROLE_LABEL[m.role]}
                  </span>
                  <span
                    className={`whitespace-pre-wrap ${m.role === 'tool' ? 'font-mono text-xs text-[#6B6478]' : 'text-[#170B2E]'}`}
                  >
                    {m.content}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Section>
    </div>
  );
}
