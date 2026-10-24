'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export type AiAgentStatus = 'ACTIVE' | 'DISABLED';
export type AiToolMethod = 'POST' | 'GET';

export interface AiAgentVersion {
  id: string;
  agentId: string;
  version: number;
  instructions: string;
  welcomeMessage: string | null;
  language: string;
  voice: string | null;
  provider: string;
  model: string | null;
  maxDurationSeconds: number;
  createdAt: string;
}

export interface AiAgentTool {
  id: string;
  agentId: string;
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  endpointUrl: string;
  method: AiToolMethod;
  enabled: boolean;
  requiresConfirmation: boolean;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
  /** Only present in the create response. */
  signingSecret?: string;
}

export interface AiAgent {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: AiAgentStatus;
  currentVersionId: string | null;
  storeTranscript?: boolean;
  /** 7 | 30 | 90, or null when transcripts were never stored. */
  transcriptRetentionDays?: number | null;
  createdAt: string;
  updatedAt: string;
  currentVersion?: AiAgentVersion | null;
  tools?: AiAgentTool[];
}

export interface AiStatus {
  enabled: boolean;
  /** Only sent for signed-in callers. */
  paidPlan?: boolean;
  /** Providers whose key is configured on the server. */
  providers?: string[];
}

// Mirrors the backend DTO limits (apps/server/src/ai/dto).
export const AGENT_NAME_MAX_LENGTH = 100;
export const AGENT_DESCRIPTION_MAX_LENGTH = 500;
export const INSTRUCTIONS_MAX_LENGTH = 20_000;
export const WELCOME_MESSAGE_MAX_LENGTH = 1000;
export const MIN_DURATION_SECONDS = 30;
export const DEFAULT_DURATION_SECONDS = 600;
export const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
export const TOOL_DESCRIPTION_MAX_LENGTH = 1024;
export const MIN_TOOL_TIMEOUT_MS = 500;
export const MAX_TOOL_TIMEOUT_MS = 30_000;

export const AI_LANGUAGES: { id: string; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'hi', label: 'Hindi' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'it', label: 'Italian' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'ar', label: 'Arabic' },
];

/** Gemini Live prebuilt voices; empty means the provider default. */
export const AI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];

/** OpenAI Realtime built-in voices (lower-case ids, as the API takes them). */
export const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

export const AI_PROVIDERS: { id: string; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI' },
];

/** An agent with no provider set uses Gemini (the server default). */
export const DEFAULT_AI_PROVIDER = 'gemini';

export function voicesFor(provider: string): string[] {
  return (provider || DEFAULT_AI_PROVIDER) === 'openai' ? OPENAI_VOICES : AI_VOICES;
}

export function providerLabel(provider: string): string {
  return AI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export const PLANS_HREF = '/dashboard/billing/plans';

/**
 * `GET /ai/status`. Any failure counts as disabled so a missing or
 * unreachable endpoint never shows the AI section.
 */
export function useAiStatus(): { status: AiStatus | null; loading: boolean } {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/ai/status')
      .then((res) => {
        if (cancelled) return;
        const providers = Array.isArray(res.data?.providers)
          ? res.data.providers.filter((p: unknown): p is string => typeof p === 'string')
          : undefined;
        setStatus({
          enabled: res.data?.enabled === true,
          paidPlan: res.data?.paidPlan,
          ...(providers ? { providers } : {}),
        });
      })
      .catch(() => {
        if (!cancelled) setStatus({ enabled: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, loading };
}

// ── Agent form ─────────────────────────────────────────

export interface AgentFormValues {
  name: string;
  description: string;
  instructions: string;
  welcomeMessage: string;
  language: string;
  /** Empty means the server default (Gemini). */
  provider: string;
  voice: string;
  maxDurationSeconds: string;
}

export type AgentFormErrors = Partial<Record<keyof AgentFormValues, string>>;

export const EMPTY_AGENT_FORM: AgentFormValues = {
  name: '',
  description: '',
  instructions: '',
  welcomeMessage: '',
  language: 'en',
  provider: '',
  voice: '',
  maxDurationSeconds: String(DEFAULT_DURATION_SECONDS),
};

export function agentToForm(agent: AiAgent): AgentFormValues {
  const v = agent.currentVersion;
  return {
    name: agent.name,
    description: agent.description ?? '',
    instructions: v?.instructions ?? '',
    welcomeMessage: v?.welcomeMessage ?? '',
    language: v?.language ?? 'en',
    provider: v?.provider ?? DEFAULT_AI_PROVIDER,
    voice: v?.voice ?? '',
    maxDurationSeconds: String(v?.maxDurationSeconds ?? DEFAULT_DURATION_SECONDS),
  };
}

export function validateAgentForm(values: AgentFormValues): AgentFormErrors {
  const errors: AgentFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Name is required.';
  else if (name.length > AGENT_NAME_MAX_LENGTH) errors.name = `Name must be at most ${AGENT_NAME_MAX_LENGTH} characters.`;

  if (values.description.trim().length > AGENT_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be at most ${AGENT_DESCRIPTION_MAX_LENGTH} characters.`;
  }

  if (!values.instructions.trim()) errors.instructions = 'Instructions are required.';
  else if (values.instructions.length > INSTRUCTIONS_MAX_LENGTH) {
    errors.instructions = `Instructions must be at most ${INSTRUCTIONS_MAX_LENGTH.toLocaleString('en-US')} characters.`;
  }

  if (values.welcomeMessage.trim().length > WELCOME_MESSAGE_MAX_LENGTH) {
    errors.welcomeMessage = `Greeting must be at most ${WELCOME_MESSAGE_MAX_LENGTH} characters.`;
  }

  if (!AI_LANGUAGES.some((l) => l.id === values.language)) errors.language = 'Select a valid language.';
  if (values.provider && !AI_PROVIDERS.some((p) => p.id === values.provider)) errors.provider = 'Select a valid provider.';
  if (values.voice && !voicesFor(values.provider).includes(values.voice)) errors.voice = 'Select a valid voice.';

  const duration = Number(values.maxDurationSeconds);
  if (!/^\d+$/.test(values.maxDurationSeconds.trim()) || !Number.isInteger(duration) || duration < MIN_DURATION_SECONDS) {
    errors.maxDurationSeconds = `Max duration must be a whole number of at least ${MIN_DURATION_SECONDS} seconds.`;
  }
  return errors;
}

/** Normalized values as the API takes them (empty optional text → null). */
function normalize(values: AgentFormValues) {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    instructions: values.instructions.trim(),
    welcomeMessage: values.welcomeMessage.trim() || null,
    language: values.language,
    provider: values.provider,
    voice: values.voice || null,
    maxDurationSeconds: Number(values.maxDurationSeconds),
  };
}

/** `POST /ai/agents` body. */
export function buildCreateAgentPayload(projectId: string, values: AgentFormValues) {
  const n = normalize(values);
  return {
    projectId,
    name: n.name,
    ...(n.description ? { description: n.description } : {}),
    instructions: n.instructions,
    ...(n.welcomeMessage ? { welcomeMessage: n.welcomeMessage } : {}),
    language: n.language,
    ...(n.provider ? { provider: n.provider } : {}),
    ...(n.voice ? { voice: n.voice } : {}),
    maxDurationSeconds: n.maxDurationSeconds,
  };
}

/**
 * `PATCH /ai/agents/:id` body: only the fields that changed, so an edit to
 * the name alone doesn't create a new config version.
 */
export function buildAgentPatch(original: AgentFormValues, values: AgentFormValues): Record<string, unknown> {
  const before = normalize(original);
  const after = normalize(values);
  const patch: Record<string, unknown> = {};
  (Object.keys(after) as (keyof typeof after)[]).forEach((key) => {
    if (after[key] !== before[key]) patch[key] = after[key];
  });
  // Empty means "server default"; never send it as a provider.
  if (!patch.provider) delete patch.provider;
  return patch;
}

// ── Errors ─────────────────────────────────────────────

/** Every message from an API error (class-validator sends an array). */
export function apiErrorMessages(e: any, fallback: string): string[] {
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg) && msg.length > 0) return msg.map(String);
  if (typeof msg === 'string' && msg) return [msg];
  return [fallback];
}

export function apiErrorCode(e: any): string | undefined {
  return e?.response?.data?.code ?? e?.code;
}

const AI_ERROR_TEXT: Record<string, string> = {
  AI_DISABLED: 'AI voice agents are not enabled.',
  AI_PAID_PLAN_REQUIRED: 'AI voice agents unlock after your first verified credit purchase.',
  AI_AGENT_NOT_FOUND: 'This agent no longer exists.',
  AI_AGENT_DISABLED: 'This agent is disabled. Enable it to start a call.',
  AI_QUOTA_EXCEEDED: 'You have used your AI minutes for today or this month.',
  AI_CONCURRENCY_LIMIT: 'Too many AI calls are running at once. End one and try again.',
  AI_INSUFFICIENT_CREDITS: 'Not enough credits to start an AI call. Top up and try again.',
  AI_SESSION_CREATE_FAILED: 'The call could not be created. Please try again.',
  AI_PROVIDER_UNAVAILABLE: 'The voice model is unavailable right now. Please try again shortly.',
  AI_CONNECTION_FAILED: 'Could not connect to the agent. Check your network and try again.',
  AI_SESSION_EXPIRED: 'The call session expired before it connected. Start a new call.',
  AI_SESSION_ENDED: 'This call has already ended.',
  AI_MAX_DURATION_REACHED: 'The call reached its maximum duration.',
  AI_TOOL_FAILED: 'A tool call failed.',
  AI_TOOL_TIMEOUT: 'A tool call timed out.',
  AI_MICROPHONE_DENIED: 'Microphone access was denied. Allow it in your browser and try again.',
  AI_MICROPHONE_UNAVAILABLE: 'No microphone was found.',
  AI_AUDIO_UNSUPPORTED: 'This browser does not support the audio features the playground needs.',
  AI_CALL_ALREADY_STARTED: 'This call was already started.',
};

export function aiErrorText(code: string | undefined, fallback = 'Something went wrong. Please try again.'): string {
  return (code && AI_ERROR_TEXT[code]) || fallback;
}

const ENDED_REASON_TEXT: Record<string, string> = {
  participant: 'You ended the call.',
  max_duration: 'The call reached its maximum duration.',
  api: 'The call was ended from the API.',
  idle_timeout: 'The call ended after a period of silence.',
  disconnected: 'The connection was lost.',
  heartbeat_lost: 'The connection was lost.',
  provider_error: 'The voice model stopped responding.',
  provider_unavailable: 'The voice model is unavailable right now.',
  server_shutdown: 'The server restarted. Please start a new call.',
  error: 'The call ended because of an error.',
};

export function endedReasonText(reason: string): string {
  return ENDED_REASON_TEXT[reason] ?? 'The call ended.';
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ── Tools (stage 7) ─────────────────────────────────────

/** https:// URLs; http(s)://localhost too (the server only accepts it in local dev). */
export function isToolEndpointUrl(url: string): boolean {
  const v = url.trim();
  return /^https:\/\/\S+$/i.test(v) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/\S*)?$/i.test(v);
}

export type AiToolInvocationStatus = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'REJECTED' | 'UNCONFIRMED';

/** `POST /ai/agents/:id/tools/:toolId/test`. */
export interface AiToolTestResult {
  status: AiToolInvocationStatus;
  latencyMs: number;
  httpStatus: number | null;
  errorCode: string | null;
  errors?: string[];
  /** First 2 KB of the response body. */
  responsePreview: string | null;
}

/** Placeholder arguments for every property in a tool's schema. */
export function sampleToolArguments(schema: unknown): Record<string, unknown> {
  const properties = (schema as { properties?: Record<string, { type?: string; enum?: unknown[] }> } | null)
    ?.properties;
  const args: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(properties ?? {})) {
    if (Array.isArray(prop?.enum) && prop.enum.length > 0) args[name] = prop.enum[0];
    else if (prop?.type === 'number' || prop?.type === 'integer') args[name] = 1;
    else if (prop?.type === 'boolean') args[name] = true;
    else args[name] = 'example';
  }
  return args;
}

const TOOL_ERROR_TEXT: Record<string, string> = {
  INVALID_ARGUMENTS: 'The sample arguments do not match the parameters schema.',
  INVALID_URL: 'The endpoint URL is not valid.',
  BLOCKED_URL: 'Only https:// endpoints are allowed.',
  DNS_FAILED: 'The endpoint host could not be resolved.',
  BLOCKED_ADDRESS: 'The endpoint resolves to a private or reserved address, which is not allowed.',
  TIMEOUT: 'The endpoint did not answer before the timeout.',
  REDIRECT_REFUSED: 'The endpoint answered with a redirect. Redirects are not followed.',
  RESPONSE_TOO_LARGE: 'The response is larger than the allowed size.',
  NOT_JSON: 'The endpoint must answer with JSON (Content-Type: application/json).',
  NETWORK_ERROR: 'Could not connect to the endpoint (network or TLS error).',
};

export function toolErrorText(code: string | null | undefined): string {
  if (!code) return '';
  if (/^HTTP_\d+$/.test(code)) return `The endpoint answered with HTTP ${code.slice(5)}.`;
  return TOOL_ERROR_TEXT[code] ?? 'The tool call failed.';
}

/** Lower-case statuses sent in the relay's `tool_call` events. */
export type AiToolCallStatus = 'running' | 'success' | 'failed' | 'timeout' | 'rejected' | 'unconfirmed';

const TOOL_STATUS_TEXT: Record<AiToolCallStatus, string> = {
  running: 'Running…',
  success: 'Done',
  failed: 'Failed',
  timeout: 'Timed out',
  rejected: 'Declined',
  unconfirmed: 'Not confirmed',
};

export function toolStatusText(status: string | undefined): string {
  return TOOL_STATUS_TEXT[status as AiToolCallStatus] ?? 'Running…';
}

// ── Calls and analytics (stage 8) ───────────────────────

export const TRANSCRIPT_RETENTION_DAYS = [7, 30, 90];
export const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 30;

export type AiSessionStatus = 'CREATED' | 'CONNECTING' | 'ACTIVE' | 'ENDED' | 'FAILED' | 'EXPIRED';

/** `GET /ai/calls` row. */
export interface AiCallSummary {
  sessionId: string;
  callId: string;
  date: string;
  agentId: string;
  agentName: string | null;
  participantId: string;
  participantName: string | null;
  status: AiSessionStatus;
  terminationReason: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  creditsCharged: number | null;
  toolCallCount: number;
}

export interface AiCallList {
  items: AiCallSummary[];
  page: number;
  pageSize: number;
  total: number;
}

/** `GET /ai/calls/:sessionId`. */
export interface AiCallDetail extends AiCallSummary {
  agentVersionId: string;
  maxDurationSeconds: number;
  metadata: Record<string, unknown> | null;
  events: { event: string; participantId: string | null; metadata: Record<string, unknown> | null; createdAt: string }[];
  toolInvocations: {
    id: string;
    toolId: string | null;
    toolName: string;
    status: AiToolInvocationStatus;
    latencyMs: number;
    errorCode: string | null;
    createdAt: string;
  }[];
  transcriptStored: boolean;
  transcript: { role: 'user' | 'assistant' | 'tool'; content: string; createdAt: string }[];
}

/** `GET /ai/analytics`. */
export interface AiAnalytics {
  from: string;
  to: string;
  totalSessions: number;
  totalMinutes: number;
  averageDurationSeconds: number;
  completed: number;
  failed: number;
  expired: number;
  inProgress: number;
  toolCalls: number;
  creditsUsed: number;
  peakConcurrency: number;
  minutesPerDay: { date: string; minutes: number; sessions: number }[];
}

type BadgeTone = 'default' | 'success' | 'warning' | 'error' | 'info';

const SESSION_STATUS: Record<AiSessionStatus, { label: string; tone: BadgeTone }> = {
  CREATED: { label: 'Waiting', tone: 'info' },
  CONNECTING: { label: 'Connecting', tone: 'info' },
  ACTIVE: { label: 'Live', tone: 'info' },
  ENDED: { label: 'Completed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'error' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
};

export function sessionStatusBadge(status: string): { label: string; tone: BadgeTone } {
  return SESSION_STATUS[status as AiSessionStatus] ?? { label: status, tone: 'default' };
}

const TERMINATION_LABEL: Record<string, string> = {
  participant: 'Caller hung up',
  api: 'Ended via API',
  admin: 'Ended by admin',
  max_duration: 'Max duration',
  idle_timeout: 'Silence timeout',
  disconnected: 'Connection lost',
  heartbeat_lost: 'Connection lost',
  provider_error: 'Model error',
  provider_unavailable: 'Model unavailable',
  connect_failed: 'Connection failed',
  server_shutdown: 'Server restart',
  expired: 'Never connected',
};

export function terminationLabel(reason: string | null): string {
  if (!reason) return '—';
  return TERMINATION_LABEL[reason] ?? reason.replace(/_/g, ' ');
}

/** 0 → "0s", 75 → "1m 15s", 3700 → "1h 1m". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

/** `YYYY-MM-DD` for a local date input, `days` before today. */
export function dateInputValue(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
