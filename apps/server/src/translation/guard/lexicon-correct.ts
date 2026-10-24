/**
 * PurpleLex: enforce and verify a project's glossary on a translated phrase.
 *
 * - DO_NOT_TRANSLATE: the term must appear verbatim in the output.
 * - TRANSLATE_AS: the agreed target-language form must appear.
 * - PRONOUNCE_AS: a speech-synthesis hint only; verified when visible, never
 *   reported missing (the text may legitimately transliterate it).
 *
 * Latin-script terms are matched on word boundaries; terms in other scripts
 * by substring (Indic words inflect and have no reliable boundaries).
 */
import type { TranslationLexiconHint } from '../providers/translation-provider.interface';

export interface LexiconTerm {
  term: string;
  kind: 'DO_NOT_TRANSLATE' | 'TRANSLATE_AS' | 'PRONOUNCE_AS';
  /** Language code → agreed translation (TRANSLATE_AS) or known literal rendering to undo (DO_NOT_TRANSLATE). */
  translations?: Record<string, string> | null;
  pronunciation?: string | null;
  caseSensitive?: boolean;
}

export interface ApplyLexiconInput {
  source: string;
  translated: string;
  targetLanguage: string;
  lexicon: LexiconTerm[];
}

export interface ApplyLexiconResult {
  text: string;
  /** Terms present in the source that were verified or enforced in the output. */
  applied: string[];
  /** Terms present in the source that could not be verified in the output. */
  missing: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** True when every letter of the string is Latin (ASCII or Latin-1/Extended). */
function isLatin(s: string): boolean {
  return !/[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}]/u.test(s);
}

function matcher(term: string, caseSensitive: boolean, global = false): RegExp {
  const t = term.normalize('NFC');
  const flags = `u${caseSensitive ? '' : 'i'}${global ? 'g' : ''}`;
  if (isLatin(t)) {
    return new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{M}\\p{N}])`,
      flags,
    );
  }
  return new RegExp(escapeRe(t), flags);
}

function contains(text: string, term: string, caseSensitive: boolean): boolean {
  if (!term) return false;
  return matcher(term, caseSensitive).test(text);
}

function replaceAll(
  text: string,
  find: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  return text.replace(matcher(find, caseSensitive, true), () => replacement);
}

/** translations[lang] with fallback to the base language ("hi-IN" → "hi"). */
export function translationFor(
  term: LexiconTerm,
  language: string,
): string | null {
  const map = term.translations;
  if (!map) return null;
  const lang = (language ?? '').trim();
  const candidates = [
    lang,
    lang.toLowerCase(),
    lang.toLowerCase().split(/[-_]/)[0],
  ];
  for (const key of candidates) {
    const v = map[key];
    if (typeof v === 'string' && v.trim()) return v.trim().normalize('NFC');
  }
  // Case-insensitive key lookup ("hi-in" vs "hi-IN").
  const base = candidates[2];
  for (const [k, v] of Object.entries(map)) {
    if (
      k.toLowerCase().split(/[-_]/)[0] === base &&
      typeof v === 'string' &&
      v.trim()
    ) {
      return v.trim().normalize('NFC');
    }
  }
  return null;
}

function cleanLexicon(
  lexicon: LexiconTerm[] | null | undefined,
): LexiconTerm[] {
  const seen = new Set<string>();
  const out: LexiconTerm[] = [];
  for (const t of lexicon ?? []) {
    const term =
      typeof t?.term === 'string' ? t.term.trim().normalize('NFC') : '';
    if (!term) continue;
    const key = `${t.kind}\u0000${term.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...t, term });
  }
  // Longer terms first so "CT scan" is handled before "CT".
  return out.sort((a, b) => b.term.length - a.term.length);
}

export function applyLexicon(input: ApplyLexiconInput): ApplyLexiconResult {
  const source = (input.source ?? '').normalize('NFC');
  let text = (input.translated ?? '').normalize('NFC');
  const applied: string[] = [];
  const missing: string[] = [];

  for (const entry of cleanLexicon(input.lexicon)) {
    const cs = entry.caseSensitive === true;
    if (!contains(source, entry.term, cs)) continue;

    if (entry.kind === 'DO_NOT_TRANSLATE') {
      if (contains(text, entry.term, cs)) {
        applied.push(entry.term);
        continue;
      }
      // Wrong casing of a case-sensitive brand name ("purplecallio").
      if (cs && contains(text, entry.term, false)) {
        text = replaceAll(text, entry.term, entry.term, false);
        applied.push(entry.term);
        continue;
      }
      // Known literal translations / transliterations → restore the term.
      const variants = [
        translationFor(entry, input.targetLanguage),
        entry.pronunciation?.trim(),
      ]
        .filter((v): v is string => !!v && v !== entry.term)
        .map((v) => v.normalize('NFC'));
      const hit = variants.find((v) => contains(text, v, false));
      if (hit) {
        text = replaceAll(text, hit, entry.term, false);
        applied.push(entry.term);
        continue;
      }
      missing.push(entry.term);
      continue;
    }

    if (entry.kind === 'TRANSLATE_AS') {
      const agreed = translationFor(entry, input.targetLanguage);
      if (!agreed) continue; // nothing agreed for this language → nothing to verify
      if (contains(text, agreed, false)) {
        applied.push(entry.term);
        continue;
      }
      if (contains(text, entry.term, cs)) {
        text = replaceAll(text, entry.term, agreed, cs);
        applied.push(entry.term);
        continue;
      }
      missing.push(entry.term);
      continue;
    }

    // PRONOUNCE_AS: verify only when visible.
    if (
      contains(text, entry.term, cs) ||
      (entry.pronunciation && contains(text, entry.pronunciation.trim(), false))
    ) {
      applied.push(entry.term);
    }
  }

  return { text, applied, missing };
}

/** Maps a lexicon to provider hints for one target language. */
export function lexiconHints(
  lexicon: LexiconTerm[] | null | undefined,
  targetLanguage: string,
): TranslationLexiconHint[] {
  const hints: TranslationLexiconHint[] = [];
  for (const entry of cleanLexicon(lexicon)) {
    if (entry.kind === 'DO_NOT_TRANSLATE') {
      hints.push({ term: entry.term, kind: 'DO_NOT_TRANSLATE' });
    } else if (entry.kind === 'TRANSLATE_AS') {
      const translation = translationFor(entry, targetLanguage);
      if (translation)
        hints.push({ term: entry.term, kind: 'TRANSLATE_AS', translation });
    } else if (entry.kind === 'PRONOUNCE_AS') {
      const pronunciation = entry.pronunciation?.trim();
      if (pronunciation)
        hints.push({ term: entry.term, kind: 'PRONOUNCE_AS', pronunciation });
    }
  }
  return hints;
}
