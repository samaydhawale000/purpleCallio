import { Injectable } from '@nestjs/common';

import { normalizeLanguage } from '../languages';
import {
  ReportSummarizer,
  SummarizeInput,
  SummarizeOutput,
  SummarizePhrase,
  SummaryBlock,
} from './report-summarizer.interface';

/**
 * Deterministic, offline summarizer (PROTOCOL.md §7 "mock (extractive)"):
 * key points are the most informative final phrases, action items and
 * decisions come from keyword patterns. Never produces tone.
 */

const MAX_KEY_POINTS = 5;
const MAX_ITEMS = 10;
const MAX_TOPICS = 5;

/** Commitments / requests (English, Hindi, Marathi, a few other Indic stems). */
const ACTION_PATTERN = new RegExp(
  [
    String.raw`\b(will|shall|please|send|call|schedule|remind|follow[- ]up|book|share|email|pay|submit|let me|i'll|we'll|need to|should)\b`,
    'करेंगे|करूंगा|करूँगा|करूंगी|करूँगी|करेंगी|भेज|कृपया|बुक|कॉल',
    'पाठव|करीन|करेन|कळव|करा',
    'அனுப்ப|செய்வேன்|ಕಳುಹಿಸ|పంపి|পাঠা|મોકલ',
  ].join('|'),
  'i',
);

const DECISION_PATTERN = new RegExp(
  [
    String.raw`\b(agreed|agree|decided|decision|confirm(ed)?|final(ised|ized)?|approved?|deal|settled)\b`,
    'तय|मंज़ूर|मंजूर|पक्का|ठरल|ठरव|निश्चित',
  ].join('|'),
  'i',
);

const STOPWORDS = new Set(
  'about above after again also because been before being between could does doing during each from further have having here into itself just more most other over same should some such than that their them then there these they this those through under until very what when where which while will with would your yours okay yeah hello thank thanks please'.split(
    ' ',
  ),
);

function base(code: string): string {
  return normalizeLanguage(code) ?? code.toLowerCase().split(/[-_]/)[0];
}

/** The phrase in `language`: original if spoken in it, else the translation. */
export function phraseText(p: SummarizePhrase, language: string): string {
  const l = base(language);
  if (base(p.sourceLanguage) === l) return p.original.trim();
  if (base(p.targetLanguage) === l && p.translated.trim())
    return p.translated.trim();
  return p.translated.trim() || p.original.trim();
}

function informativeness(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  const unique = new Set(words.map((w) => w.toLowerCase())).size;
  // Scripts without spaces (ja/zh/th) count characters instead.
  const size = words.length <= 2 ? text.length / 3 : unique;
  return size + (/\d/.test(text) ? 3 : 0);
}

function both(p: SummarizePhrase): string {
  return `${p.original} ${p.translated}`;
}

export function uniqueLanguages(input: SummarizeInput): string[] {
  const out: string[] = [];
  for (const l of [input.languages.caller, input.languages.receiver]) {
    if (!l) continue;
    const b = base(l);
    if (b && b !== 'auto' && !out.includes(b)) out.push(b);
  }
  if (!out.length) out.push('en');
  return out;
}

export function extractiveBlock(
  phrases: SummarizePhrase[],
  language: string,
): SummaryBlock {
  const usable = phrases.filter((p) => (p.original || p.translated).trim());
  const ranked = usable
    .map((p, i) => ({ p, i, score: informativeness(phraseText(p, language)) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, MAX_KEY_POINTS)
    .sort((a, b) => a.i - b.i);
  return {
    keyPoints: ranked.map((x) => phraseText(x.p, language)),
    decisions: usable
      .filter((p) => DECISION_PATTERN.test(both(p)))
      .slice(0, MAX_ITEMS)
      .map((p) => phraseText(p, language)),
    actionItems: usable
      .filter((p) => ACTION_PATTERN.test(both(p)))
      .slice(0, MAX_ITEMS)
      .map((p) => ({ text: phraseText(p, language), phraseId: p.phraseId })),
  };
}

export function extractiveTopics(
  phrases: SummarizePhrase[],
  language: string,
): string[] {
  const counts = new Map<string, number>();
  for (const p of phrases) {
    for (const raw of phraseText(p, language)
      .toLowerCase()
      .split(/[^\p{L}\p{M}\p{N}]+/u)) {
      if ([...raw].length < 5 || STOPWORDS.has(raw) || /^\d+$/.test(raw))
        continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TOPICS)
    .map(([w]) => w);
}

@Injectable()
export class ExtractiveReportSummarizer implements ReportSummarizer {
  readonly name = 'extractive';

  isConfigured(): boolean {
    return true;
  }

  summarize(input: SummarizeInput): Promise<SummarizeOutput> {
    const languages = uniqueLanguages(input);
    const summary: Record<string, SummaryBlock> = {};
    for (const l of languages) summary[l] = extractiveBlock(input.phrases, l);
    return Promise.resolve({
      summary,
      topics: extractiveTopics(input.phrases, languages[0]),
    });
  }
}
