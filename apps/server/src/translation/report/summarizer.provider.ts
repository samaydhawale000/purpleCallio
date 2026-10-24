import { Provider } from '@nestjs/common';

import { REPORT_SUMMARIZER, ReportSummarizer } from './report-summarizer.interface';
import { ExtractiveReportSummarizer } from './extractive-summarizer';

/** Deterministic local post-call summary; no second AI provider is invoked. */
export class ActiveReportSummarizer implements ReportSummarizer {
  constructor(private readonly extractive: ReportSummarizer) {}
  get name() { return this.extractive.name; }
  isConfigured() { return true; }
  summarize(input: Parameters<ReportSummarizer['summarize']>[0]) { return this.extractive.summarize(input); }
}

export const reportSummarizerProvider: Provider = {
  provide: REPORT_SUMMARIZER,
  useFactory: (extractive: ExtractiveReportSummarizer) => new ActiveReportSummarizer(extractive),
  inject: [ExtractiveReportSummarizer],
};
