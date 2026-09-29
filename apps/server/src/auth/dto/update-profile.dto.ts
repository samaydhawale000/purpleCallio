import {
  IsEnum,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { ExpectedUsageRange, PrimaryUseCase } from '@prisma/client';

import { PHONE_RE } from '../../billing/billing.service';

/** Rejects empty and whitespace-only strings. */
const NOT_BLANK = /\S/;

/**
 * Onboarding / profile completion payload. The user being updated is always
 * taken from the JWT — there is deliberately no userId field here, and the
 * global ValidationPipe (whitelist: true) strips any that is sent.
 */
export class UpdateProfileDto {
  @IsString()
  @Matches(NOT_BLANK, { message: 'Full name is required.' })
  @MaxLength(100)
  name: string;

  @IsString()
  @Matches(PHONE_RE, {
    message:
      'Enter a valid phone number with country code, e.g. +919876543210.',
  })
  phone: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'Company / organization is required.' })
  @MaxLength(150)
  companyName: string;

  @IsString()
  @Matches(NOT_BLANK, { message: 'Job title / role is required.' })
  @MaxLength(100)
  jobTitle: string;

  @IsISO31661Alpha2({ message: 'Select a valid country.' })
  country: string;

  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_tld: true },
    { message: 'Enter a valid website URL, e.g. https://example.com.' },
  )
  @MaxLength(255)
  companyWebsite?: string;

  @IsOptional()
  @IsEnum(ExpectedUsageRange, { message: 'Select a valid usage range.' })
  expectedUsageRange?: ExpectedUsageRange;

  @IsOptional()
  @IsEnum(PrimaryUseCase, { message: 'Select a valid use case.' })
  primaryUseCase?: PrimaryUseCase;
}
