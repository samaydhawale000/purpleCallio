import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { getLanguage } from '../languages';
import {
  extractiveBlock,
  extractiveTopics,
  phraseText,
  uniqueLanguages,
} from './extractive-summarizer';
import {
  ReportSummarizer,
  SummarizeInput,
  SummarizeOutput,
  SummaryBlock,
  ToneItem,
} from './report-summarizer.interface';

export { ExtractiveReportSummarizer } from './extractive-summarizer';

/**
 * Post-Call Suite summarizer on OpenAI Chat Completions with Structured
 * Outputs (`response_format: { type: 'json_schema', strict: true }`).
 * Docs (checked 2026-10-22):
 * - https://platform.openai.com/docs/api-reference/chat/create
 * - https://platform.openai.com/docs/guides/structured-outputs
 * - https://platform.openai.com/docs/models/gpt-5-mini (default model; GPT-5
 *   family models take `max_completion_tokens` and no `temperature`).
 *
 * The output is post-validated: phraseIds must exist, every language gets a
 * block (extractive fallback), tone only when asked, worded "possible …" and
 * backed by quotes that really occur in the transcript.
 */
export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const TRANSLATION_REPORT_DEFAULT_MODEL = 'gpt-5-mini';
export const OPENAI_SUMMARIZER_OPTIONS = 'OPENAI_SUMMARIZER_OPTIONS';

export interface OpenAiSummarizerOptions {
  /** Full chat-completions URL; default env OPENAI_REPORT_BASE_URL or OPENAI_CHAT_URL. */
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Stable failure codes only (no provider text). */
export class ReportSummarizerError extends Error {
  constructor(
    readonly code:
      | 'TRANSLATION_REPORT_UNAVAILABLE'
      | 'TRANSLATION_REPORT_FAILED',
  ) {
    super(code);
    this.name = 'ReportSummarizerError';
  }
}

const MAX_TRANSCRIPT_CHARS = 60_000;
const MAX_LIST = 10;

const SYSTEM_PROMPT = [
  'You summarize a translated two-party phone call for both participants.',
  'Each transcript line is: [phraseId] speaker (source→target): original ||| translation.',
  'Write each summary block entirely in the requested language.',
  'keyPoints: the main facts discussed. decisions: things both sides agreed. actionItems: concrete follow-ups, each with the phraseId of the line it comes from (null if none).',
  'Keep numbers, amounts, dates, names and phone numbers exactly as in the transcript. Do not invent anything.',
  'topics: up to 5 short topic labels in the first requested language.',
].join('\n');

const TONE_PROMPT =
  'tone: only where the wording clearly suggests it, describe a POSSIBLE tone per speaker and topic, always worded as "possible …" (e.g. "possible frustration"), never as a fact about the person, with 1–3 exact quotes copied verbatim from the transcript. Return an empty list when unsure.';

function schema(languages: string[], includeTone: boolean) {
  const stringList = { type: 'array', items: { type: 'string' } };
  const properties: Record<string, unknown> = {
    summaries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['language', 'keyPoints', 'decisions', 'actionItems'],
        properties: {
          language: { type: 'string', enum: languages },
          keyPoints: stringList,
          decisions: stringList,
          actionItems: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'phraseId'],
              properties: {
                text: { type: 'string' },
                phraseId: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    },
    topics: stringList,
  };
  if (includeTone) {
    properties.tone = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['speaker', 'topic', 'tone', 'quotes'],
        properties: {
          speaker: { type: 'string', enum: ['caller', 'receiver'] },
          topic: { type: 'string' },
          tone: { type: 'string' },
          quotes: stringList,
        },
      },
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function transcript(input: SummarizeInput): string {
  const lines = input.phrases.map(
    (p) =>
      `[${p.phraseId}] ${p.speaker} (${p.sourceLanguage}→${p.targetLanguage}): ${oneLine(p.original)} ||| ${oneLine(p.translated)}`,
  );
  // Keep the end of long calls (closing remarks carry most decisions).
  let total = 0;
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + 1;
    if (total > MAX_TRANSCRIPT_CHARS) break;
    kept.unshift(lines[i]);
  }
  return kept.join('\n');
}

function oneLine(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function strings(v: unknown, max = MAX_LIST): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim())
        .slice(0, max)
    : [];
}

@Injectable()
export class OpenAiReportSummarizer implements ReportSummarizer {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiReportSummarizer.name);
  private readonly options: OpenAiSummarizerOptions;

  constructor(
    @Optional()
    @Inject(OPENAI_SUMMARIZER_OPTIONS)
    options?: OpenAiSummarizerOptions,
  ) {
    this.options = options ?? {};
  }

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  async summarize(input: SummarizeInput): Promise<SummarizeOutput> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey)
      throw new ReportSummarizerError('TRANSLATION_REPORT_UNAVAILABLE');
    const languages = uniqueLanguages(input);
    if (!input.phrases.length) {
      const summary: Record<string, SummaryBlock> = {};
      for (const l of languages)
        summary[l] = { keyPoints: [], decisions: [], actionItems: [] };
      return {
        summary,
        topics: [],
        ...(input.includeTone ? { tone: [] } : {}),
      };
    }

    const model =
      process.env.TRANSLATION_REPORT_MODEL?.trim() ||
      TRANSLATION_REPORT_DEFAULT_MODEL;
    const languageNames = languages
      .map((l) => `${l} (${getLanguage(l)?.name ?? l})`)
      .join(', ');
    const body = {
      model,
      messages: [
        {
          role: 'system',
          content: input.includeTone
            ? `${SYSTEM_PROMPT}\n${TONE_PROMPT}`
            : SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            `Summary languages: ${languageNames}. Produce exactly one summary block per language.`,
            input.industry ? `Industry: ${input.industry}.` : '',
            'Transcript:',
            transcript(input),
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'call_report',
          strict: true,
          schema: schema(languages, input.includeTone),
        },
      },
    };

    const url =
      this.options.url ||
      process.env.OPENAI_REPORT_BASE_URL?.trim() ||
      OPENAI_CHAT_URL;
    let res: Response;
    try {
      res = await (this.options.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 90_000),
      });
    } catch (err) {
      this.logger.warn(
        `event=translation_report_http_error provider=openai error=${safeToken((err as Error)?.name)}`,
      );
      throw new ReportSummarizerError('TRANSLATION_REPORT_UNAVAILABLE');
    }
    if (!res.ok) {
      this.logger.warn(
        `event=translation_report_http_error provider=openai status=${res.status}`,
      );
      throw new ReportSummarizerError('TRANSLATION_REPORT_UNAVAILABLE');
    }

    let parsed: unknown;
    let usage: Obj = {};
    try {
      const data = obj(await res.json());
      usage = obj(data.usage);
      const message = obj(arr(data.choices)[0]).message;
      const { content, refusal } = obj(message);
      if (refusal || typeof content !== 'string') throw new Error('no content');
      parsed = JSON.parse(content);
    } catch {
      this.logger.warn('event=translation_report_bad_output provider=openai');
      throw new ReportSummarizerError('TRANSLATION_REPORT_FAILED');
    }
    return this.validate(obj(parsed), input, languages, usage);
  }

  private validate(
    parsed: Obj,
    input: SummarizeInput,
    languages: string[],
    usage: Obj,
  ): SummarizeOutput {
    const ids = new Set(input.phrases.map((p) => p.phraseId));
    const summary: Record<string, SummaryBlock> = {};
    for (const s of arr(parsed.summaries).map(obj)) {
      const l = str(s.language);
      if (!languages.includes(l) || summary[l]) continue;
      summary[l] = {
        keyPoints: strings(s.keyPoints),
        decisions: strings(s.decisions),
        actionItems: arr(s.actionItems)
          .map(obj)
          .filter((a) => str(a.text))
          .slice(0, MAX_LIST)
          .map((a) => {
            const phraseId = str(a.phraseId);
            return {
              text: str(a.text),
              ...(phraseId && ids.has(phraseId) ? { phraseId } : {}),
            };
          }),
      };
    }
    // A language the model skipped gets the extractive block.
    for (const l of languages) summary[l] ??= extractiveBlock(input.phrases, l);

    let topics = strings(parsed.topics, 5);
    if (!topics.length) topics = extractiveTopics(input.phrases, languages[0]);

    const out: SummarizeOutput = { summary, topics };
    if (input.includeTone) out.tone = this.validTone(parsed.tone, input);
    const { prompt_tokens: inputTokens, completion_tokens: outputTokens } =
      usage;
    if (typeof inputTokens === 'number' || typeof outputTokens === 'number') {
      out.usage = {
        ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
        ...(typeof outputTokens === 'number' ? { outputTokens } : {}),
      };
    }
    return out;
  }

  /** Keeps tone items whose quotes occur in that speaker's words; forces "possible …". */
  private validTone(raw: unknown, input: SummarizeInput): ToneItem[] {
    const out: ToneItem[] = [];
    for (const t of arr(raw).map(obj)) {
      const speaker =
        t.speaker === 'caller' || t.speaker === 'receiver' ? t.speaker : null;
      const tone = str(t.tone);
      if (!speaker || !tone) continue;
      const said = input.phrases
        .filter((p) => p.speaker === speaker)
        .map((p) => `${oneLine(p.original)}\n${oneLine(p.translated)}`)
        .join('\n')
        .toLowerCase();
      const quotes = strings(t.quotes, 3).filter((q) =>
        said.includes(oneLine(q).toLowerCase()),
      );
      if (!quotes.length) continue;
      out.push({
        speaker,
        topic: str(t.topic),
        tone: /^possib/i.test(tone)
          ? tone
          : `possible ${tone.charAt(0).toLowerCase()}${tone.slice(1)}`,
        quotes,
      });
    }
    return out.slice(0, MAX_LIST);
  }
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? (v as unknown[]) : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function safeToken(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value)
    ? value
    : 'unknown';
}

/** Re-exported for callers that build summaries per participant language. */
export { phraseText };
