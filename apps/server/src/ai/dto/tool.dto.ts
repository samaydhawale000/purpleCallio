import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AiToolMethod } from '@prisma/client';

import {
  IsToolEndpointUrl,
  IsToolParametersSchema,
  MaxJsonBytes,
  NOT_BLANK,
  TOOL_NAME,
} from './validators';

export const TOOL_DESCRIPTION_MAX_LENGTH = 1024;
export const ENDPOINT_URL_MAX_LENGTH = 2048;
export const MIN_TOOL_TIMEOUT_MS = 500;
// Upper bound for the field; the service also clamps to AI_TOOL_TIMEOUT_MS.
export const MAX_TOOL_TIMEOUT_MS = 30_000;

const TOOL_NAME_MESSAGE =
  'Tool name must start with a letter and contain only letters, digits and underscores (max 64).';

export class CreateToolDto {
  @IsString()
  @Matches(TOOL_NAME, { message: TOOL_NAME_MESSAGE })
  name: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'Description is required.' })
  @MaxLength(TOOL_DESCRIPTION_MAX_LENGTH)
  description: string;

  @IsToolParametersSchema()
  parametersSchema: Record<string, unknown>;

  @IsToolEndpointUrl({ message: 'Endpoint URL must be an https:// URL.' })
  @MaxLength(ENDPOINT_URL_MAX_LENGTH)
  endpointUrl: string;

  @IsOptional()
  @IsEnum(AiToolMethod, { message: 'Method must be POST or GET.' })
  method?: AiToolMethod;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresConfirmation?: boolean;

  @IsOptional()
  @IsInt()
  @Min(MIN_TOOL_TIMEOUT_MS)
  @Max(MAX_TOOL_TIMEOUT_MS)
  timeoutMs?: number;
}

/** Every field optional; signingSecret can't be changed here. */
export class UpdateToolDto {
  @IsOptional()
  @IsString()
  @Matches(TOOL_NAME, { message: TOOL_NAME_MESSAGE })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, { message: 'Description is required.' })
  @MaxLength(TOOL_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsToolParametersSchema()
  parametersSchema?: Record<string, unknown>;

  @IsOptional()
  @IsToolEndpointUrl({ message: 'Endpoint URL must be an https:// URL.' })
  @MaxLength(ENDPOINT_URL_MAX_LENGTH)
  endpointUrl?: string;

  @IsOptional()
  @IsEnum(AiToolMethod, { message: 'Method must be POST or GET.' })
  method?: AiToolMethod;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresConfirmation?: boolean;

  @IsOptional()
  @IsInt()
  @Min(MIN_TOOL_TIMEOUT_MS)
  @Max(MAX_TOOL_TIMEOUT_MS)
  timeoutMs?: number;
}

export class TestToolDto {
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(16 * 1024)
  arguments?: Record<string, unknown>;
}
