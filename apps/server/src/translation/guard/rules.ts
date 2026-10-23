/**
 * MeaningGuard decision rules: turn per-phrase signals into `ok` / `uncertain`
 * plus the protocol reason codes (PROTOCOL.md §2). Reasons are fixed strings —
 * never numbers or percentages.
 */

export type GuardSensitivity = 'low' | 'standard' | 'high';

export interface GuardSignals {
  /** Reasons from checkTranslation (term_mismatch:*, may include length_mismatch). */
  termReasons: string[];
  recognitionFailed?: boolean;
  asrConfidence?: number | null;
  alternativesDisagree?: boolean;
  lengthMismatch?: boolean;
  languageMismatch?: boolean;
  poorAudio?: boolean;
  lateTranslation?: boolean;
  providerError?: boolean;
}

export interface GuardResult {
  status: 'ok' | 'uncertain';
  reasons: string[];
}

/** Translation arriving later than this after end of speech counts as late. */
export const LATE_TRANSLATION_MS = 6000;

export const TERM_MISMATCH_REASONS = [
  'term_mismatch:number',
  'term_mismatch:amount',
  'term_mismatch:date',
  'term_mismatch:phone',
  'term_mismatch:lexicon',
] as const;

const HARD_REASONS = new Set<string>([
  ...TERM_MISMATCH_REASONS,
  'recognition_failed',
  'provider_error',
]);

const SOFT_REASONS = new Set<string>([
  'low_asr_confidence',
  'asr_alternatives_disagree',
  'length_mismatch',
  'language_mismatch',
  'poor_audio',
  'late_translation',
]);

/** Every reason code a guard result can contain. */
export const GUARD_REASONS: readonly string[] = [
  ...HARD_REASONS,
  ...SOFT_REASONS,
];

const CONFIDENCE_THRESHOLD: Record<GuardSensitivity, number> = {
  low: 0.4,
  standard: 0.55,
  high: 0.7,
};

const SOFT_FLAG_COUNT: Record<GuardSensitivity, number> = {
  low: 3,
  standard: 2,
  high: 1,
};

function normalizeSensitivity(s: unknown): GuardSensitivity {
  return s === 'low' || s === 'high' ? s : 'standard';
}

export function evaluateGuard(
  s: GuardSignals,
  sensitivity: GuardSensitivity = 'standard',
): GuardResult {
  const level = normalizeSensitivity(sensitivity);
  const hard: string[] = [];
  const soft: string[] = [];
  const add = (reason: string) => {
    if (HARD_REASONS.has(reason)) {
      if (!hard.includes(reason)) hard.push(reason);
    } else if (SOFT_REASONS.has(reason)) {
      if (!soft.includes(reason)) soft.push(reason);
    }
    // Anything else is not protocol vocabulary and is dropped.
  };

  for (const r of s?.termReasons ?? []) if (typeof r === 'string') add(r);
  if (s?.recognitionFailed) add('recognition_failed');
  if (s?.providerError) add('provider_error');

  const conf = s?.asrConfidence;
  if (
    typeof conf === 'number' &&
    Number.isFinite(conf) &&
    conf < CONFIDENCE_THRESHOLD[level]
  ) {
    add('low_asr_confidence');
  }
  if (s?.alternativesDisagree) add('asr_alternatives_disagree');
  if (s?.lengthMismatch) add('length_mismatch');
  if (s?.languageMismatch) add('language_mismatch');
  if (s?.poorAudio) add('poor_audio');
  if (s?.lateTranslation) add('late_translation');

  const uncertain = hard.length > 0 || soft.length >= SOFT_FLAG_COUNT[level];
  return {
    status: uncertain ? 'uncertain' : 'ok',
    reasons: [...hard, ...soft],
  };
}
