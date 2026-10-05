import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Rejects empty and whitespace-only strings. */
const NOT_BLANK = /\S/;

export const SUBJECT_MAX_LENGTH = 200;
export const MESSAGE_MAX_LENGTH = 5000;

/**
 * The ticket owner is always taken from the JWT — there is deliberately no
 * userId or status field here, and the global ValidationPipe
 * (whitelist: true) strips any that is sent.
 */
export class CreateTicketDto {
  @IsString()
  @Matches(NOT_BLANK, { message: 'Subject is required.' })
  @MaxLength(SUBJECT_MAX_LENGTH)
  subject: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'Message is required.' })
  @MaxLength(MESSAGE_MAX_LENGTH)
  message: string;

  // Slug of a public docs page (/docs/<slug>).
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'Select a valid documentation page.' })
  @MaxLength(64)
  documentationId?: string;
}
