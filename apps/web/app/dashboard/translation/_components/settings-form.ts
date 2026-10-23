import type { OnLimit, TranslationSettings, TranslationSettingsUpdate } from '../../../lib/translation';

export interface Form {
  replayEnabled: boolean;
  postCallReportEnabled: boolean;
  sentimentEnabled: boolean;
  transcriptRetentionDays: string;
  industry: string;
  defaultLexiconId: string;
  defaultMaxMinutes: string;
  dailyBudgetCredits: string;
  monthlyBudgetCredits: string;
  alertThresholds: string;
  onLimit: OnLimit;
}

export const toForm = (s: TranslationSettings): Form => ({
  replayEnabled: !!s.replayEnabled,
  postCallReportEnabled: !!s.postCallReportEnabled,
  sentimentEnabled: !!s.sentimentEnabled && s.industry !== 'healthcare',
  transcriptRetentionDays: String(s.transcriptRetentionDays ?? 30),
  industry: s.industry ?? '',
  defaultLexiconId: s.defaultLexiconId ?? '',
  defaultMaxMinutes: s.defaultMaxMinutes == null ? '' : String(s.defaultMaxMinutes),
  dailyBudgetCredits: s.dailyBudgetCredits == null ? '' : String(s.dailyBudgetCredits),
  monthlyBudgetCredits: s.monthlyBudgetCredits == null ? '' : String(s.monthlyBudgetCredits),
  alertThresholds: (s.alertThresholds ?? []).join(', '),
  onLimit: s.onLimit === 'off' ? 'off' : 'captions_then_off',
});

export const whole = (v: string) => /^\d+$/.test(v.trim());

/** Validates the form and builds the PATCH body, or returns an error message. */
export function buildSettingsPatch(f: Form): TranslationSettingsUpdate | string {
  const optional = (v: string, label: string, min: number, max?: number): number | null | string => {
    if (!v.trim()) return null;
    if (!whole(v) || Number(v) < min || (max != null && Number(v) > max)) {
      return max != null ? `${label} must be a whole number between ${min} and ${max}.` : `${label} must be a whole number of at least ${min}.`;
    }
    return Number(v);
  };
  const maxMinutes = optional(f.defaultMaxMinutes, 'Per-call limit', 1, 600);
  if (typeof maxMinutes === 'string') return maxMinutes;
  const daily = optional(f.dailyBudgetCredits, 'Daily budget', 1);
  if (typeof daily === 'string') return daily;
  const monthly = optional(f.monthlyBudgetCredits, 'Monthly budget', 1);
  if (typeof monthly === 'string') return monthly;
  if (daily != null && monthly != null && daily > monthly) return 'The daily budget cannot be more than the monthly budget.';
  const parts = f.alertThresholds.split(',').map((t) => t.trim()).filter(Boolean);
  if (parts.some((t) => !whole(t) || Number(t) < 1 || Number(t) > 100)) {
    return 'Alert thresholds must be whole percentages between 1 and 100, separated by commas.';
  }
  const thresholds = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  return {
    replayEnabled: f.replayEnabled,
    postCallReportEnabled: f.postCallReportEnabled,
    sentimentEnabled: f.industry === 'healthcare' ? false : f.sentimentEnabled,
    transcriptRetentionDays: Number(f.transcriptRetentionDays),
    industry: f.industry || null,
    defaultLexiconId: f.defaultLexiconId || null,
    defaultMaxMinutes: maxMinutes,
    dailyBudgetCredits: daily,
    monthlyBudgetCredits: monthly,
    alertThresholds: thresholds,
    onLimit: f.onLimit,
  };
}

