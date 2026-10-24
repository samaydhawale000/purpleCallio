/**
 * Live Translate language table (PROTOCOL.md §0, §1 GET /translation/languages).
 *
 * Capability flags come from the provider docs (checked 2026-10-22):
 * - OpenAI gpt-realtime-translate: 70+ input languages, 13 output languages
 *   (es, pt, fr, ja, ru, zh, de, ko, hi, id, vi, it, en).
 *   https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide
 *   https://developers.openai.com/api/docs/guides/realtime-translation
 * - Sarvam STT (saaras:v3/v4): en-IN + 22 scheduled languages.
 *   https://docs.sarvam.ai/api-reference/speech-to-text/transcribe
 * - Sarvam text translate (sarvam-translate:v1): en + 22 scheduled languages.
 *   https://docs.sarvam.ai/api-reference/text/translate-text
 * - Sarvam TTS (bulbul:v3): bn, en, gu, hi, kn, ml, mr, od, pa, ta, te (all -IN).
 *   https://docs.sarvam.ai/api-reference/text-to-speech/convert
 */

export interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
  /** ISO 15924 script code. */
  script: string;
  rtl: boolean;
  /** One of India's 22 scheduled languages. */
  indic: boolean;
  openai: { input: boolean; output: boolean };
  sarvam: { stt: boolean; translate: boolean; tts: boolean };
}

function lang(
  code: string,
  name: string,
  nativeName: string,
  script: string,
  indic: boolean,
  flags: {
    oaIn?: boolean;
    oaOut?: boolean;
    stt?: boolean;
    translate?: boolean;
    tts?: boolean;
    rtl?: boolean;
  },
): LanguageInfo {
  return {
    code,
    name,
    nativeName,
    script,
    rtl: Boolean(flags.rtl),
    indic,
    openai: { input: Boolean(flags.oaIn), output: Boolean(flags.oaOut) },
    sarvam: {
      stt: Boolean(flags.stt),
      translate: Boolean(flags.translate),
      tts: Boolean(flags.tts),
    },
  };
}

/** Sarvam STT + sarvam-translate support all 22 scheduled languages. */
const SARVAM_TEXT = { stt: true, translate: true };
const SARVAM_FULL = { stt: true, translate: true, tts: true };

export const LANGUAGES: LanguageInfo[] = [
  // ── English ──────────────────────────────────────────
  lang('en', 'English', 'English', 'Latn', false, {
    oaIn: true,
    oaOut: true,
    ...SARVAM_FULL,
  }),

  // ── 22 scheduled languages of India ──────────────────
  lang('as', 'Assamese', 'অসমীয়া', 'Beng', true, { ...SARVAM_TEXT }),
  lang('bn', 'Bengali', 'বাংলা', 'Beng', true, { oaIn: true, ...SARVAM_FULL }),
  lang('brx', 'Bodo', 'बड़ो', 'Deva', true, { ...SARVAM_TEXT }),
  lang('doi', 'Dogri', 'डोगरी', 'Deva', true, { ...SARVAM_TEXT }),
  lang('gu', 'Gujarati', 'ગુજરાતી', 'Gujr', true, {
    oaIn: true,
    ...SARVAM_FULL,
  }),
  lang('hi', 'Hindi', 'हिन्दी', 'Deva', true, {
    oaIn: true,
    oaOut: true,
    ...SARVAM_FULL,
  }),
  lang('kn', 'Kannada', 'ಕನ್ನಡ', 'Knda', true, { ...SARVAM_FULL }),
  lang('ks', 'Kashmiri', 'كٲشُر', 'Arab', true, { ...SARVAM_TEXT, rtl: true }),
  lang('kok', 'Konkani', 'कोंकणी', 'Deva', true, { ...SARVAM_TEXT }),
  lang('mai', 'Maithili', 'मैथिली', 'Deva', true, { ...SARVAM_TEXT }),
  lang('ml', 'Malayalam', 'മലയാളം', 'Mlym', true, {
    oaIn: true,
    ...SARVAM_FULL,
  }),
  // Sarvam returns Manipuri in Bengali script in practice; Meetei Mayek is the
  // official script. // unverified
  lang('mni', 'Manipuri', 'ꯃꯤꯇꯩꯂꯣꯟ', 'Mtei', true, { ...SARVAM_TEXT }),
  lang('mr', 'Marathi', 'मराठी', 'Deva', true, { ...SARVAM_FULL }),
  lang('ne', 'Nepali', 'नेपाली', 'Deva', true, { oaIn: true, ...SARVAM_TEXT }),
  lang('or', 'Odia', 'ଓଡ଼ିଆ', 'Orya', true, { ...SARVAM_FULL }),
  lang('pa', 'Punjabi', 'ਪੰਜਾਬੀ', 'Guru', true, { oaIn: true, ...SARVAM_FULL }),
  lang('sa', 'Sanskrit', 'संस्कृतम्', 'Deva', true, { ...SARVAM_TEXT }),
  lang('sat', 'Santali', 'ᱥᱟᱱᱛᱟᱲᱤ', 'Olck', true, { ...SARVAM_TEXT }),
  lang('sd', 'Sindhi', 'سنڌي', 'Arab', true, { ...SARVAM_TEXT, rtl: true }),
  lang('ta', 'Tamil', 'தமிழ்', 'Taml', true, { ...SARVAM_FULL }),
  lang('te', 'Telugu', 'తెలుగు', 'Telu', true, { oaIn: true, ...SARVAM_FULL }),
  lang('ur', 'Urdu', 'اردو', 'Arab', true, { ...SARVAM_TEXT, rtl: true }),

  // ── Major global languages (OpenAI route) ────────────
  lang('es', 'Spanish', 'Español', 'Latn', false, { oaIn: true, oaOut: true }),
  lang('fr', 'French', 'Français', 'Latn', false, { oaIn: true, oaOut: true }),
  lang('de', 'German', 'Deutsch', 'Latn', false, { oaIn: true, oaOut: true }),
  lang('it', 'Italian', 'Italiano', 'Latn', false, { oaIn: true, oaOut: true }),
  lang('pt', 'Portuguese', 'Português', 'Latn', false, {
    oaIn: true,
    oaOut: true,
  }),
  lang('ja', 'Japanese', '日本語', 'Jpan', false, { oaIn: true, oaOut: true }),
  lang('ko', 'Korean', '한국어', 'Kore', false, { oaIn: true, oaOut: true }),
  lang('zh', 'Chinese', '中文', 'Hans', false, { oaIn: true, oaOut: true }),
  lang('ru', 'Russian', 'Русский', 'Cyrl', false, { oaIn: true, oaOut: true }),
  lang('id', 'Indonesian', 'Bahasa Indonesia', 'Latn', false, {
    oaIn: true,
    oaOut: true,
  }),
  lang('vi', 'Vietnamese', 'Tiếng Việt', 'Latn', false, {
    oaIn: true,
    oaOut: true,
  }),
  // Input-only on gpt-realtime-translate (not among the 13 output languages).
  lang('ar', 'Arabic', 'العربية', 'Arab', false, { oaIn: true, rtl: true }),
  lang('tr', 'Turkish', 'Türkçe', 'Latn', false, { oaIn: true }),
  lang('th', 'Thai', 'ไทย', 'Thai', false, { oaIn: true }),
  lang('nl', 'Dutch', 'Nederlands', 'Latn', false, { oaIn: true }),
  lang('pl', 'Polish', 'Polski', 'Latn', false, { oaIn: true }),
  lang('uk', 'Ukrainian', 'Українська', 'Cyrl', false, { oaIn: true }),
  lang('fa', 'Persian', 'فارسی', 'Arab', false, { oaIn: true, rtl: true }),
  lang('ms', 'Malay', 'Bahasa Melayu', 'Latn', false, { oaIn: true }),
  lang('fil', 'Filipino', 'Filipino', 'Latn', false, { oaIn: true }),
  lang('sw', 'Swahili', 'Kiswahili', 'Latn', false, { oaIn: true }),
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Common aliases → table code. */
const ALIASES: Record<string, string> = {
  od: 'or', // Sarvam's Odia code
  ori: 'or',
  tl: 'fil',
  in: 'id',
  zho: 'zh',
  hin: 'hi',
  eng: 'en',
  mar: 'mr',
  tam: 'ta',
  tel: 'te',
  ben: 'bn',
  guj: 'gu',
  kan: 'kn',
  mal: 'ml',
  pan: 'pa',
  urd: 'ur',
};

/**
 * Lowercases, strips the region/script ('hi-IN' → 'hi', 'zh_Hans' → 'zh'),
 * resolves aliases ('od' → 'or'). 'auto' stays 'auto'. Returns null for
 * malformed or unknown languages.
 */
export function normalizeLanguage(code: string): string | null {
  if (typeof code !== 'string') return null;
  const raw = code.trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return null;
  if (raw === 'auto' || raw === 'unknown') return 'auto';
  const primary = raw.split('-')[0];
  if (!/^[a-z]{2,3}$/.test(primary)) return null;
  const resolved = ALIASES[primary] ?? primary;
  return BY_CODE.has(resolved) ? resolved : null;
}

export function getLanguage(code: string): LanguageInfo | null {
  const n = normalizeLanguage(code);
  return (n && BY_CODE.get(n)) || null;
}

/** One of the 22 scheduled languages of India. */
export function isIndic(code: string): boolean {
  return Boolean(getLanguage(code)?.indic);
}

/** Some route can speak this target language. */
export function voiceSupported(target: string): boolean {
  const l = getLanguage(target);
  return Boolean(l && (l.openai.output || l.sarvam.tts));
}

/** Some route can produce text in this target language. */
export function captionsSupported(target: string): boolean {
  const l = getLanguage(target);
  return Boolean(l && (l.openai.output || l.sarvam.translate));
}

/** Sarvam BCP-47 code ('hi' → 'hi-IN', 'or' → 'od-IN'); null if Sarvam has none. */
export function toSarvamCode(code: string): string | null {
  const l = getLanguage(code);
  if (!l || !(l.sarvam.stt || l.sarvam.translate || l.sarvam.tts)) return null;
  return `${l.code === 'or' ? 'od' : l.code}-IN`;
}

/** Sarvam code ('od-IN') → table code ('or'); null when unknown. */
export function fromSarvamCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const n = normalizeLanguage(code);
  return n && n !== 'auto' ? n : null;
}

export interface PublicLanguage {
  code: string;
  name: string;
  nativeName: string;
  script: string;
  rtl: boolean;
  /** Translated speech can be produced in this language. */
  voice: boolean;
  /** Translated captions can be produced in this language. */
  captions: boolean;
  /** Routes that can handle this language (as source or target). */
  routes: string[];
}

/** GET /translation/languages (PROTOCOL.md §1). */
export function publicLanguageList(): {
  languages: PublicLanguage[];
  pairs: string;
} {
  return {
    languages: LANGUAGES.map((l) => {
      const routes: string[] = [];
      if (l.sarvam.stt || l.sarvam.translate) routes.push('sarvam');
      if (l.openai.input || l.openai.output) routes.push('openai-translate');
      return {
        code: l.code,
        name: l.name,
        nativeName: l.nativeName,
        script: l.script,
        rtl: l.rtl,
        voice: l.openai.output || l.sarvam.tts,
        captions: l.openai.output || l.sarvam.translate,
        routes,
      };
    }),
    pairs: 'all-to-all; voice availability is per target language',
  };
}
