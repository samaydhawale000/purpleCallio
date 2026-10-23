import { useCallback, useEffect, useRef, useState } from 'react';

import {
  PurpleCallioAgentCall,
  AgentCallError,
  AgentConnectionState,
  AgentState,
  AgentToolCall,
  AgentTranscript,
} from '@purplecallio/sdk';

export interface UsePurpleCallioAIOptions {
  /**
   * Fetches a fresh `bj_ai_` token from your own backend, which calls
   * `client.ai.createSession()` with its API key. Called on every `start()`,
   * since tokens are single-use. Returning the whole `createSession()` result
   * works too.
   */
  getToken: () => Promise<string | { token: string }>;
  /** Your PurpleCallio server origin, e.g. `https://api.example.com`. */
  apiUrl: string;
  /** Socket.IO path, if your proxy serves it somewhere other than `/socket.io`. */
  socketPath?: string;
  /** How long `start()` waits for the agent to be ready. Default 15 s. */
  connectTimeoutMs?: number;
}

export interface AITranscriptLine extends AgentTranscript {
  /** Stable key for list rendering; a partial line keeps it when replaced. */
  key: number;
}

export interface AIToolActivity {
  id: string;
  name: string;
  status: string;
  code?: string;
}

export type AICallStatus = 'idle' | 'starting' | AgentConnectionState;

export interface UsePurpleCallioAIResult {
  /** `starting` covers fetching the token; then the SDK's connection state. */
  status: AICallStatus;
  agentState: AgentState;
  isMuted: boolean;
  transcript: AITranscriptLine[];
  toolCalls: AIToolActivity[];
  /** Tool calls waiting for `confirmTool(id, approve)`. */
  pendingConfirmations: AgentToolCall[];
  /** Seconds since the agent became ready (frozen once the call ends); 0 before that. */
  durationSeconds: number;
  /** Why the last call ended (`participant`, `max_duration`, `error`, …). */
  endedReason: string | null;
  error: AgentCallError | null;
  /** Resolves once the agent is ready. Never throws; failures land in `error`. */
  start: () => Promise<void>;
  end: () => void;
  mute: () => void;
  unmute: () => void;
  confirmTool: (id: string, approve: boolean) => void;
}

/** Partial text for a turn is replaced by later events for the same turn. */
function mergeTranscript(lines: AITranscriptLine[], next: AgentTranscript, key: number): AITranscriptLine[] {
  const last = lines[lines.length - 1];
  if (last && last.role === next.role && !last.final) {
    return [...lines.slice(0, -1), { ...next, key: last.key }];
  }
  return [...lines, { ...next, key }];
}

/** One row per tool call id, updated in place as its status changes. */
function mergeToolActivity(items: AIToolActivity[], next: AgentToolCall): AIToolActivity[] {
  const row = { id: next.id, name: next.name, status: next.status ?? 'running', code: next.code };
  const i = items.findIndex((t) => t.id === next.id);
  if (i === -1) return [...items, row];
  return items.map((t, j) => (j === i ? row : t));
}

function toError(e: unknown, fallbackCode: string): AgentCallError {
  if (e instanceof Error && typeof (e as AgentCallError).code === 'string') return e as AgentCallError;
  const err = new Error(e instanceof Error ? e.message : 'Could not start the AI call') as AgentCallError;
  err.code = fallbackCode;
  return err;
}

/**
 * Talk to a PurpleCallio AI voice agent from the browser.
 *
 * ```tsx
 * const ai = usePurpleCallioAI({
 *   apiUrl: 'https://api.example.com',
 *   getToken: () => fetch('/api/ai-session', { method: 'POST' }).then((r) => r.json()),
 * });
 * <button onClick={ai.start}>Talk</button>
 * ```
 */
export function usePurpleCallioAI(options: UsePurpleCallioAIOptions): UsePurpleCallioAIResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const callRef = useRef<PurpleCallioAgentCall | null>(null);
  const startingRef = useRef(false);
  const cancelRef = useRef(false);
  const keyRef = useRef(0);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<AICallStatus>('idle');
  const [agentState, setAgentState] = useState<AgentState>('listening');
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<AITranscriptLine[]>([]);
  const [toolCalls, setToolCalls] = useState<AIToolActivity[]>([]);
  const [pendingConfirmations, setPendingConfirmations] = useState<AgentToolCall[]>([]);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [error, setError] = useState<AgentCallError | null>(null);

  // End the call on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      callRef.current?.end();
      callRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== 'connected') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [status]);

  const start = useCallback(async () => {
    if (startingRef.current || callRef.current) return;
    startingRef.current = true;
    cancelRef.current = false;

    setError(null);
    setEndedReason(null);
    setTranscript([]);
    setToolCalls([]);
    setPendingConfirmations([]);
    setIsMuted(false);
    setAgentState('listening');
    setConnectedAt(null);
    setEndedAt(null);
    setStatus('starting');

    const { getToken, apiUrl, socketPath, connectTimeoutMs } = optionsRef.current;
    let token: string;
    try {
      const result = await getToken();
      const value = typeof result === 'string' ? result : result?.token;
      if (!value) throw new Error('getToken() returned no token');
      token = value;
    } catch (e) {
      startingRef.current = false;
      if (!mountedRef.current) return;
      setError(toError(e, 'AI_SESSION_CREATE_FAILED'));
      setEndedReason('error');
      setStatus('ended');
      return;
    }
    if (!mountedRef.current || cancelRef.current) {
      // end() or unmount while the token was being fetched.
      startingRef.current = false;
      if (mountedRef.current) {
        setEndedReason('participant');
        setStatus('ended');
      }
      return;
    }

    let call: PurpleCallioAgentCall;
    try {
      call = new PurpleCallioAgentCall({ token, apiUrl, socketPath, connectTimeoutMs });
    } catch (e) {
      startingRef.current = false;
      setError(toError(e, 'AI_CONNECTION_FAILED'));
      setEndedReason('error');
      setStatus('ended');
      return;
    }
    callRef.current = call;
    call.on('connectionState', (s) => setStatus(s));
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
      setToolCalls((items) => mergeToolActivity(items, t));
      // A final status also settles a question the user never answered.
      if (t.status && t.status !== 'running') {
        setPendingConfirmations((list) => list.filter((c) => c.id !== t.id));
      }
    });
    call.on('tool.confirmation_required', (t) => {
      setPendingConfirmations((list) => [...list.filter((c) => c.id !== t.id), { id: t.id, name: t.name }]);
    });
    call.on('error', (err) => setError(err));
    call.on('ended', ({ reason }) => {
      setEndedReason(reason);
      setEndedAt(Date.now());
      setPendingConfirmations([]);
      setStatus('ended');
      if (callRef.current === call) callRef.current = null;
    });

    try {
      await call.start();
    } catch {
      // Already surfaced through the `error` and `ended` events.
    } finally {
      startingRef.current = false;
    }
  }, []);

  const end = useCallback(() => {
    if (startingRef.current && !callRef.current) cancelRef.current = true;
    callRef.current?.end();
  }, []);

  const mute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    call.mute();
    setIsMuted(call.isMuted);
  }, []);

  const unmute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    call.unmute();
    setIsMuted(call.isMuted);
  }, []);

  const confirmTool = useCallback((id: string, approve: boolean) => {
    callRef.current?.confirmTool(id, approve);
    setPendingConfirmations((list) => list.filter((c) => c.id !== id));
  }, []);

  const durationSeconds = connectedAt
    ? Math.max(0, Math.floor(((endedAt ?? now) - connectedAt) / 1000))
    : 0;

  return {
    status,
    agentState,
    isMuted,
    transcript,
    toolCalls,
    pendingConfirmations,
    durationSeconds,
    endedReason,
    error,
    start,
    end,
    mute,
    unmute,
    confirmTool,
  };
}
