import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { EmailOtpPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SignupCreditsService } from '../billing/credits/signup-credits.service';

import { AuthService } from './auth.service';
import { EmailOtpService, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS } from './email-otp.service';
import { otpEmail } from './auth-emails';
import type { RegisterDto } from './dto/password-auth.dto';

const PASSWORD_COST = 12;
const INVALID_LOGIN = 'Incorrect email or password.';

/** Compared against when no user matches, so a miss takes as long as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', PASSWORD_COST);

/**
 * Email + password sign-in next to Google (any email address):
 *
 * - Sign-up emails a code and creates the account only once it's verified,
 *   so every password account owns its email (Google sign-in links to an
 *   existing account by email, which relies on that).
 * - Forgot password emails a code; resetting with it signs out other
 *   sessions and signs this one in.
 */
@Injectable()
export class PasswordAuthService {
  private readonly logger = new Logger(PasswordAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly otp: EmailOtpService,
    private readonly mail: MailService,
    private readonly signupCredits: SignupCreditsService,
  ) {}

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    if (await this.findByEmail(email)) {
      throw new ConflictException(
        'An account with this email already exists. Sign in, or use "Forgot password" to set a password.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_COST);
    await this.sendCode(email, EmailOtpPurpose.SIGNUP, 'signup', { name: dto.name.trim(), passwordHash });
    return codeSent(email);
  }

  async verifyRegistration(rawEmail: string, code: string) {
    const email = normalizeEmail(rawEmail);
    const payload = (await this.otp.verify(email, EmailOtpPurpose.SIGNUP, code)) as {
      name?: string;
      passwordHash?: string;
    } | null;
    if (!payload?.passwordHash) throw new BadRequestException('Sign-up expired. Please start again.');

    // Someone may have signed up (e.g. with Google) while the code was pending.
    if (await this.findByEmail(email)) {
      throw new ConflictException('An account with this email already exists. Please sign in.');
    }
    const user = await this.prisma.user.create({
      data: { email, name: payload.name ?? null, passwordHash: payload.passwordHash },
    });
    // Non-fatal: welcome credits must never block signup.
    this.signupCredits.grant(user.id).catch((err) =>
      this.logger.warn(`event=signup_credits_failed user=${user.id} reason=${(err as Error)?.message ?? 'unknown'}`),
    );
    return this.auth.issueSession(user);
  }

  async login(rawEmail: string, password: string) {
    const user = await this.findByEmail(normalizeEmail(rawEmail));
    // Always run bcrypt so response time doesn't reveal whether the account exists.
    const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
    if (!user?.passwordHash || !ok) throw new UnauthorizedException(INVALID_LOGIN);
    return this.auth.issueSession(user);
  }

  /** Always answers the same way, whether or not the account exists. */
  async forgotPassword(rawEmail: string) {
    const user = await this.findByEmail(normalizeEmail(rawEmail));
    if (user) {
      try {
        await this.sendCode(user.email, EmailOtpPurpose.PASSWORD_RESET, 'reset');
      } catch (err) {
        // A cooldown or mail failure must not reveal that the account exists.
        if (!(err instanceof HttpException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS)) {
          this.logger.warn(`event=password_reset_email_failed reason=${(err as Error)?.message ?? 'unknown'}`);
        }
      }
    }
    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000, resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000 };
  }

  async resetPassword(rawEmail: string, code: string, password: string) {
    const user = await this.findByEmail(normalizeEmail(rawEmail));
    if (!user) {
      throw new BadRequestException('That code is incorrect or has expired. Check the latest email or request a new code.');
    }
    await this.otp.verify(user.email, EmailOtpPurpose.PASSWORD_RESET, code);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      // Clearing the refresh token signs out every other session.
      data: { passwordHash: await bcrypt.hash(password, PASSWORD_COST), refreshTokenHash: null },
    });
    return this.auth.issueSession(updated);
  }

  private async sendCode(
    email: string,
    purpose: EmailOtpPurpose,
    kind: 'signup' | 'reset',
    payload?: Record<string, string>,
  ) {
    const { id, code } = await this.otp.issue(email, purpose, payload);
    try {
      await this.mail.send(otpEmail(kind, email, code, OTP_TTL_MS / 60_000));
    } catch (err) {
      await this.otp.discard(id);
      throw err;
    }
  }

  private findByEmail(email: string) {
    return this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function codeSent(email: string) {
  return { email, expiresInSeconds: OTP_TTL_MS / 1000, resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000 };
}
