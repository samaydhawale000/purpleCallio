import { IsOptional } from 'class-validator';

/**
 * Request bodies for the Live Translate REST API (translation/PROTOCOL.md §1).
 *
 * Most bodies are plain types (not classes) on purpose: the global
 * ValidationPipe skips them and the services validate field by field,
 * returning stable `code`s (TRANSLATION_INVALID_CONFIG, …) instead of
 * class-validator's generic messages.
 */

export type { TranslationSettingsUpdate as UpdateTranslationSettingsBody } from '../translation-settings.service';
export type { LexiconTermInput } from '../translation-lexicon.service';
export type { RateOverrideInput as PutRateOverrideBody } from '../translation-admin.service';

export interface CreateLexiconBody {
  name: string;
  industry?: string | null;
  terms?: import('../translation-lexicon.service').LexiconTermInput[];
}

export interface UpdateLexiconBody {
  name?: string;
  industry?: string | null;
}

export interface ImportLexiconCsvBody {
  /** Columns: term,kind,lang:hi,lang:ta,…,pronunciation (header row required). */
  csv: string;
}

export interface LexiconFromPackBody {
  industry: string;
  name?: string;
}

export interface MetricsQuery {
  from?: string;
  to?: string;
  pair?: string;
  route?: string;
}

export interface EstimateQuery {
  mode?: string;
  minutes?: string;
  calls?: string;
  pair?: string;
}

/**
 * PATCH /calls/:id/translation. A class so the whitelist keeps exactly
 * these keys; values are validated by CallService (stable error codes).
 */
export class UpdateCallTranslationDto {
  @IsOptional()
  mode?: string;

  @IsOptional()
  callerLanguage?: string | null;

  @IsOptional()
  receiverLanguage?: string | null;
}
