import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import type { TranslationRequest } from '../../translation/translation-config';

export enum CallTypeDto {
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
}

export class CreateCallDto {
  @IsString()
  callerId: string;

  @IsString()
  receiverId: string;

  @IsEnum(CallTypeDto)
  type: CallTypeDto;

  // Display identity for the call UI (e.g. the incoming-call screen). The
  // integrating app owns its own users — PurpleCallio only transports/shows
  // whatever it's given here, it never looks anyone up.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  callerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  callerAvatar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  receiverName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  receiverAvatar?: string;

  // ── Live Translate (translation/PROTOCOL.md §1) ──────
  // Validated by CallService (stable `code`s such as
  // TRANSLATION_INVALID_LANGUAGE), not by class-validator, so these only
  // carry @IsOptional() to survive the whitelist.

  /** "en", "hi", "en-IN" or "auto". */
  @IsOptional()
  callerLanguage?: string;

  @IsOptional()
  receiverLanguage?: string;

  /** { mode, lexiconId, context, postCallReport, maxMinutes, guard, onLimit } */
  @IsOptional()
  translation?: TranslationRequest;
}
