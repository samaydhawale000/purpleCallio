/** Post-Call Suite summarizer. See translation/PROTOCOL.md §7. */

export interface SummarizePhrase {
  phraseId: string;
  speaker: 'caller' | 'receiver';
  sourceLanguage: string;
  targetLanguage: string;
  original: string;
  translated: string;
  guardStatus: string;
  guardReasons: string[];
}

export interface SummaryBlock {
  keyPoints: string[];
  decisions: string[];
  actionItems: { text: string; phraseId?: string }[];
}

export interface ToneItem {
  speaker: 'caller' | 'receiver';
  topic: string;
  /** Worded as a possible tone, never as a fact about the person. */
  tone: string;
  quotes: string[];
}

export interface SummarizeInput {
  phrases: SummarizePhrase[];
  /** Each participant's language; the summary is produced in each of them. */
  languages: { caller: string; receiver: string };
  includeTone: boolean;
  industry?: string | null;
}

export interface SummarizeOutput {
  /** Keyed by language code. */
  summary: Record<string, SummaryBlock>;
  topics: string[];
  tone?: ToneItem[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ReportSummarizer {
  readonly name: string;
  isConfigured(): boolean;
  summarize(input: SummarizeInput): Promise<SummarizeOutput>;
}

/** Nest injection token for the active summarizer. */
export const REPORT_SUMMARIZER = Symbol('REPORT_SUMMARIZER');
