/**
 * Script helpers shared by the UI kits: which script a language is written
 * in, text direction, a font stack per script and a lazy Noto Sans loader.
 */

const LANGUAGE_SCRIPT: Record<string, string> = {
  hi: 'Deva', mr: 'Deva', ne: 'Deva', sa: 'Deva', kok: 'Deva', mai: 'Deva', doi: 'Deva',
  bn: 'Beng', as: 'Beng', mni: 'Beng',
  ta: 'Taml', te: 'Telu', kn: 'Knda', ml: 'Mlym', gu: 'Gujr', pa: 'Guru', or: 'Orya',
  ur: 'Arab', ar: 'Arab', fa: 'Arab', ps: 'Arab', sd: 'Arab', ks: 'Arab',
  he: 'Hebr', yi: 'Hebr',
  zh: 'Hans', ja: 'Jpan', ko: 'Kore', th: 'Thai', si: 'Sinh', km: 'Khmr', lo: 'Laoo', my: 'Mymr',
  ru: 'Cyrl', uk: 'Cyrl', bg: 'Cyrl', sr: 'Cyrl', el: 'Grek', am: 'Ethi', ka: 'Geor', hy: 'Armn',
  sat: 'Olck',
};

const RTL_LANGUAGES = new Set(['ar', 'ur', 'fa', 'he', 'ps', 'sd', 'ks', 'yi', 'dv']);
const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa']);

/** Google Fonts family per script (Noto Sans <Script>). */
const NOTO_FAMILY: Record<string, string> = {
  Deva: 'Noto Sans Devanagari',
  Beng: 'Noto Sans Bengali',
  Taml: 'Noto Sans Tamil',
  Telu: 'Noto Sans Telugu',
  Knda: 'Noto Sans Kannada',
  Mlym: 'Noto Sans Malayalam',
  Gujr: 'Noto Sans Gujarati',
  Guru: 'Noto Sans Gurmukhi',
  Orya: 'Noto Sans Oriya',
  Arab: 'Noto Naskh Arabic',
  Hebr: 'Noto Sans Hebrew',
  Thai: 'Noto Sans Thai',
  Sinh: 'Noto Sans Sinhala',
  Hans: 'Noto Sans SC',
  Jpan: 'Noto Sans JP',
  Kore: 'Noto Sans KR',
  Ethi: 'Noto Sans Ethiopic',
  Geor: 'Noto Sans Georgian',
  Armn: 'Noto Sans Armenian',
  Khmr: 'Noto Sans Khmer',
  Laoo: 'Noto Sans Lao',
  Mymr: 'Noto Sans Myanmar',
  Olck: 'Noto Sans Ol Chiki',
};

/** Scripts whose stacked glyphs need more line height. */
const TALL_SCRIPTS = new Set(['Deva', 'Beng', 'Taml', 'Telu', 'Knda', 'Mlym', 'Gujr', 'Guru', 'Orya', 'Sinh', 'Thai', 'Mymr', 'Khmr', 'Laoo', 'Arab']);

const BASE_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

function baseLanguage(code: string | null | undefined): string {
  return (code ?? '').toLowerCase().split(/[-_]/)[0];
}

/** ISO 15924 script for a language tag (`Latn` when unknown). */
export function scriptForLanguage(code: string | null | undefined): string {
  return LANGUAGE_SCRIPT[baseLanguage(code)] ?? 'Latn';
}

export function isRtlLanguage(code: string | null | undefined): boolean {
  return RTL_LANGUAGES.has(baseLanguage(code));
}

export function isRtlScript(script: string | null | undefined): boolean {
  return RTL_SCRIPTS.has(script ?? '');
}

/** CSS `font-family` stack for a script, Noto Sans <Script> first. */
export function fontStackForScript(script: string | null | undefined): string {
  const family = NOTO_FAMILY[script ?? ''];
  return family ? `"${family}", ${BASE_STACK}` : BASE_STACK;
}

/** Comfortable unitless line-height for a script (Indic and Arabic need more). */
export function lineHeightForScript(script: string | null | undefined): number {
  return TALL_SCRIPTS.has(script ?? '') ? 1.75 : 1.45;
}

const LINK_ATTR = 'data-purplecallio-font';

/**
 * Injects one Google Fonts `<link>` for the script's Noto Sans family, at
 * most once per document. No-op for Latin, unknown scripts, or outside a
 * browser. Returns whether a link exists for it now.
 */
export function loadScriptFont(script: string | null | undefined, doc?: Document): boolean {
  const family = NOTO_FAMILY[script ?? ''];
  const d = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!family || !d?.head) return false;
  if (d.head.querySelector(`link[${LINK_ATTR}="${script}"]`)) return true;
  const link = d.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600&display=swap`;
  link.setAttribute(LINK_ATTR, script!);
  d.head.appendChild(link);
  return true;
}

/**
 * `GET {apiUrl}/translation/languages` (public). `apiUrl` is the REST base
 * (e.g. `https://host/api`).
 */
export async function fetchTranslationLanguages(
  apiUrl: string,
  init?: RequestInit,
): Promise<import('./types').TranslationLanguagesResponse> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/translation/languages`, init);
  if (!res.ok) throw new Error(`PurpleCallio: could not load translation languages (${res.status})`);
  const body = (await res.json()) as import('./types').TranslationLanguagesResponse;
  return { languages: Array.isArray(body?.languages) ? body.languages : [], pairs: body?.pairs };
}
