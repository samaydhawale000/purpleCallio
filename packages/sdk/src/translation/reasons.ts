import type { GuardReason } from './types';

const REASON_TEXT: Record<string, string> = {
  'term_mismatch:number': 'A number may have changed',
  'term_mismatch:amount': 'An amount may have changed',
  'term_mismatch:date': 'A date may have changed',
  'term_mismatch:phone': 'A phone number may have changed',
  'term_mismatch:lexicon': 'A key term may not have been kept',
  recognition_failed: 'The speech was hard to make out',
  low_asr_confidence: 'The speech was hard to make out',
  asr_alternatives_disagree: 'The words could have been heard differently',
  length_mismatch: 'The translation is much shorter or longer than what was said',
  language_mismatch: 'The speaker may have used a different language',
  poor_audio: 'The audio was unclear',
  late_translation: 'The translation arrived late',
  provider_error: 'The translation service had a problem',
};

/** Plain-language text for a MeaningGuard reason. Never a percentage. */
export function describeGuardReason(reason: GuardReason): string {
  if (REASON_TEXT[reason]) return REASON_TEXT[reason];
  if (reason.startsWith('term_mismatch')) return 'A key detail may have changed';
  return 'The translation may not match what was said';
}

/** Distinct, human-readable reasons for a flagged phrase. */
export function describeGuardReasons(reasons: readonly GuardReason[] | undefined): string[] {
  const out: string[] = [];
  for (const r of reasons ?? []) {
    const text = describeGuardReason(r);
    if (!out.includes(text)) out.push(text);
  }
  return out;
}
