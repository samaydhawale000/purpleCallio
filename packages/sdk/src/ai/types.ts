/** Server-side: body of `POST /ai/sessions`. */
export interface CreateAiSessionParams {
  agentId: string;
  /** Your own user; PurpleCallio never looks it up. */
  participant: { id: string; name?: string };
  /** Free-form context for the agent prompt (max 2 KB JSON), e.g. `{ orderId }`. */
  metadata?: Record<string, unknown>;
}

export interface CreateAiSessionResult {
  sessionId: string;
  callId: string;
  /** Short-lived `bj_ai_` token. Hand only this to the browser. */
  token: string;
  expiresAt: string;
  /** Socket.IO URL of the `/ai` relay; pass it to `PurpleCallioAgentCall`. */
  connectUrl: string;
}

export type AiSessionStatus =
  | 'CREATED'
  | 'CONNECTING'
  | 'ACTIVE'
  | 'ENDED'
  | 'FAILED'
  | 'EXPIRED';

export interface AiSession {
  sessionId: string;
  callId: string;
  agentId: string;
  agentVersionId: string;
  status: AiSessionStatus | string;
  terminationReason: string | null;
  participantId: string;
  participantName: string | null;
  metadata: Record<string, unknown> | null;
  expiresAt: string;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  maxDurationSeconds: number;
  toolCallCount: number;
  creditsCharged: number | string | null;
  createdAt: string;
}

/** Browser: `new PurpleCallioAgentCall(config)`. */
export interface AgentCallConfig {
  /** `bj_ai_` token from your backend's `client.ai.createSession()`. */
  token: string;
  /**
   * Your PurpleCallio server origin, e.g. `https://api.example.com`. The SDK
   * connects to its `/ai` namespace. `connectUrl` from `createSession()`
   * (which already ends in `/ai`) is accepted too.
   */
  apiUrl: string;
  /** Socket.IO path, if your proxy serves it somewhere other than `/socket.io`. */
  socketPath?: string;
  /** How long `start()` waits for the agent to be ready. Default 15 s. */
  connectTimeoutMs?: number;
}

export type AgentConnectionState = 'idle' | 'connecting' | 'connected' | 'ended';
export type AgentState = 'listening' | 'thinking' | 'speaking';

export interface AgentReady {
  inputSampleRate: number;
  outputSampleRate: number;
}

export interface AgentTranscript {
  role: 'user' | 'agent';
  text: string;
  /** False for partial text that a later event for the same turn replaces. */
  final: boolean;
}

export interface AgentToolCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  /**
   * On `tool_call`: `running`, then one of `success`, `failed`, `timeout`,
   * `rejected` or `unconfirmed`. Arguments and results are never sent.
   */
  status?: string;
  /** `AI_TOOL_FAILED` / `AI_TOOL_TIMEOUT` when the call failed. */
  code?: string;
}

/** `Error` with a stable `code`, e.g. `AI_SESSION_EXPIRED`. */
export interface AgentCallError extends Error {
  code: string;
}

export interface AgentEndedEvent {
  /** Server reason (`participant`, `max_duration`, `api`, …) or `disconnected` / `error`. */
  reason: string;
}

export interface AgentCallEventMap {
  connected: AgentReady;
  speaking: void;
  listening: void;
  thinking: void;
  agentState: AgentState;
  connectionState: AgentConnectionState;
  transcript: AgentTranscript;
  interrupted: void;
  tool_call: AgentToolCall;
  'tool.confirmation_required': AgentToolCall;
  error: AgentCallError;
  ended: AgentEndedEvent;
}

export type AgentCallEvent = keyof AgentCallEventMap;
