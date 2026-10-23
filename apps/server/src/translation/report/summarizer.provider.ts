import { Provider } from '@nestjs/common';

import { REPORT_SUMMARIZER, ReportSummarizer } from './report-summarizer.interface';
import { OpenAiReportSummarizer } from './openai-summarizer';
import { ExtractiveReportSummarizer } from './extractive-summarizer';

/**
 * REPORT_SUMMARIZER → OpenAI (chat completions, JSON) when configured
 * (OPENAI_API_KEY), else the deterministic extractive summarizer. Resolved
 * per call so a key added at runtime is picked up without a restart.
 */
export class ActiveReportSummarizer implements ReportSummarizer {
  constructor(
    private readonly openai: ReportSummarizer,
    private readonly fallback: ReportSummarizer,
  ) {}

  private active(): ReportSummarizer {
    return this.openai.isConfigured() ? this.openai : this.fallback;
  }

  get name() {
    return this.active().name;
  }

  isConfigured() {
    return true;
  }

  summarize(input: Parameters<ReportSummarizer['summarize']>[0]) {
    return this.active().summarize(input);
  }
}

export const reportSummarizerProvider: Provider = {
  provide: REPORT_SUMMARIZER,
  useFactory: (openai: OpenAiReportSummarizer, extractive: ExtractiveReportSummarizer) =>
    new ActiveReportSummarizer(openai, extractive),
  inject: [OpenAiReportSummarizer, ExtractiveReportSummarizer],
};
