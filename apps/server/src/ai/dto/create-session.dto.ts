import { Type } from 'class-transformer';
import {
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { MaxJsonBytes, NOT_BLANK } from './validators';

export const SESSION_METADATA_MAX_BYTES = 2048;

export class SessionParticipantDto {
  // The customer's own user id; PurpleCallio never looks it up.
  @IsString()
  @Matches(NOT_BLANK, { message: 'participant.id is required.' })
  @MaxLength(128)
  id: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

/** POST /ai/sessions: the project comes from the API key. */
export class CreateAiSessionDto {
  @IsUUID()
  agentId: string;

  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => SessionParticipantDto)
  participant: SessionParticipantDto;

  // Free-form context for the agent prompt, e.g. { orderId }.
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(SESSION_METADATA_MAX_BYTES)
  metadata?: Record<string, unknown>;
}
