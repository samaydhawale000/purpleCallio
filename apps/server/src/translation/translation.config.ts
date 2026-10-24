/**
 * Live Translate configuration (see translation/PROTOCOL.md §8). Read from
 * env on every call, like ai.config.ts, so tests and ops can flip values
 * without a restart.
 */
export interface TranslationEnvConfig {
  enabled: boolean;
  /** `TRANSLATION_MOCK_PROVIDER=true` forces the offline mock route. */
  mockProvider: boolean;
  maxConcurrentCallsPerAccount: number;
  globalMaxConcurrentCalls: number;
  /** Mock provider: delay before the translation of a phrase. */
  mockLatencyMs: number;
}

function intEnv(name: string, fallback: number, allowZero = false): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && (value > 0 || (allowZero && value === 0))
    ? value
    : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

export function translationConfig(): TranslationEnvConfig {
  return {
    enabled: boolEnv('TRANSLATION_ENABLED', false),
    mockProvider: boolEnv('TRANSLATION_MOCK_PROVIDER', false),
    maxConcurrentCallsPerAccount: intEnv(
      'TRANSLATION_MAX_CONCURRENT_CALLS_PER_ACCOUNT',
      5,
    ),
    globalMaxConcurrentCalls: intEnv(
      'TRANSLATION_GLOBAL_MAX_CONCURRENT_CALLS',
      100,
    ),
    mockLatencyMs: intEnv('TRANSLATION_MOCK_LATENCY_MS', 300, true),
  };
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
