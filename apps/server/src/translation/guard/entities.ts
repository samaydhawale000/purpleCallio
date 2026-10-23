/**
 * MeaningGuard entity extraction.
 *
 * Pulls the "facts that must survive translation" out of a piece of text —
 * numbers, money amounts, dates, times, phone numbers and emails — and
 * normalises each one to a canonical ASCII form so that the source and the
 * translation can be compared regardless of script, digit system or wording
 * ("₹2,50,000" ≡ "2.5 lakh" ≡ "2.5 लाख" ≡ "Rs 250000" → "250000").
 *
 * Pure and synchronous: no I/O. Best-effort by design — it must never throw.
 */

export interface Entities {
  /** Plain numbers ("42", "2.5") and percentages ("15%"). */
  numbers: string[];
  /** Money / scaled quantities as a plain decimal value ("250000"). */
  amounts: string[];
  /** "YYYY-MM-DD", or "MM-DD" when no year was given. */
  dates: string[];
  /** "HH:MM" — 24 h when a meridiem was given, otherwise as spoken. */
  times: string[];
  /** Digits only; Indian numbers lose the +91 / 0 trunk prefix. */
  phones: string[];
  /** Lower-cased. */
  emails: string[];
}

// ---------------------------------------------------------------------------
// Digits

/** Zero code points of every decimal digit block we normalise to ASCII. */
const DIGIT_ZEROS = [
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic (Urdu / Persian)
  0x0966, // Devanagari
  0x09e6, // Bengali / Assamese
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Odia
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0xff10, // Fullwidth
];

/** Replaces every non-ASCII decimal digit we know with its ASCII digit. */
export function normalizeDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let mapped: string | null = null;
    for (const zero of DIGIT_ZEROS) {
      if (cp >= zero && cp <= zero + 9) {
        mapped = String(cp - zero);
        break;
      }
    }
    out += mapped ?? ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Regex helpers

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const isAscii = (s: string) => /^[ -~]+$/.test(s);

/**
 * Alternation of words, longest first. ASCII words get a right word boundary
 * (so "cr" does not match "crane"); Indic words are matched as prefixes so
 * inflected forms ("लाखों", "रुपयों") still match.
 */
function alt(words: string[]): string {
  const uniq = [...new Set(words.map((w) => w.normalize('NFC')))];
  uniq.sort((a, b) => b.length - a.length);
  return uniq
    .map((w) => (isAscii(w) ? `${escapeRe(w)}(?![A-Za-z])` : escapeRe(w)))
    .join('|');
}

/** Left boundary: not glued to a letter, mark or digit. */
const LB = '(?<![\\p{L}\\p{M}\\p{N}])';
/** A number with optional Indian / western grouping and decimals. */
const NUM = '(?:\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';

// ---------------------------------------------------------------------------
// Vocabulary

const SCALES: Record<number, string[]> = {
  1e3: [
    'thousand',
    'thousands',
    'hazaar',
    'hazar',
    'hajar',
    'hazaar',
    'हज़ार',
    'हजार',
    'ஆயிரம்',
    'వేల',
    'వేలు',
    'হাজার',
    'હજાર',
    'ಸಾವಿರ',
    'ആയിരം',
    'ਹਜ਼ਾਰ',
    'ਹਜਾਰ',
    'ہزار',
    'ହଜାର',
  ],
  1e5: [
    'lakh',
    'lakhs',
    'lac',
    'lacs',
    'laakh',
    'lakh',
    'लाख',
    'லட்சம்',
    'லட்ச',
    'లక్ష',
    'లక్షల',
    'লাখ',
    'লক্ষ',
    'લાખ',
    'ಲಕ್ಷ',
    'ലക്ഷം',
    'ലക്ഷ',
    'ਲੱਖ',
    'لاکھ',
    'ଲକ୍ଷ',
  ],
  1e6: ['million', 'millions', 'mn', 'मिलियन', 'दशलक्ष'],
  1e7: [
    'crore',
    'crores',
    'cr',
    'karod',
    'karor',
    'karore',
    'करोड़',
    'करोड',
    'कोटी',
    'கோடி',
    'కోట్ల',
    'కోటి',
    'কোটি',
    'કરોડ',
    'ಕೋಟಿ',
    'കോടി',
    'ਕਰੋੜ',
    'کروڑ',
    'କୋଟି',
  ],
  1e9: ['billion', 'billions', 'bn', 'बिलियन', 'अरब'],
};

const SCALE_LOOKUP = new Map<string, number>();
for (const [value, words] of Object.entries(SCALES)) {
  for (const w of words)
    SCALE_LOOKUP.set(w.normalize('NFC').toLowerCase(), Number(value));
}

function scaleOf(word: string | undefined): number {
  if (!word) return 1;
  const w = word.normalize('NFC').toLowerCase();
  if (w === 'k') return 1e3;
  const direct = SCALE_LOOKUP.get(w);
  if (direct) return direct;
  // Indic prefix matches (inflected forms).
  for (const [key, value] of SCALE_LOOKUP) if (w.startsWith(key)) return value;
  return 1;
}

const CURRENCY_PREFIX = [
  '₹',
  '₨',
  '$',
  '€',
  '£',
  'rs.',
  'rs',
  'inr',
  'usd',
  'us$',
  'eur',
  'gbp',
  'रु.',
  'रु',
  'रू.',
  'रू',
  'ரூ.',
  'ரூ',
  'రూ.',
  'రూ',
  'টা.',
  '৳',
];

const CURRENCY_SUFFIX = [
  'rupees',
  'rupee',
  'rupaye',
  'rupaiye',
  'rupay',
  'rs',
  'inr',
  'dollars',
  'dollar',
  'usd',
  'euros',
  'euro',
  'eur',
  'pounds',
  'gbp',
  '/-',
  'रुपये',
  'रुपए',
  'रुपया',
  'रुपयों',
  'रुपयां',
  'रुपयाँ',
  'रुपय',
  'ரூபாய்',
  'రూపాయలు',
  'రూపాయి',
  'রুপি',
  'টাকা',
  'রুপিয়া',
  'રૂપિયા',
  'ರೂಪಾಯಿ',
  'രൂപ',
  'ਰੁਪਏ',
  'ਰੁਪਈਏ',
  'روپے',
  'روپیہ',
  'ଟଙ୍କା',
  'डॉलर',
  'डालर',
  'யூரோ',
  'டாலர்',
];

const PERCENT_WORDS = [
  '%',
  'percent',
  'per cent',
  'pc',
  'pct',
  'प्रतिशत',
  'फीसदी',
  'फ़ीसदी',
  'फीसद',
  'टक्के',
  'टक्का',
  'சதவீதம்',
  'சதவிகிதம்',
  'శాతం',
  'শতাংশ',
  'ટકા',
  'ಶೇಕಡಾ',
  'ಶೇಕಡ',
  'ശതമാനം',
  'ਪ੍ਰਤੀਸ਼ਤ',
  'ਫ਼ੀਸਦੀ',
  'فیصد',
  'ପ୍ରତିଶତ',
  'por ciento',
  'pour cent',
  'prozent',
  'por cento',
];

/** Month names (index 1..12) across the supported languages. */
const MONTHS: string[][] = [
  [], // 0 unused
  [
    'january',
    'jan',
    'जनवरी',
    'जानेवारी',
    'জানুয়ারি',
    'জানুয়ারী',
    'ஜனவரி',
    'జనవరి',
    'જાન્યુઆરી',
    'ಜನವರಿ',
    'ജനുവരി',
    'ਜਨਵਰੀ',
    'جنوری',
    'ଜାନୁଆରୀ',
    'enero',
    'janvier',
    'januar',
    'janeiro',
  ],
  [
    'february',
    'feb',
    'फ़रवरी',
    'फरवरी',
    'फेब्रुवारी',
    'ফেব্রুয়ারি',
    'ফেব্রুয়ারী',
    'பிப்ரவரி',
    'ఫిబ్రవరి',
    'ફેબ્રુઆરી',
    'ಫೆಬ್ರವರಿ',
    'ഫെബ്രുവരി',
    'ਫ਼ਰਵਰੀ',
    'ਫਰਵਰੀ',
    'فروری',
    'ଫେବୃଆରୀ',
    'febrero',
    'février',
    'fevrier',
    'februar',
    'fevereiro',
  ],
  [
    'march',
    'mar',
    'मार्च',
    'মার্চ',
    'மார்ச்',
    'మార్చి',
    'માર્ચ',
    'ಮಾರ್ಚ್',
    'മാർച്ച്',
    'ਮਾਰਚ',
    'مارچ',
    'ମାର୍ଚ୍ଚ',
    'marzo',
    'mars',
    'märz',
    'marz',
    'março',
    'marco',
  ],
  [
    'april',
    'apr',
    'अप्रैल',
    'अप्रेल',
    'एप्रिल',
    'এপ্রিল',
    'ஏப்ரல்',
    'ఏప్రిల్',
    'એપ્રિલ',
    'ಏಪ್ರಿಲ್',
    'ഏപ്രിൽ',
    'ਅਪ੍ਰੈਲ',
    'ਅਪਰੈਲ',
    'اپریل',
    'ଅପ୍ରେଲ',
    'abril',
    'avril',
  ],
  [
    'may',
    'मई',
    'मे',
    'মে',
    'மே',
    'మే',
    'મે',
    'ಮೇ',
    'മേയ്',
    'മെയ്',
    'ਮਈ',
    'مئی',
    'ମେ',
    'mayo',
    'mai',
    'maio',
  ],
  [
    'june',
    'jun',
    'जून',
    'জুন',
    'ஜூன்',
    'జూన్',
    'જૂન',
    'ಜೂನ್',
    'ജൂൺ',
    'ਜੂਨ',
    'جون',
    'ଜୁନ',
    'junio',
    'juin',
    'juni',
    'junho',
  ],
  [
    'july',
    'jul',
    'जुलाई',
    'जुलै',
    'জুলাই',
    'ஜூலை',
    'జూలై',
    'જુલાઈ',
    'ಜುಲೈ',
    'ജൂലൈ',
    'ਜੁਲਾਈ',
    'جولائی',
    'ଜୁଲାଇ',
    'julio',
    'juillet',
    'juli',
    'julho',
  ],
  [
    'august',
    'aug',
    'अगस्त',
    'ऑगस्ट',
    'আগস্ট',
    'ஆகஸ்ட்',
    'ఆగస్టు',
    'ઑગસ્ટ',
    'ઓગસ્ટ',
    'ಆಗಸ್ಟ್',
    'ഓഗസ്റ്റ്',
    'ആഗസ്റ്റ്',
    'ਅਗਸਤ',
    'اگست',
    'ଅଗଷ୍ଟ',
    'agosto',
    'août',
    'aout',
  ],
  [
    'september',
    'sept',
    'sep',
    'सितंबर',
    'सितम्बर',
    'सप्टेंबर',
    'সেপ্টেম্বর',
    'செப்டம்பர்',
    'సెప్టెంబర్',
    'સપ્ટેમ્બર',
    'ಸೆಪ್ಟೆಂಬರ್',
    'സെപ്റ്റംബർ',
    'ਸਤੰਬਰ',
    'ستمبر',
    'ସେପ୍ଟେମ୍ବର',
    'septiembre',
    'septembre',
    'setembro',
  ],
  [
    'october',
    'oct',
    'अक्टूबर',
    'अक्तूबर',
    'ऑक्टोबर',
    'অক্টোবর',
    'அக்டோபர்',
    'అక్టోబర్',
    'ઑક્ટોબર',
    'ઓક્ટોબર',
    'ಅಕ್ಟೋಬರ್',
    'ഒക്ടോബർ',
    'ਅਕਤੂਬਰ',
    'اکتوبر',
    'ଅକ୍ଟୋବର',
    'octubre',
    'octobre',
    'oktober',
    'outubro',
  ],
  [
    'november',
    'nov',
    'नवंबर',
    'नवम्बर',
    'नोव्हेंबर',
    'নভেম্বর',
    'நவம்பர்',
    'నవంబర్',
    'નવેમ્બર',
    'ನವೆಂಬರ್',
    'നവംബർ',
    'ਨਵੰਬਰ',
    'نومبر',
    'ନଭେମ୍ବର',
    'noviembre',
    'novembre',
    'novembro',
  ],
  [
    'december',
    'dec',
    'दिसंबर',
    'दिसम्बर',
    'डिसेंबर',
    'ডিসেম্বর',
    'டிசம்பர்',
    'డిసెంబర్',
    'ડિસેમ્બર',
    'ಡಿಸೆಂಬರ್',
    'ഡിസംബർ',
    'ਦਸੰਬਰ',
    'دسمبر',
    'ଡିସେମ୍ବର',
    'diciembre',
    'décembre',
    'decembre',
    'dezember',
    'dezembro',
  ],
];

const MONTH_LOOKUP = new Map<string, number>();
MONTHS.forEach((names, idx) => {
  for (const n of names)
    MONTH_LOOKUP.set(n.normalize('NFC').toLowerCase(), idx);
});

function monthOf(word: string): number | null {
  return MONTH_LOOKUP.get(word.normalize('NFC').toLowerCase()) ?? null;
}

/** Month names need a right boundary in every script ("मे" ≠ "मेरे"). */
const MONTH_ALT = [...MONTH_LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join('|');
const MONTH_RE = `(${MONTH_ALT})\\.?(?![\\p{L}\\p{M}])`;

const MERIDIEM = '(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![A-Za-z])';
const CLOCK_WORDS = [
  'बजे',
  'बजकर',
  'वाजता',
  'वाजून',
  "o'clock",
  'oclock',
  'baje',
];

// ---------------------------------------------------------------------------
// Compiled patterns (Unicode + case-insensitive)

const F = 'giu';

const EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

const ISO_DATE_RE = new RegExp(
  `${LB}(\\d{4})-(\\d{1,2})-(\\d{1,2})(?![\\p{N}])`,
  F,
);
const NUMERIC_DATE_RE = new RegExp(
  `${LB}(\\d{1,2})([/.-])(\\d{1,2})\\2(\\d{4}|\\d{2})(?![\\p{N}])`,
  F,
);
const DAY_MONTH_RE = new RegExp(
  `${LB}(\\d{1,2})(?:st|nd|rd|th|[\\p{L}\\p{M}]{1,4})?\\.?\\s*(?:of\\s+|de\\s+)?${MONTH_RE}(?:,?\\s*(?:de\\s+)?(\\d{4}))?(?![\\p{N}])`,
  F,
);
const MONTH_DAY_RE = new RegExp(
  `(?<![\\p{L}\\p{M}])${MONTH_RE}\\s*(\\d{1,2})(?:st|nd|rd|th)?(?![\\p{N}])(?:,?\\s*(\\d{4})(?![\\p{N}]))?`,
  F,
);

const TIME_MERIDIEM_RE = new RegExp(
  `${LB}(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MERIDIEM}`,
  F,
);
const TIME_CLOCK_WORD_RE = new RegExp(
  `${LB}(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:${alt(CLOCK_WORDS)})`,
  F,
);
const TIME_COLON_RE = new RegExp(`${LB}(\\d{1,2}):(\\d{2})(?![\\p{N}])`, F);

/** Groups of digits separated by a single space / hyphen / dot-free chars. */
const PHONE_RE = /(?<![\p{L}\p{N}+])(\+?\(?\d[\d\s\-()]{8,22}\d)(?![\p{N}])/gu;

const SCALE_ALT = alt(Object.values(SCALES).flat());
const AMOUNT_PREFIX_RE = new RegExp(
  `(?<![\\p{L}\\p{M}])(?:${alt(CURRENCY_PREFIX)})\\s*(${NUM})(?:(k)(?![\\p{L}])|\\s*(${SCALE_ALT}))?(?:\\s*/-)?`,
  F,
);
const AMOUNT_SUFFIX_RE = new RegExp(
  `${LB}(${NUM})(?:(k)(?![\\p{L}])|\\s*(${SCALE_ALT}))?(?:\\s*(${alt(CURRENCY_SUFFIX)}))?`,
  F,
);
const PERCENT_RE = new RegExp(`${LB}(${NUM})\\s*(?:${alt(PERCENT_WORDS)})`, F);
const NUMBER_RE = new RegExp(`(?<![A-Za-z\\p{N}.])(${NUM})(?![\\p{N}])`, F);

// ---------------------------------------------------------------------------
// Canonical forms

/** "2,50,000" → "250000", "007" → "7", "2.50" → "2.5". */
export function canonicalNumber(raw: string): string {
  let s = raw.replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(s)) return s;
  let [int, frac = ''] = s.split('.');
  int = int.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  s = frac ? `${int}.${frac}` : int;
  return s;
}

function scaledValue(raw: string, scale: number): string {
  const base = canonicalNumber(raw);
  if (scale === 1) return base;
  const n = Number(base);
  if (!Number.isFinite(n)) return base;
  const v = Math.round(n * scale * 100) / 100;
  return canonicalNumber(v.toFixed(2));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function canonicalDate(
  day: number,
  month: number,
  year: number | null,
): string | null {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  return year == null
    ? `${pad2(month)}-${pad2(day)}`
    : `${year}-${pad2(month)}-${pad2(day)}`;
}

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

// ---------------------------------------------------------------------------
// Extraction

class Scanner {
  constructor(public text: string) {}

  /** Runs `re` over the text, masking each accepted match with spaces. */
  take(re: RegExp, accept: (m: RegExpExecArray) => boolean): void {
    re.lastIndex = 0;
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (accept(m)) {
        out += this.text.slice(last, m.index) + ' '.repeat(m[0].length);
        last = m.index + m[0].length;
      }
    }
    this.text = out + this.text.slice(last);
  }
}

function pushUnique(list: string[], value: string | null | undefined): void {
  if (value && !list.includes(value)) list.push(value);
}

/** Canonical phone: digits only, Indian trunk / country prefix removed. */
export function canonicalPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/**
 * Extracts and normalises numbers, amounts, dates, times, phone numbers and
 * emails. `language` (BCP-47-ish) only affects ambiguous numeric dates:
 * `en-US` reads "10/22/2026" month-first; everything else day-first.
 */
export function extractEntities(text: string, language?: string): Entities {
  const result: Entities = {
    numbers: [],
    amounts: [],
    dates: [],
    times: [],
    phones: [],
    emails: [],
  };
  if (!text || typeof text !== 'string') return result;

  const monthFirst =
    (language ?? '').toLowerCase().replace('_', '-') === 'en-us';
  const s = new Scanner(normalizeDigits(text.normalize('NFC')));

  s.take(EMAIL_RE, (m) => {
    pushUnique(result.emails, m[0].toLowerCase());
    return true;
  });

  s.take(ISO_DATE_RE, (m) => {
    const d = canonicalDate(Number(m[3]), Number(m[2]), Number(m[1]));
    pushUnique(result.dates, d);
    return d !== null;
  });

  s.take(NUMERIC_DATE_RE, (m) => {
    // "1.2.30"-style version strings are not dates: dots need a 4-digit year.
    if (m[2] !== '/' && m[4].length !== 4) return false;
    const a = Number(m[1]);
    const b = Number(m[3]);
    // Day-first (India) unless only month-first is valid; en-US the reverse.
    let day = monthFirst ? b : a;
    let month = monthFirst ? a : b;
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const d = canonicalDate(day, month, fullYear(m[4]));
    pushUnique(result.dates, d);
    return d !== null;
  });

  s.take(DAY_MONTH_RE, (m) => {
    const month = monthOf(m[2]);
    const d = month
      ? canonicalDate(Number(m[1]), month, m[3] ? Number(m[3]) : null)
      : null;
    pushUnique(result.dates, d);
    return d !== null;
  });

  s.take(MONTH_DAY_RE, (m) => {
    const month = monthOf(m[1]);
    const d = month
      ? canonicalDate(Number(m[2]), month, m[3] ? Number(m[3]) : null)
      : null;
    pushUnique(result.dates, d);
    return d !== null;
  });

  const addTime = (
    h: number,
    min: number,
    meridiem: string | null,
  ): boolean => {
    if (min > 59) return false;
    if (meridiem) {
      if (h < 1 || h > 12) return false;
      const pm = meridiem.toLowerCase().startsWith('p');
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    } else if (h > 24) return false;
    pushUnique(result.times, `${pad2(h)}:${pad2(min)}`);
    return true;
  };

  s.take(TIME_MERIDIEM_RE, (m) =>
    addTime(Number(m[1]), Number(m[2] ?? 0), m[3]),
  );
  s.take(TIME_CLOCK_WORD_RE, (m) =>
    addTime(Number(m[1]), Number(m[2] ?? 0), null),
  );
  s.take(TIME_COLON_RE, (m) => addTime(Number(m[1]), Number(m[2]), null));

  s.take(PHONE_RE, (m) => {
    const raw = m[1];
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) return false;
    const groups = raw.split(/[^\d]+/).filter(Boolean);
    const plausible = raw.startsWith('+') || groups.some((g) => g.length >= 4);
    if (!plausible) return false;
    pushUnique(result.phones, canonicalPhone(raw));
    return true;
  });

  s.take(AMOUNT_PREFIX_RE, (m) => {
    pushUnique(result.amounts, scaledValue(m[1], scaleOf(m[2] ?? m[3])));
    return true;
  });

  s.take(PERCENT_RE, (m) => {
    pushUnique(result.numbers, `${canonicalNumber(m[1])}%`);
    return true;
  });

  s.take(AMOUNT_SUFFIX_RE, (m) => {
    const scaleWord = m[2] ?? m[3];
    if (!scaleWord && !m[4]) return false; // a plain number
    pushUnique(result.amounts, scaledValue(m[1], scaleOf(scaleWord)));
    return true;
  });

  s.take(NUMBER_RE, (m) => {
    pushUnique(result.numbers, canonicalNumber(m[1]));
    return true;
  });

  return result;
}
