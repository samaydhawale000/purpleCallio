import { Logger } from '@nestjs/common';

import { ExtractiveReportSummarizer } from './extractive-summarizer';
import {
  OpenAiReportSummarizer,
  TRANSLATION_REPORT_DEFAULT_MODEL,
} from './openai-summarizer';
import { SummarizeInput, SummarizePhrase } from './report-summarizer.interface';

const KEY = 'sk-report-secret';

function phrase(
  id: string,
  speaker: 'caller' | 'receiver',
  original: string,
  translated: string,
): SummarizePhrase {
  const fromCaller = speaker === 'caller';
  return {
    phraseId: id,
    speaker,
    sourceLanguage: fromCaller ? 'en' : 'hi',
    targetLanguage: fromCaller ? 'hi' : 'en',
    original,
    translated,
    guardStatus: 'ok',
    guardReasons: [],
  };
}

const PHRASES = [
  phrase('caller-1', 'caller', 'Hello', 'नमस्ते'),
  phrase(
    'receiver-1',
    'receiver',
    'मेरा ऑर्डर 4521 अभी तक नहीं आया है और मुझे बहुत परेशानी हो रही है',
    'My order 4521 has still not arrived and I am having a lot of trouble',
  ),
  phrase(
    'caller-2',
    'caller',
    'I will send a replacement order today and call you tomorrow',
    'मैं आज एक नया ऑर्डर भेजूंगा और कल आपको कॉल करूंगा',
  ),
  phrase('receiver-2', 'receiver', 'ठीक है, तय हुआ', 'Okay, agreed'),
];

const INPUT: SummarizeInput = {
  phrases: PHRASES,
  languages: { caller: 'en', receiver: 'hi-IN' },
  includeTone: false,
  industry: 'retail',
};

function chat(content: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('ExtractiveReportSummarizer', () => {
  const s = new ExtractiveReportSummarizer();

  it('is always configured, deterministic, one block per (deduped) language, no tone', async () => {
    expect(s.name).toBe('extractive');
    expect(s.isConfigured()).toBe(true);
    const out = await s.summarize({ ...INPUT, includeTone: true });
    expect(Object.keys(out.summary)).toEqual(['en', 'hi']);
    expect(out.tone).toBeUndefined();
    expect(await s.summarize({ ...INPUT, includeTone: true })).toEqual(out);

    const same = await s.summarize({
      ...INPUT,
      languages: { caller: 'hi', receiver: 'hi-IN' },
    });
    expect(Object.keys(same.summary)).toEqual(['hi']);
  });

  it('uses each language’s own text and finds action items and decisions', async () => {
    const out = await s.summarize(INPUT);
    const en = out.summary.en;
    const hi = out.summary.hi;
    expect(en.keyPoints).toContain(
      'My order 4521 has still not arrived and I am having a lot of trouble',
    );
    expect(hi.keyPoints).toContain(
      'मेरा ऑर्डर 4521 अभी तक नहीं आया है और मुझे बहुत परेशानी हो रही है',
    );
    expect(en.keyPoints).not.toContain('Hello');
    expect(en.actionItems).toEqual([
      {
        text: 'I will send a replacement order today and call you tomorrow',
        phraseId: 'caller-2',
      },
    ]);
    expect(hi.actionItems[0]).toEqual({
      text: 'मैं आज एक नया ऑर्डर भेजूंगा और कल आपको कॉल करूंगा',
      phraseId: 'caller-2',
    });
    expect(en.decisions).toEqual(['Okay, agreed']);
    expect(hi.decisions).toEqual(['ठीक है, तय हुआ']);
    expect(out.topics).toContain('order');
  });

  it('handles an empty transcript', async () => {
    const out = await s.summarize({ ...INPUT, phrases: [] });
    expect(out.summary.en).toEqual({
      keyPoints: [],
      decisions: [],
      actionItems: [],
    });
    expect(out.topics).toEqual([]);
  });
});

describe('OpenAiReportSummarizer', () => {
  const saved = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.TRANSLATION_REPORT_MODEL,
  };
  let logs: string[];

  beforeEach(() => {
    process.env.OPENAI_API_KEY = KEY;
    delete process.env.TRANSLATION_REPORT_MODEL;
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((m: any) => {
        logs.push(String(m));
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    expect(logs.join('\n')).not.toContain(KEY);
  });

  afterAll(() => {
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.key;
    if (saved.model === undefined) delete process.env.TRANSLATION_REPORT_MODEL;
    else process.env.TRANSLATION_REPORT_MODEL = saved.model;
  });

  function make(response: () => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit; body: any }[] = [];
    const f = jest.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        init,
        body: JSON.parse(String(init.body)),
      });
      return response();
    });
    return {
      s: new OpenAiReportSummarizer({
        url: 'https://openai.test/v1/chat/completions',
        fetch: f as any,
      }),
      calls,
    };
  }

  it('reads OPENAI_API_KEY', () => {
    const s = new OpenAiReportSummarizer();
    expect(s.name).toBe('openai');
    expect(s.isConfigured()).toBe(true);
    delete process.env.OPENAI_API_KEY;
    expect(s.isConfigured()).toBe(false);
  });

  it('sends a strict JSON-schema request and validates the output', async () => {
    const { s, calls } = make(() =>
      chat({
        summaries: [
          {
            language: 'en',
            keyPoints: ['Order 4521 has not arrived'],
            decisions: ['Replacement agreed'],
            actionItems: [
              { text: 'Send replacement today', phraseId: 'caller-2' },
              { text: 'Bogus ref', phraseId: 'caller-99' },
            ],
          },
          {
            language: 'en',
            keyPoints: ['duplicate'],
            decisions: [],
            actionItems: [],
          },
        ],
        topics: ['delivery'],
      }),
    );
    const out = await s.summarize(INPUT);

    const req = calls[0];
    expect(req.url).toBe('https://openai.test/v1/chat/completions');
    expect((req.init.headers as any).Authorization).toBe(`Bearer ${KEY}`);
    expect(req.body.model).toBe(TRANSLATION_REPORT_DEFAULT_MODEL);
    expect(req.body.response_format.type).toBe('json_schema');
    expect(req.body.response_format.json_schema.strict).toBe(true);
    expect(
      req.body.response_format.json_schema.schema.properties.tone,
    ).toBeUndefined();
    expect(
      req.body.response_format.json_schema.schema.properties.summaries.items
        .properties.language.enum,
    ).toEqual(['en', 'hi']);
    expect(req.body.messages[1].content).toContain('[caller-2] caller (en→hi)');

    expect(out.summary.en).toEqual({
      keyPoints: ['Order 4521 has not arrived'],
      decisions: ['Replacement agreed'],
      actionItems: [
        { text: 'Send replacement today', phraseId: 'caller-2' },
        { text: 'Bogus ref' },
      ],
    });
    // Missing language → extractive block.
    expect(out.summary.hi.actionItems[0].phraseId).toBe('caller-2');
    expect(out.topics).toEqual(['delivery']);
    expect(out.tone).toBeUndefined();
    expect(out.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
  });

  it('tone only when asked: worded "possible", backed by real quotes of that speaker', async () => {
    process.env.TRANSLATION_REPORT_MODEL = 'gpt-5-nano';
    const { s, calls } = make(() =>
      chat({
        summaries: [],
        topics: [],
        tone: [
          {
            speaker: 'receiver',
            topic: 'delivery',
            tone: 'Frustration',
            quotes: ['I am having a lot of trouble'],
          },
          {
            speaker: 'receiver',
            topic: 'x',
            tone: 'possible anger',
            quotes: ['made up quote'],
          },
          {
            speaker: 'caller',
            topic: 'x',
            tone: 'possible worry',
            quotes: ['I am having a lot of trouble'],
          },
        ],
      }),
    );
    const out = await s.summarize({ ...INPUT, includeTone: true });
    expect(calls[0].body.model).toBe('gpt-5-nano');
    expect(calls[0].body.response_format.json_schema.schema.required).toContain(
      'tone',
    );
    expect(out.tone).toEqual([
      {
        speaker: 'receiver',
        topic: 'delivery',
        tone: 'possible frustration',
        quotes: ['I am having a lot of trouble'],
      },
    ]);
    expect(out.topics.length).toBeGreaterThan(0); // extractive fallback
  });

  it('fails with stable codes, never provider text', async () => {
    const bad = make(
      () =>
        new Response(JSON.stringify({ error: { message: `leak ${KEY}` } }), {
          status: 401,
        }),
    );
    await expect(bad.s.summarize(INPUT)).rejects.toMatchObject({
      code: 'TRANSLATION_REPORT_UNAVAILABLE',
      message: 'TRANSLATION_REPORT_UNAVAILABLE',
    });

    const garbage = make(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'not json' } }] }),
        ),
    );
    await expect(garbage.s.summarize(INPUT)).rejects.toMatchObject({
      code: 'TRANSLATION_REPORT_FAILED',
    });

    const down = make(() => {
      throw new TypeError(`fetch failed ${KEY}`);
    });
    await expect(down.s.summarize(INPUT)).rejects.toMatchObject({
      code: 'TRANSLATION_REPORT_UNAVAILABLE',
    });

    delete process.env.OPENAI_API_KEY;
    await expect(
      new OpenAiReportSummarizer().summarize(INPUT),
    ).rejects.toMatchObject({
      code: 'TRANSLATION_REPORT_UNAVAILABLE',
    });
  });

  it('skips the network for an empty transcript', async () => {
    const { s, calls } = make(() => chat({}));
    const out = await s.summarize({ ...INPUT, phrases: [], includeTone: true });
    expect(calls).toHaveLength(0);
    expect(Object.keys(out.summary)).toEqual(['en', 'hi']);
    expect(out.tone).toEqual([]);
  });
});
