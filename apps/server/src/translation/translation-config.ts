import { BadRequestException } from '@nestjs/common';
import { TranslationMode } from '@prisma/client';

import { LANGUAGE_TAG } from '../ai/dto/validators';
import { normalizeLanguage } from './languages';

/**
 * Validated shape of `Call.translationConfig` (see translation/PROTOCOL.md §1).
 * Everything the developer sends under `translation` except `mode`, which is
 * stored in its own column (`Call.translationMode`).
 */

export type TranslationModeName = 'off' | 'captions' | 'voice';
export const TRANSLATION_MODES: TranslationModeName[] = [
  'off',
  'captions',
  'voice',
];

export type GuardSensitivity = 'low' | 'standard' | 'high';
export const GUARD_SENSITIVITIES: GuardSensitivity[] = [
  'low',
  'standard',
  'high',
];
/** Accepted aliases, stored as the canonical name. */
const SENSITIVITY_ALIASES: Record<string, GuardSensitivity> = {
  relaxed: 'low',
  strict: 'high',
};

export type OnLimitAction = 'captions_then_off' | 'off';
export const ON_LIMIT_ACTIONS: OnLimitAction[] = ['captions_then_off', 'off'];

export const MAX_CALL_MINUTES = 600;
export const MAX_PURPOSE_LENGTH = 200;
export const MAX_ROLE_LENGTH = 60;
const INDUSTRY_SLUG = /^[a-z][a-z0-9_-]{0,39}$/;

export interface TranslationCallContext {
  industry?: string;
  purpose?: string;
  roles?: { caller?: string; receiver?: string };
}

export interface TranslationGuardConfig {
  enabled: boolean;
  sensitivity: GuardSensitivity;
  /**
   * Left undefined unless sent: the relay allows replay when the project
   * has replayEnabled and this is not explicitly false.
   */
  replay?: boolean;
}

export interface TranslationCallConfig {
  lexiconId?: string;
  context?: TranslationCallContext;
  postCallReport?: boolean;
  maxMinutes?: number;
  guard?: TranslationGuardConfig;
  onLimit?: OnLimitAction;
}

export interface TranslationRequest extends TranslationCallConfig {
  mode?: TranslationModeName;
}

export const TranslationErrorCode = {
  INVALID_LANGUAGE: 'TRANSLATION_INVALID_LANGUAGE',
  INVALID_CONFIG: 'TRANSLATION_INVALID_CONFIG',
  LEXICON_NOT_FOUND: 'TRANSLATION_LEXICON_NOT_FOUND',
  NOT_IN_PLAN: 'TRANSLATION_NOT_IN_PLAN',
  INSUFFICIENT_CREDITS: 'TRANSLATION_INSUFFICIENT_CREDITS',
  REPORT_NOT_FOUND: 'TRANSLATION_REPORT_NOT_FOUND',
  CALL_ENDED: 'TRANSLATION_CALL_ENDED',
} as const;

export function translationBadRequest(
  code: string,
  message: string,
): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message });
}

/** `LANGUAGE_TAG` ("en", "hi", "en-IN"); `auto` only where allowed (speak side). */
export function isValidLanguage(
  value: unknown,
  opts: { allowAuto?: boolean } = {},
): value is string {
  if (typeof value !== 'string') return false;
  if (value === 'auto') return !!opts.allowAuto;
  return LANGUAGE_TAG.test(value) && normalizeLanguage(value) !== null;
}

/** Throws 400 TRANSLATION_INVALID_LANGUAGE unless the value is absent or valid. */
export function assertLanguage(
  field: string,
  value: unknown,
  opts: { allowAuto?: boolean } = { allowAuto: true },
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isValidLanguage(value, opts)) {
    throw translationBadRequest(
      TranslationErrorCode.INVALID_LANGUAGE,
      `${field} must be a language code like "en", "hi" or "en-IN"${opts.allowAuto ? ' (or "auto")' : ''}.`,
    );
  }
  return value;
}

export function modeToDb(mode: TranslationModeName): TranslationMode {
  return mode === 'voice'
    ? TranslationMode.VOICE
    : mode === 'captions'
      ? TranslationMode.CAPTIONS
      : TranslationMode.OFF;
}

export function modeFromDb(
  mode: TranslationMode | string | null | undefined,
): TranslationModeName {
  if (mode === TranslationMode.VOICE) return 'voice';
  if (mode === TranslationMode.CAPTIONS) return 'captions';
  return 'off';
}

export function parseMode(value: unknown): TranslationModeName {
  if (
    typeof value !== 'string' ||
    !TRANSLATION_MODES.includes(value as TranslationModeName)
  ) {
    throw translationBadRequest(
      TranslationErrorCode.INVALID_CONFIG,
      'translation.mode must be one of off, captions, voice.',
    );
  }
  return value as TranslationModeName;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function invalid(message: string): never {
  throw translationBadRequest(TranslationErrorCode.INVALID_CONFIG, message);
}

function optionalString(
  value: unknown,
  field: string,
  max: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') invalid(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length > max) invalid(`${field} must be at most ${max} characters.`);
  return trimmed || undefined;
}

/**
 * Validates the `translation` object of POST /calls. Unknown keys are
 * rejected so typos surface instead of being silently ignored.
 * Throws 400 `TRANSLATION_INVALID_CONFIG`.
 */
export function validateTranslationRequest(raw: unknown): TranslationRequest {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) invalid('translation must be an object.');
  const allowed = new Set([
    'mode',
    'lexiconId',
    'context',
    'postCallReport',
    'maxMinutes',
    'guard',
    'onLimit',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) invalid(`translation.${key} is not a known field.`);
  }
  const out: TranslationRequest = {};
  if (raw.mode !== undefined) out.mode = parseMode(raw.mode);

  if (raw.lexiconId !== undefined && raw.lexiconId !== null) {
    if (
      typeof raw.lexiconId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(raw.lexiconId)
    ) {
      throw translationBadRequest(
        TranslationErrorCode.LEXICON_NOT_FOUND,
        'translation.lexiconId does not refer to a lexicon of this project.',
      );
    }
    out.lexiconId = raw.lexiconId;
  }

  if (raw.context !== undefined && raw.context !== null) {
    const ctx = raw.context;
    if (!isPlainObject(ctx)) invalid('translation.context must be an object.');
    for (const key of Object.keys(ctx)) {
      if (!['industry', 'purpose', 'roles'].includes(key))
        invalid(`translation.context.${key} is not a known field.`);
    }
    const context: TranslationCallContext = {};
    const industry = optionalString(
      ctx.industry,
      'translation.context.industry',
      40,
    );
    if (industry !== undefined) {
      const slug = industry.toLowerCase();
      if (!INDUSTRY_SLUG.test(slug))
        invalid('translation.context.industry must be a short lowercase name.');
      context.industry = slug;
    }
    const purpose = optionalString(
      ctx.purpose,
      'translation.context.purpose',
      MAX_PURPOSE_LENGTH,
    );
    if (purpose !== undefined) context.purpose = purpose;
    if (ctx.roles !== undefined && ctx.roles !== null) {
      if (!isPlainObject(ctx.roles))
        invalid('translation.context.roles must be an object.');
      for (const key of Object.keys(ctx.roles)) {
        if (!['caller', 'receiver'].includes(key))
          invalid(`translation.context.roles.${key} is not a known field.`);
      }
      const caller = optionalString(
        ctx.roles.caller,
        'translation.context.roles.caller',
        MAX_ROLE_LENGTH,
      );
      const receiver = optionalString(
        ctx.roles.receiver,
        'translation.context.roles.receiver',
        MAX_ROLE_LENGTH,
      );
      if (caller !== undefined || receiver !== undefined) {
        context.roles = {};
        if (caller !== undefined) context.roles.caller = caller;
        if (receiver !== undefined) context.roles.receiver = receiver;
      }
    }
    if (Object.keys(context).length) out.context = context;
  }

  if (raw.postCallReport !== undefined) {
    if (typeof raw.postCallReport !== 'boolean')
      invalid('translation.postCallReport must be true or false.');
    out.postCallReport = raw.postCallReport;
  }

  if (raw.maxMinutes !== undefined && raw.maxMinutes !== null) {
    const m = raw.maxMinutes;
    if (
      typeof m !== 'number' ||
      !Number.isInteger(m) ||
      m < 1 ||
      m > MAX_CALL_MINUTES
    )
      invalid(
        `translation.maxMinutes must be a whole number between 1 and ${MAX_CALL_MINUTES}.`,
      );
    out.maxMinutes = m;
  }

  if (raw.guard !== undefined && raw.guard !== null) {
    const g = raw.guard;
    if (!isPlainObject(g)) invalid('translation.guard must be an object.');
    for (const key of Object.keys(g)) {
      if (!['enabled', 'sensitivity', 'replay'].includes(key))
        invalid(`translation.guard.${key} is not a known field.`);
    }
    if (g.enabled !== undefined && typeof g.enabled !== 'boolean')
      invalid('translation.guard.enabled must be true or false.');
    if (g.replay !== undefined && typeof g.replay !== 'boolean')
      invalid('translation.guard.replay must be true or false.');
    let sensitivity: GuardSensitivity = 'standard';
    if (g.sensitivity !== undefined) {
      const raw = String(g.sensitivity);
      const canonical =
        SENSITIVITY_ALIASES[raw] ??
        (GUARD_SENSITIVITIES.includes(raw as GuardSensitivity)
          ? (raw as GuardSensitivity)
          : null);
      if (typeof g.sensitivity !== 'string' || !canonical)
        invalid(
          `translation.guard.sensitivity must be one of ${GUARD_SENSITIVITIES.join(', ')}.`,
        );
      sensitivity = canonical;
    }
    out.guard = {
      enabled: (g.enabled as boolean | undefined) ?? true,
      sensitivity,
      ...(g.replay !== undefined ? { replay: g.replay as boolean } : {}),
    };
  }

  if (raw.onLimit !== undefined && raw.onLimit !== null) {
    if (!ON_LIMIT_ACTIONS.includes(raw.onLimit as OnLimitAction))
      invalid(
        `translation.onLimit must be one of ${ON_LIMIT_ACTIONS.join(', ')}.`,
      );
    out.onLimit = raw.onLimit as OnLimitAction;
  }
  return out;
}

/**
 * Tolerant read of a stored `Call.translationConfig` (never throws; drops
 * anything malformed). Use this everywhere the JSON column is consumed.
 */
export function readTranslationConfig(raw: unknown): TranslationCallConfig {
  if (!isPlainObject(raw)) return {};
  try {
    const { mode: _mode, ...rest } = validateTranslationRequest({
      ...raw,
      mode: undefined,
    });
    void _mode;
    return rest;
  } catch {
    const out: TranslationCallConfig = {};
    if (typeof raw.lexiconId === 'string') out.lexiconId = raw.lexiconId;
    if (typeof raw.postCallReport === 'boolean')
      out.postCallReport = raw.postCallReport;
    if (typeof raw.maxMinutes === 'number') out.maxMinutes = raw.maxMinutes;
    if (raw.onLimit === 'off' || raw.onLimit === 'captions_then_off')
      out.onLimit = raw.onLimit;
    if (isPlainObject(raw.context)) {
      const c = raw.context;
      out.context = {
        industry: typeof c.industry === 'string' ? c.industry : undefined,
        purpose: typeof c.purpose === 'string' ? c.purpose : undefined,
      };
    }
    return out;
  }
}

/** Strips `mode` so only the JSON-column part is persisted. */
export function configForStorage(
  req: TranslationRequest,
): TranslationCallConfig {
  const { mode: _mode, ...rest } = req;
  void _mode;
  return rest;
}
