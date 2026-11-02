import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Rejects empty and whitespace-only strings. */
const NOT_BLANK = /\S/;

/** 8–72 characters (bcrypt's limit) with at least one letter and one number. */
export const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)[\s\S]{8,72}$/;
const PASSWORD_MESSAGE = 'Use 8–72 characters with at least one letter and one number.';

export class RegisterDto {
  @IsString()
  @Matches(NOT_BLANK, { message: 'Full name is required.' })
  @MaxLength(100)
  name: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(PASSWORD_RE, { message: PASSWORD_MESSAGE })
  password: string;
}

export class VerifyRegistrationDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(/^\s*\d{6}\s*$/, { message: 'Enter the 6-digit code from the email.' })
  code: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(200)
  password: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(/^\s*\d{6}\s*$/, { message: 'Enter the 6-digit code from the email.' })
  code: string;

  @IsString()
  @Matches(PASSWORD_RE, { message: PASSWORD_MESSAGE })
  password: string;
}
