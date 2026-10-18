'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Play, ShieldQuestion, Wrench } from 'lucide-react';
import {
  PurpleCallioAgentCall,
  type AgentConnectionState,
  type AgentState,
  type AgentToolCall,
  type AgentTranscript,
} from '@purplecallio/sdk';
import { api } from '../../../lib/api';
import { PURPLECALLIO_SIGNAL_URL } from '../../../lib/brand';
import { aiErrorText, apiErrorCode, endedReasonText, formatClock, toolStatusText } from '../../../lib/ai';
import { Button } from '../../../components/ui/Button';

interface TranscriptLine extends AgentTranscript {
  key: number;
}

/** Partial text for a turn is replaced by later events for the same turn. */
function mergeTranscript(lines: TranscriptLine[], next: AgentTranscript, key: number): TranscriptLine[] {
  const last = lines[lines.length - 1];
  if (last && last.role === next.role && !last.final) {
    return [...lines.slice(0, -1), { ...next, key: last.key }];
  }
  return [...lines, { ...next, key }];
}

interface ToolActivity {
  id: string;
  name: string;
  status: string;
  code?: string;
}

/** One row per tool call id, updated in place as its status changes. */
function mergeToolActivity(items: ToolActivity[], next: AgentToolCall): ToolActivity[] {
  const row = { id: next.id, name: next.name, status: next.status ?? 'running', code: next.code };
  const i = items.findIndex((t) => t.id === next.id);
  if (i === -1) return [...items, row];
  return items.map((t, j) => (j === i ? row : t));
}

const TOOL_STATUS_COLOR: Record<string, string> = {
  success: 'text-emerald-700',
  failed: 'text-red-700',
  timeout: 'text-amber-700',
  rejected: 'text-amber-700',
  unconfirmed: 'text-amber-700',
};

const STATE_LABEL: Record<AgentConnectionState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  ended: 'Call ended',
};

const AGENT_STATE_LABEL: Record<AgentState, string> = {
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
};

/**
 * Live call with the agent through the SDK, using a playground session
 * (`POST /ai/playground/sessions`) so no API key is involved.
 */
export function AgentPlayground({
  agentId,
  agentActive,
  canStart,
}: {
  agentId: string;
  agentActive: boolean;
  /** False on the Free plan: the Start button is hidden. */
  canStart: boolean;
}) {
  const callRef = useRef<PurpleCallioAgentCall | null>(null);
  const keyRef = useRef(0);
  const [creating, setCreating] = useState(false);
  const [connection, setConnection] = useState<AgentConnectionState>('idle');
  const [agentState, setAgentState] = useState<AgentState>('listening');
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [confirmations, setConfirmations] = useState<AgentToolCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // End the call when leaving the tab or page. `mountedRef` stops a start
  // that is still waiting for its session from going live after we leave.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      callRef.current?.end();
    };
  }, []);

  useEffect(() => {
    if (connection !== 'connected') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [connection]);

  async function start() {
    setError(null);
    setEndedReason(null);
    setTranscript([]);
    setTools([]);
    setConfirmations([]);
    setMuted(false);
    setAgentState('listening');
    setConnectedAt(null);
    setCreating(true);

    let token: string;
    try {
      const res = await api.post('/ai/playground/sessions', { agentId });
      token = res.data.token;
    } catch (e) {
      setError(aiErrorText(apiErrorCode(e), 'Could not start the call. Please try again.'));
      setCreating(false);
      return;
    }
    // Left the tab while the session was being created: never connect (the
    // unused token simply expires and nothing is billed).
    if (!mountedRef.current) return;

    // The relay is a Socket.IO namespace on the API host, without the /api
    // prefix that production's NEXT_PUBLIC_API_URL carries.
    const call = new PurpleCallioAgentCall({ token, apiUrl: PURPLECALLIO_SIGNAL_URL });
    callRef.current = call;
    call.on('connectionState', (s) => setConnection(s));
    call.on('agentState', (s) => setAgentState(s));
    call.on('connected', () => {
      setConnectedAt(Date.now());
      setNow(Date.now());
    });
    call.on('transcript', (t) => {
      keyRef.current += 1;
      const key = keyRef.current;
      setTranscript((lines) => mergeTranscript(lines, t, key));
    });
    call.on('tool_call', (t) => {
      setTools((items) => mergeToolActivity(items, t));
      // A final status also settles a question the user never answered.
      if (t.status && t.status !== 'running') {
        setConfirmations((list) => list.filter((c) => c.id !== t.id));
      }
    });
    call.on('tool.confirmation_required', (t) => {
      setConfirmations((list) => [...list.filter((c) => c.id !== t.id), { id: t.id, name: t.name }]);
    });
    call.on('error', (err) => setError(aiErrorText(err.code)));
    call.on('ended', ({ reason }) => {
      setEndedReason(reason);
      setConfirmations([]);
      if (callRef.current === call) callRef.current = null;
    });

    setCreating(false);
    try {
      await call.start();
    } catch {
      // Already surfaced through the `error` and `ended` events.
    }
  }

  function end() {
    callRef.current?.end();
  }

  function answerTool(id: string, approve: boolean) {
    callRef.current?.confirmTool(id, approve);
    setConfirmations((list) => list.filter((c) => c.id !== id));
  }

  function toggleMute() {
    const call = callRef.current;
    if (!call) return;
    if (call.isMuted) call.unmute();
    else call.mute();
    setMuted(call.isMuted);
  }

  const live = connection === 'connecting' || connection === 'connected';
  const elapsed = connectedAt ? (now - connectedAt) / 1000 : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-[#E7DFF5] p-5 flex flex-col gap-4" style={{ background: '#FFFFFF' }}>
        <div className="flex flex-wrap items-center gap-4">
          <div
            className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-all ${
              connection === 'connected' && agentState === 'speaking' ? 'animate-pulse' : ''
            }`}
            style={{
              background:
                connection === 'connected'
                  ? 'linear-gradient(135deg, #7F40E8, #410686)'
                  : 'rgba(127,64,232,0.12)',
            }}
            aria-hidden
          >
            <Mic size={22} style={{ color: connection === 'connected' ? '#FFFFFF' : '#7F40E8' }} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <p className="text-sm font-semibold text-[#170B2E]" data-testid="ai-connection-state">
              {STATE_LABEL[connection]}
            </p>
            <p className="text-xs text-[#3D3650] mt-0.5">
              {connection === 'connected' ? (
                <>
                  <span data-testid="ai-agent-state">{AGENT_STATE_LABEL[agentState]}</span>
                  {' · '}
                  <span className="font-mono">{formatClock(elapsed)}</span>
                  {muted && ' · Muted'}
                </>
              ) : connection === 'ended' && endedReason ? (
                endedReasonText(endedReason)
              ) : (
                'Use your microphone to talk to this agent.'
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {live ? (
              <>
                <Button variant="secondary" onClick={toggleMute} disabled={connection !== 'connected'}>
                  {muted ? <MicOff size={15} /> : <Mic size={15} />}
                  {muted ? 'Unmute' : 'Mute'}
                </Button>
                <Button variant="danger" onClick={end}>
                  <PhoneOff size={15} /> End
                </Button>
              </>
            ) : (
              canStart && (
                <Button onClick={start} loading={creating} disabled={!agentActive}>
                  <Play size={15} /> {connection === 'ended' ? 'Start again' : 'Start'}
                </Button>
              )
            )}
          </div>
        </div>
        {!agentActive && canStart && !live && (
          <p className="text-xs text-amber-700">This agent is disabled. Enable it to start a call.</p>
        )}
        {error && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {confirmations.map((c) => (
        <div
          key={c.id}
          role="alertdialog"
          aria-label={`Confirm ${c.name}`}
          className="rounded-2xl border border-amber-500/30 bg-amber-50 p-4 flex flex-wrap items-center gap-3"
        >
          <ShieldQuestion size={18} className="text-amber-700 shrink-0" />
          <p className="flex-1 min-w-[200px] text-sm text-[#170B2E]">
            The agent wants to run <span className="font-mono font-semibold">{c.name}</span>. Allow it?
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => answerTool(c.id, true)}>
              Allow
            </Button>
            <Button size="sm" variant="secondary" onClick={() => answerTool(c.id, false)}>
              Deny
            </Button>
          </div>
        </div>
      ))}

      {tools.length > 0 && (
        <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-sm font-semibold text-[#170B2E] mb-3">Tool calls</p>
          <ul className="flex flex-col gap-1.5" data-testid="ai-tool-activity">
            {tools.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <Wrench size={13} className="text-[#7F40E8] shrink-0" />
                <span className="font-mono text-[#170B2E]">{t.name}</span>
                <span className={`text-xs ${TOOL_STATUS_COLOR[t.status] ?? 'text-[#6B6478]'}`}>
                  {toolStatusText(t.status)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
        <p className="text-sm font-semibold text-[#170B2E] mb-3">Transcript</p>
        {transcript.length === 0 ? (
          <p className="text-sm text-[#6B6478]">The conversation will appear here.</p>
        ) : (
          <ul className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
            {transcript.map((line) => (
              <li key={line.key} className={`flex ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <span
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                    line.role === 'user' ? 'bg-[#F0E9FA] text-[#170B2E]' : 'bg-[#F8F4FD] text-[#3D3650]'
                  } ${line.final ? '' : 'opacity-70'}`}
                >
                  <span className="block text-[10px] font-mono uppercase tracking-wider text-[#6B6478] mb-0.5">
                    {line.role === 'user' ? 'You' : 'Agent'}
                  </span>
                  {line.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
