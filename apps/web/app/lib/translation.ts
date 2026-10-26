/**
 * Live Translate — typed client for the dashboard, admin and public
 * translation endpoints (see apps/server/src/translation/PROTOCOL.md).
 *
 * Customers never see provider cost; only the admin margin endpoint
 * returns it. MeaningGuard output is always worded as "may not be
 * accurate" — never as a confidence percentage.
 */
import { api } from './api';

// ── Vocabulary ─────────────────────────────────────────────
export type TranslationMode = 'off' | 'captions' | 'voice';
export type TranslationRole = 'caller' | 'receiver';
export type OnLimit = 'captions_then_off' | 'off';
export type TermKind = 'DO_NOT_TRANSLATE' | 'TRANSLATE_AS' | 'PRONOUNCE_AS';

export const INDUSTRIES: { id: string; label: string }[] = [
  { id: 'healthcare', label: 'Healthcare' },
  { id: 'legal', label: 'Legal' },
  { id: 'saas', label: 'SaaS / software' },
  { id: 'finance', label: 'Finance' },
  { id: 'ecommerce', label: 'E-commerce' },
];

export const industryLabel = (id: string | null | undefined) =>
  INDUSTRIES.find((i) => i.id === id)?.label ?? (id ? id[0].toUpperCase() + id.slice(1) : 'Not set');

export const TERM_KINDS: { id: TermKind; label: string; hint: string }[] = [
  { id: 'DO_NOT_TRANSLATE', label: 'Keep as is', hint: 'Brand and product names, codes — never translated.' },
  { id: 'TRANSLATE_AS', label: 'Translate as', hint: 'Always use your approved translation per language.' },
  { id: 'PRONOUNCE_AS', label: 'Pronounce as', hint: 'A spoken hint for how the voice should say it.' },
];

export const termKindLabel = (k: string) => TERM_KINDS.find((t) => t.id === k)?.label ?? k;

export const ROLE_LABEL: Record<TranslationRole, string> = { caller: 'Caller', receiver: 'Receiver' };

export const MODE_LABEL: Record<string, string> = {
  off: 'Off',
  captions: 'Captions',
  voice: 'Voice translation',
};

export const RETENTION_DAYS = [7, 30, 90];
export const MAX_TERMS_PER_SAVE = 2000;

// ── MeaningGuard ───────────────────────────────────────────
const GUARD_REASON_TEXT: Record<string, string> = {
  'term_mismatch:number': 'A number may not match',
  'term_mismatch:amount': 'An amount may not match',
  'term_mismatch:date': 'A date may not match',
  'term_mismatch:phone': 'A phone number may not match',
  'term_mismatch:lexicon': 'A glossary term may not have been kept',
  recognition_failed: 'Speech could not be recognised',
  low_asr_confidence: 'Speech was hard to make out',
  asr_alternatives_disagree: 'Some words may have been misheard',
  length_mismatch: 'Translation length differs a lot from the original',
  language_mismatch: 'A different language than expected was spoken',
  poor_audio: 'Poor audio quality',
  late_translation: 'Translation arrived late',
  provider_error: 'Translation service had a problem',
};

/** Plain-language MeaningGuard reason. Never a percentage. */
export function humanizeGuardReason(reason: string): string {
  if (GUARD_REASON_TEXT[reason]) return GUARD_REASON_TEXT[reason];
  const words = reason.replace(/[:_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'May not be accurate';
}

// ── Errors ─────────────────────────────────────────────────
const ERROR_TEXT: Record<string, string> = {
  TRANSLATION_NOT_IN_PLAN: 'Live Translate is not included in your plan. Upgrade to use it.',
  TRANSLATION_INSUFFICIENT_CREDITS: 'Not enough credits to start translation. Add credits and try again.',
  TRANSLATION_DISABLED: 'Live Translate is not enabled on this account yet.',
  TRANSLATION_REPORT_NOT_FOUND: 'No report exists for this call.',
  TRANSLATION_LEXICON_NOT_FOUND: 'That lexicon no longer exists.',
  TRANSLATION_INVALID_CONFIG: 'Some settings are not valid. Check the values and try again.',
  TRANSLATION_INVALID_LANGUAGE: 'One of the languages is not supported.',
};

export function translationErrorCode(e: unknown): string | undefined {
  const d = (e as { response?: { data?: { code?: unknown; error?: unknown } } })?.response?.data;
  const code = d?.code ?? d?.error;
  return typeof code === 'string' ? code : undefined;
}

export function translationErrorStatus(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status;
}

/** Stable, readable message for an API error. */
export function translationErrorText(e: unknown, fallback: string): string {
  const code = translationErrorCode(e);
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (translationErrorStatus(e) === 400) {
    if (Array.isArray(msg) && msg.length) return msg.join(', ');
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

// ── Formatting ─────────────────────────────────────────────
export const fmtNumber = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: digits });

export function fmtMs(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function fmtInr(rupees: number | null | undefined) {
  if (rupees == null || !Number.isFinite(rupees)) return '—';
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Share (0..1) or percentage (0..100) → "3.2%". */
export function fmtRate(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—';
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
}

export function dateInput(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// ── Types ──────────────────────────────────────────────────
export interface TranslationLanguage {
  code: string;
  name: string;
  nativeName?: string;
  script?: string;
  rtl?: boolean;
  voice: boolean;
  captions: boolean;
  routes?: string[];
}

export interface TranslationSettings {
  id?: string;
  projectId?: string;
  replayEnabled: boolean;
  postCallReportEnabled: boolean;
  sentimentEnabled: boolean;
  transcriptRetentionDays: number;
  industry: string | null;
  defaultLexiconId: string | null;
  defaultMaxMinutes: number | null;
  dailyBudgetCredits: number | null;
  monthlyBudgetCredits: number | null;
  alertThresholds: number[];
  onLimit: OnLimit;
}

export type TranslationSettingsUpdate = Partial<Omit<TranslationSettings, 'id' | 'projectId'>>;

export interface LexiconTerm {
  id?: string;
  term: string;
  kind: TermKind;
  translations?: Record<string, string> | null;
  pronunciation?: string | null;
  caseSensitive?: boolean;
}

export interface Lexicon {
  id: string;
  name: string;
  industry: string | null;
  createdAt?: string;
  updatedAt?: string;
  terms?: LexiconTerm[];
  termCount?: number;
  _count?: { terms?: number };
}

export const lexiconTermCount = (l: Lexicon) => l.termCount ?? l._count?.terms ?? l.terms?.length ?? 0;

export interface LexiconPack {
  industry: string;
  name?: string;
  description?: string;
  termCount?: number;
  terms?: LexiconTerm[];
}

export interface TranslationMetrics {
  totals: {
    calls: number;
    sessions: number;
    voiceMinutes: number;
    captionsMinutes: number;
    credits: number;
    avgCreditsPerCallMinute: number | null;
    approxInrPerCallMinute: number | null;
  };
  latency: {
    firstAudioMsP50: number | null;
    firstAudioMsP95: number | null;
    captionDelayMsP50: number | null;
    captionDelayMsP95: number | null;
  };
  reliability: { providerFailures: number; fallbacks: number; droppedFrames: number; failedSessions: number };
  guard: {
    phrases: number;
    flags: number;
    flagRate: number | null;
    byReason: Record<string, number>;
    replays: number;
    repeats: number;
    lexiconHits: number;
  };
  byPair: { pair: string; route?: string; sessions: number; minutes: number; firstAudioMsP50: number | null; flagRate: number | null }[];
  benchmarks: { pair: string; route?: string; termPreservation: number | null; note?: string }[];
}

export interface TranslationPhrase {
  phraseId: string;
  speaker: TranslationRole;
  sourceLanguage: string;
  targetLanguage: string;
  original: string;
  translated: string;
  startedAt: string | number;
  endedAt?: string | number | null;
  guardStatus?: string;
  guardReasons?: string[];
  guard?: { status: string; reasons: string[] };
}

export interface ReportSummary {
  keyPoints?: string[];
  decisions?: string[];
  actionItems?: { text: string; phraseId?: string | null }[];
}

export interface ReportSignals {
  talkRatio?: Partial<Record<TranslationRole, number>> | null;
  topics?: (string | { topic?: string; name?: string })[];
  flaggedMoments?: { phraseId: string; reasons?: string[] }[];
  replays?: number;
  repeats?: number;
  tone?: { speaker: TranslationRole; topic?: string; tone: string; quotes?: string[] }[];
}

export type ReportStatus = 'pending' | 'ready' | 'failed';

export interface TranslationReport {
  status: ReportStatus;
  transcript: TranslationPhrase[];
  summary: Record<string, ReportSummary> | null;
  signals: ReportSignals | null;
  creditsCharged: number;
  createdAt: string;
}

export interface TranslationEstimate {
  mode: TranslationMode;
  ratePerMinute: number;
  /** People with translation on: 1 (one side) or 2 (both). */
  listeners: 1 | 2;
  creditsPerCall: number;
  totalCredits: number;
  approxInrPerMinute: number | null;
  approxInrPerCall: number | null;
  approxInrTotal: number | null;
  note?: string;
}

/**
 * GET /dashboard/translation/usage — CostGuard breakdown for the current
 * billing period (not in PROTOCOL.md; see the report).
 */
export interface TranslationUsageBreakdown {
  period?: { start: string; end: string };
  callMinutes: { minutes: number; credits: number };
  captions: { minutes: number; credits: number };
  voice: { minutes: number; credits: number };
  aiAgent: { minutes: number; credits: number };
  reports: { count: number; credits: number };
  totalCredits?: number;
}

/** Normalises a phrase coming from either the DB row or the caption shape. */
export function phraseGuard(p: TranslationPhrase): { flagged: boolean; reasons: string[] } {
  const status = p.guard?.status ?? p.guardStatus ?? 'ok';
  const reasons = p.guard?.reasons ?? p.guardReasons ?? [];
  return { flagged: status !== 'ok' || reasons.length > 0, reasons };
}

// ── Dashboard endpoints (JWT) ──────────────────────────────
const P = (projectId: string) => `/dashboard/translation/projects/${projectId}`;
const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const getLanguages = () =>
  data(api.get<{ languages: TranslationLanguage[]; pairs?: string }>('/translation/languages'));
export const getEstimate = (params: { mode: TranslationMode; minutes: number; calls: number; listeners: 1 | 2 }) =>
  data(api.get<TranslationEstimate>('/translation/estimate', { params }));

export const getSettings = (projectId: string) => data(api.get<TranslationSettings>(`${P(projectId)}/settings`));
export const updateSettings = (projectId: string, body: TranslationSettingsUpdate) =>
  data(api.patch<TranslationSettings>(`${P(projectId)}/settings`, body));

export const getMetrics = (projectId: string, params: { from: string; to: string; pair?: string; route?: string }) =>
  data(api.get<TranslationMetrics>(`${P(projectId)}/metrics`, { params }));

export const listLexicons = (projectId: string) => data(api.get<Lexicon[]>(`${P(projectId)}/lexicons`));
export const getLexicon = (projectId: string, id: string) => data(api.get<Lexicon>(`${P(projectId)}/lexicons/${id}`));
export const createLexicon = (projectId: string, body: { name: string; industry?: string | null }) =>
  data(api.post<Lexicon>(`${P(projectId)}/lexicons`, body));
export const updateLexicon = (projectId: string, id: string, body: { name?: string; industry?: string | null }) =>
  data(api.patch<Lexicon>(`${P(projectId)}/lexicons/${id}`, body));
export const deleteLexicon = (projectId: string, id: string) => data(api.delete(`${P(projectId)}/lexicons/${id}`));
export const putLexiconTerms = (projectId: string, id: string, terms: LexiconTerm[]) =>
  data(api.put<Lexicon>(`${P(projectId)}/lexicons/${id}/terms`, terms));
export const deleteLexiconTerm = (projectId: string, id: string, termId: string) =>
  data(api.delete(`${P(projectId)}/lexicons/${id}/terms/${termId}`));
export const importLexiconCsv = (projectId: string, id: string, csv: string) =>
  data(api.post<Lexicon>(`${P(projectId)}/lexicons/${id}/import`, { csv }));
export const listLexiconPacks = (projectId: string) => data(api.get<LexiconPack[]>(`${P(projectId)}/lexicons/packs`));
export const createLexiconFromPack = (projectId: string, body: { industry: string; name?: string }) =>
  data(api.post<Lexicon>(`${P(projectId)}/lexicons/from-pack`, body));

export const getCallReport = (callId: string) =>
  data(api.get<TranslationReport>(`/dashboard/translation/calls/${callId}/report`));

export const getTranslationUsage = () => data(api.get<TranslationUsageBreakdown>('/dashboard/translation/usage'));

// ── Admin ──────────────────────────────────────────────────
export interface TranslationRateOverride {
  id?: string;
  userId: string;
  user?: { id: string; email: string; name: string | null; companyName?: string | null } | null;
  voiceCreditsPerMinute: number | null;
  captionsCreditsPerMinute: number | null;
  postCallReportCredits: number | null;
  note: string | null;
  updatedAt?: string;
}

export type TranslationRateOverrideInput = Pick<
  TranslationRateOverride,
  'voiceCreditsPerMinute' | 'captionsCreditsPerMinute' | 'postCallReportCredits' | 'note'
>;

export interface MarginRow {
  route?: string;
  pair?: string;
  minutes?: number;
  revenueCredits: number;
  revenueInr: number;
  providerCostInr: number;
  marginPercent: number | null;
  warn: boolean;
}

export interface MarginReport {
  byRoute: MarginRow[];
  byPair: MarginRow[];
  warnPercent?: number;
  /** Live USD → INR used for provider costs. */
  usdInrRate?: number;
  /** Paise per direction-minute for routes with no admin entry, at today's rate. */
  defaultProviderCostsPaisePerMinute?: Record<string, number>;
}

export const listRateOverrides = () =>
  data(api.get<TranslationRateOverride[]>('/admin/translation/overrides'));
export const saveRateOverride = (userId: string, body: TranslationRateOverrideInput) =>
  data(api.put<TranslationRateOverride>(`/admin/translation/overrides/${encodeURIComponent(userId)}`, body));
export const deleteRateOverride = (userId: string) =>
  data(api.delete(`/admin/translation/overrides/${encodeURIComponent(userId)}`));

export async function getMarginReport(params: { from: string; to: string }): Promise<MarginReport> {
  const raw = await data(api.get<Record<string, unknown>>('/admin/translation/margin', { params }));
  const rows = (v: unknown) => (Array.isArray(v) ? (v as MarginRow[]) : []);
  return {
    byRoute: rows(raw.byRoute ?? raw.routes),
    byPair: rows(raw.byPair ?? raw.pairs),
    warnPercent: typeof raw.warnPercent === 'number' ? raw.warnPercent : undefined,
    usdInrRate: typeof raw.usdInrRate === 'number' ? raw.usdInrRate : undefined,
    defaultProviderCostsPaisePerMinute:
      raw.defaultProviderCostsPaisePerMinute && typeof raw.defaultProviderCostsPaisePerMinute === 'object'
        ? (raw.defaultProviderCostsPaisePerMinute as Record<string, number>)
        : undefined,
  };
}

// ── CSV ────────────────────────────────────────────────────
/** Minimal CSV parser (quoted fields, escaped quotes) used for the import preview. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/**
 * Validates a PurpleLex CSV (header `term,kind,lang:hi,…,pronunciation`) and
 * returns the number of term rows, or an error message.
 */
export function checkLexiconCsv(text: string): { rows: number; languages: string[] } | { error: string } {
  const rows = parseCsv(text.trim());
  if (rows.length === 0) return { error: 'The CSV is empty.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (header[0] !== 'term') return { error: 'The first column must be "term".' };
  const languages = header.filter((h) => h.startsWith('lang:')).map((h) => h.slice(5));
  const body = rows.slice(1);
  if (body.length === 0) return { error: 'The CSV has a header but no terms.' };
  if (body.length > MAX_TERMS_PER_SAVE) return { error: `A lexicon import is limited to ${MAX_TERMS_PER_SAVE} terms.` };
  return { rows: body.length, languages };
}

// ── Admin: BillingConfig Live Translate fields ─────────────
/** Live Translate fields on BillingConfig (edited through /admin/billing/credit-rates). */
export interface TranslationBillingConfig {
  translationVoiceCreditsPerMinute?: number;
  translationCaptionsCreditsPerMinute?: number;
  translationMinimumCredits?: number | null;
  postCallReportCredits?: number;
  /** Paise per direction-minute, by route id. Admin-only (margin reporting). */
  translationProviderCostsPaise?: Record<string, number>;
  translationMarginWarnPercent?: number;
  translationDefaultMaxMinutes?: number;
  translationMaxBudgetCredits?: number;
}

/** Credits for a translated call: listeners (1 or 2 people translating) × minutes × rate, rounded up once per direction. */
export function translatedCallCredits(minutes: number, perMinute: number, directions = 2) {
  const raw = minutes * perMinute;
  return raw > 0 ? directions * Math.ceil(raw - 1e-6) : 0;
}
