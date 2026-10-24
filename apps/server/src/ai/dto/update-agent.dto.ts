import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AiAgentStatus } from '@prisma/client';

import {
  AGENT_DESCRIPTION_MAX_LENGTH,
  AGENT_NAME_MAX_LENGTH,
  AgentConfigFieldsDto,
  INSTRUCTIONS_MAX_LENGTH,
} from './create-agent.dto';
import { NOT_BLANK, TRANSCRIPT_RETENTION_DAYS } from './validators';

/**
 * Config fields (inherited) create a new version; the fields declared here
 * are edited in place on the agent.
 */
export class UpdateAgentDto extends AgentConfigFieldsDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, { message: 'Instructions are required.' })
  @MaxLength(INSTRUCTIONS_MAX_LENGTH)
  instructions?: string;

  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, { message: 'Name is required.' })
  @MaxLength(AGENT_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(AGENT_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @IsEnum(AiAgentStatus, { message: 'Select a valid status.' })
  status?: AiAgentStatus;

  @IsOptional()
  @IsBoolean()
  storeTranscript?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(TRANSCRIPT_RETENTION_DAYS, {
    message: 'Retention must be 7, 30 or 90 days.',
  })
  transcriptRetentionDays?: number | null;
}
