/**
 * AI Voice Agents configuration. Read from env on every call (like the
 * Playground flags) so tests and ops can flip values without a restart.
 * Defaults match docs/ai-voice-agents/README.md.
 */
export interface AiConfig {
  enabled: boolean;
  maxConcurrentSessionsPerAccount: number;
  globalMaxConcurrentSessions: number;
  dailyMinutesPerAccount: number;
  monthlyMinutesPerAccount: number;
  maxDurationCapSeconds: number;
  defaultMaxDurationSeconds: number;
  sessionTtlSeconds: number;
  maxToolCallsPerSession: number;
  toolTimeoutMs: number;
  toolMaxResponseBytes: number;
  maxTranscriptMessages: number;
}

/** Positive integer from env, falling back to the default when unset or invalid. */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function aiConfig(): AiConfig {
  const maxDurationCapSeconds = intEnv('AI_MAX_DURATION_CAP_SECONDS', 1800);
  return {
    enabled: (process.env.AI_ENABLED ?? 'false').toLowerCase() === 'true',
    maxConcurrentSessionsPerAccount: intEnv(
      'AI_MAX_CONCURRENT_SESSIONS_PER_ACCOUNT',
      3,
    ),
    globalMaxConcurrentSessions: intEnv(
      'AI_GLOBAL_MAX_CONCURRENT_SESSIONS',
      50,
    ),
    dailyMinutesPerAccount: intEnv('AI_DAILY_MINUTES_PER_ACCOUNT', 120),
    monthlyMinutesPerAccount: intEnv('AI_MONTHLY_MINUTES_PER_ACCOUNT', 1000),
    maxDurationCapSeconds,
    defaultMaxDurationSeconds: Math.min(
      intEnv('AI_DEFAULT_MAX_DURATION_SECONDS', 600),
      maxDurationCapSeconds,
    ),
    sessionTtlSeconds: intEnv('AI_SESSION_TTL_SECONDS', 300),
    maxToolCallsPerSession: intEnv('AI_MAX_TOOL_CALLS_PER_SESSION', 20),
    toolTimeoutMs: intEnv('AI_TOOL_TIMEOUT_MS', 8000),
    toolMaxResponseBytes: intEnv('AI_TOOL_MAX_RESPONSE_BYTES', 65536),
    maxTranscriptMessages: intEnv('AI_MAX_TRANSCRIPT_MESSAGES', 500),
  };
}

/**
 * `AI_TOOLS_ALLOW_INSECURE_LOCALHOST=true` lets tools call `http://localhost`
 * for local development. Off by default; never enable it in production.
 * Kept out of AiConfig so that object's shape stays as stage 1 defined it.
 */
export function aiToolsAllowInsecureLocalhost(): boolean {
  return (
    (process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST ?? 'false').toLowerCase() ===
    'true'
  );
}
