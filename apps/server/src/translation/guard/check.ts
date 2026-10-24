/**
 * MeaningGuard text check: did the facts of the source survive translation?
 *
 * Compares normalised entities on both sides (a number/amount/date/time/phone
 * in the source must reappear in the translation), verifies PurpleLex terms
 * and sanity-checks the length ratio. Returns protocol reason codes only —
 * never numbers or percentages.
 */
import {
  canonicalNumber,
  extractEntities,
  normalizeDigits,
  type Entities,
} from './entities';
import { applyLexicon, type LexiconTerm } from './lexicon-correct';

export interface CheckTranslationInput {
  source: string;
  translated: string;
  sourceLanguage: string;
  targetLanguage: string;
  lexicon?: LexiconTerm[];
}

export interface CheckTranslationResult {
  reasons: string[];
  lexiconHits: number;
}

/** Small numbers are often written out as words; accept the common ones. */
const NUMBER_WORDS: Record<string, string[]> = {
  '0': ['zero', 'शून्य', 'शून्य', 'cero', 'zéro', 'null'],
  '1': [
    'one',
    'a',
    'an',
    'एक',
    'ek',
    'এক',
    'ஒரு',
    'ஒன்று',
    'ఒక',
    'ఒకటి',
    'એક',
    'ಒಂದು',
    'ഒരു',
    'ഒന്ന്',
    'ਇੱਕ',
    'ایک',
    'uno',
    'una',
    'un',
    'une',
    'ein',
    'eine',
    'um',
    'uma',
  ],
  '2': [
    'two',
    'दो',
    'दोन',
    'do',
    'দুই',
    'দু',
    'இரண்டு',
    'రెండు',
    'બે',
    'ಎರಡು',
    'രണ്ട്',
    'ਦੋ',
    'دو',
    'dos',
    'deux',
    'zwei',
    'dois',
    'duas',
  ],
  '3': [
    'three',
    'तीन',
    'teen',
    'তিন',
    'மூன்று',
    'మూడు',
    'ત્રણ',
    'ಮೂರು',
    'മൂന്ന്',
    'ਤਿੰਨ',
    'تین',
    'tres',
    'trois',
    'drei',
    'três',
  ],
  '4': [
    'four',
    'चार',
    'char',
    'চার',
    'நான்கு',
    'నాలుగు',
    'ચાર',
    'ನಾಲ್ಕು',
    'നാല്',
    'ਚਾਰ',
    'چار',
    'cuatro',
    'quatre',
    'vier',
    'quatro',
  ],
  '5': [
    'five',
    'पाँच',
    'पांच',
    'पाच',
    'paanch',
    'পাঁচ',
    'ஐந்து',
    'ఐదు',
    'પાંચ',
    'ಐದು',
    'അഞ്ച്',
    'ਪੰਜ',
    'پانچ',
    'cinco',
    'cinq',
    'fünf',
  ],
  '6': [
    'six',
    'छह',
    'छः',
    'सहा',
    'chhah',
    'ছয়',
    'ஆறு',
    'ఆరు',
    'છ',
    'ಆರು',
    'ആറ്',
    'ਛੇ',
    'چھ',
    'seis',
    'sechs',
  ],
  '7': [
    'seven',
    'सात',
    'saat',
    'সাত',
    'ஏழு',
    'ఏడు',
    'સાત',
    'ಏಳು',
    'ഏഴ്',
    'ਸੱਤ',
    'سات',
    'siete',
    'sept',
    'sieben',
    'sete',
  ],
  '8': [
    'eight',
    'आठ',
    'आठ',
    'aath',
    'আট',
    'எட்டு',
    'ఎనిమిది',
    'આઠ',
    'ಎಂಟು',
    'എട്ട്',
    'ਅੱਠ',
    'آٹھ',
    'ocho',
    'huit',
    'acht',
    'oito',
  ],
  '9': [
    'nine',
    'नौ',
    'नऊ',
    'nau',
    'নয়',
    'ஒன்பது',
    'తొమ్మిది',
    'નવ',
    'ಒಂಬತ್ತು',
    'ഒമ്പത്',
    'ਨੌਂ',
    'نو',
    'nueve',
    'neuf',
    'neun',
    'nove',
  ],
};

function hasWord(text: string, word: string): boolean {
  const w = word.normalize('NFC');
  if (/^[ -~]+$/.test(w)) {
    return new RegExp(`(?<![A-Za-z])${w}(?![A-Za-z])`, 'i').test(text);
  }
  return text.includes(w);
}

/** Weighted visible length: marks/space/punctuation ignored, CJK weighted up. */
export function visibleLength(text: string): number {
  let n = 0;
  for (const ch of (text ?? '').normalize('NFC')) {
    if (/[\p{M}\p{Z}\p{P}\p{S}\p{C}]/u.test(ch)) continue;
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch))
      n += 3;
    else if (/\p{Script=Hangul}/u.test(ch)) n += 2;
    else n += 1;
  }
  return n;
}

const MIN_LENGTH_FOR_RATIO = 12;
const MIN_RATIO = 0.25;
const MAX_RATIO = 4;

function sameTime(a: string, b: string): boolean {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  // Meridiem is often implicit ("शाम 5 बजे" ≡ "5 pm"): compare on a 12 h clock.
  return am === bm && ah % 12 === bh % 12;
}

function sameDate(a: string, b: string): boolean {
  if (a === b) return true;
  // One side without a year ("22 Oct") matches the same day with a year.
  const short = (d: string) => (d.length === 5 ? d : d.slice(5));
  return (a.length === 5 || b.length === 5) && short(a) === short(b);
}

export function checkTranslation(
  input: CheckTranslationInput,
): CheckTranslationResult {
  const source = input.source ?? '';
  const translated = input.translated ?? '';
  const reasons = new Set<string>();

  const src = extractEntities(source, input.sourceLanguage);
  const out = extractEntities(translated, input.targetLanguage);
  const outText = normalizeDigits(translated.normalize('NFC'));
  const valuePool = new Set([...out.numbers, ...out.amounts]);
  const outDigits = outText.replace(/\D/g, '');

  // Numbers (incl. percentages) and amounts: the value must survive; whether
  // the currency word did is not a meaning change worth flagging.
  for (const n of src.numbers) {
    if (valuePool.has(n)) continue;
    if (
      /^\d$/.test(n) &&
      (NUMBER_WORDS[n] ?? []).some((w) => hasWord(outText, w))
    )
      continue;
    reasons.add('term_mismatch:number');
  }
  for (const a of src.amounts) {
    if (!valuePool.has(a)) reasons.add('term_mismatch:amount');
  }

  for (const d of src.dates) {
    if (out.dates.some((o) => sameDate(d, o))) continue;
    if (dateNumbersPresent(d, out)) continue;
    reasons.add('term_mismatch:date');
  }
  for (const t of src.times) {
    if (out.times.some((o) => sameTime(t, o))) continue;
    if (timeNumbersPresent(t, out)) continue;
    reasons.add('term_mismatch:date');
  }

  for (const p of src.phones) {
    if (out.phones.includes(p) || outDigits.includes(p)) continue;
    reasons.add('term_mismatch:phone');
  }

  let lexiconHits = 0;
  if (input.lexicon?.length) {
    const lex = applyLexicon({
      source,
      translated,
      targetLanguage: input.targetLanguage,
      lexicon: input.lexicon,
    });
    lexiconHits = lex.applied.length;
    if (lex.missing.length) reasons.add('term_mismatch:lexicon');
  }

  const srcLen = visibleLength(source);
  if (srcLen >= MIN_LENGTH_FOR_RATIO) {
    const ratio = visibleLength(translated) / srcLen;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) reasons.add('length_mismatch');
  }

  return { reasons: [...reasons], lexiconHits };
}

/**
 * Month names in a language we do not know leave the day/year as plain
 * numbers; accept the date when those numbers are all present and no other
 * recognised date contradicts it.
 */
function dateNumbersPresent(date: string, out: Entities): boolean {
  if (out.dates.length) return false;
  const parts = date.split('-');
  const day = canonicalNumber(parts[parts.length - 1]);
  const year = parts.length === 3 ? parts[0] : null;
  const pool = new Set([...out.numbers, ...out.amounts]);
  return pool.has(day) && (year === null || pool.has(year));
}

function timeNumbersPresent(time: string, out: Entities): boolean {
  if (out.times.length) return false;
  const [h, m] = time.split(':').map(Number);
  const hours = [h, h % 12 === 0 ? 12 : h % 12].map(String);
  const pool = new Set([...out.numbers, ...out.amounts]);
  if (m === 0) return hours.some((x) => pool.has(x));
  return hours.some((x) =>
    pool.has(canonicalNumber(`${x}.${String(m).padStart(2, '0')}`)),
  );
}
