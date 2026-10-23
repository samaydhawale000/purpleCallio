import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { AI_PROVIDER_NAMES } from '../providers/ai-provider.registry';
import { LANGUAGE_TAG, NOT_BLANK } from './validators';

export const AGENT_NAME_MAX_LENGTH = 100;
export const AGENT_DESCRIPTION_MAX_LENGTH = 500;
export const INSTRUCTIONS_MAX_LENGTH = 20_000;
export const WELCOME_MESSAGE_MAX_LENGTH = 1000;
export const MIN_DURATION_SECONDS = 30;

/**
 * Optional config fields shared by create and update; changing any of them
 * (or instructions, declared on each subclass) creates a new version.
 */
export class AgentConfigFieldsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(WELCOME_MESSAGE_MAX_LENGTH)
  welcomeMessage?: string | null;

  @IsOptional()
  @IsString()
  @Matches(LANGUAGE_TAG, { message: 'Select a valid language.' })
  language?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,64}$/, { message: 'Select a valid voice.' })
  voice?: string | null;

  @IsOptional()
  @IsIn(AI_PROVIDER_NAMES, { message: 'Select a valid provider.' })
  provider?: string;

  // Clamped to AI_MAX_DURATION_CAP_SECONDS by the service.
  @IsOptional()
  @IsInt()
  @Min(MIN_DURATION_SECONDS)
  maxDurationSeconds?: number;
}

/**
 * The owner comes from the JWT via the project — there is no ownerId here,
 * and the global ValidationPipe (whitelist: true) strips unknown fields.
 */
export class CreateAgentDto extends AgentConfigFieldsDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'Name is required.' })
  @MaxLength(AGENT_NAME_MAX_LENGTH)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(AGENT_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'Instructions are required.' })
  @MaxLength(INSTRUCTIONS_MAX_LENGTH)
  instructions: string;
}
