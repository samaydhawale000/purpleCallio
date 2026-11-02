import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { EmailOtpPurpose, Prisma } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
const OTP_MAX_SENDS_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;

const INVALID_CODE = 'That code is incorrect or has expired. Check the latest email or request a new code.';

/**
 * 6-digit codes emailed for sign-up and password reset. Only an HMAC of the
 * code is stored; a new code replaces the pending one for the same
 * email + purpose; each code allows OTP_MAX_ATTEMPTS guesses.
 */
@Injectable()
export class EmailOtpService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a code (throws 429 while a recent one is still cooling down). */
  async issue(email: string, purpose: EmailOtpPurpose, payload?: Prisma.InputJsonValue) {
    const now = Date.now();
    const recent = await this.prisma.emailOtp.findMany({
      where: { email, purpose, createdAt: { gt: new Date(now - 60 * 60_000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const last = recent[0]?.createdAt.getTime();
    if (last !== undefined && now - last < OTP_RESEND_COOLDOWN_MS) {
      throw tooMany(Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - last)) / 1000));
    }
    if (recent.length >= OTP_MAX_SENDS_PER_HOUR) {
      const oldest = recent[recent.length - 1].createdAt.getTime();
      throw tooMany(Math.ceil((oldest + 60 * 60_000 - now) / 1000));
    }

    // Only the newest code is valid; old rows for this email are pruned.
    await this.prisma.emailOtp.updateMany({
      where: { email, purpose, consumedAt: null },
      data: { consumedAt: new Date(now) },
    });
    await this.prisma.emailOtp.deleteMany({
      where: { email, createdAt: { lt: new Date(now - 24 * 60 * 60_000) } },
    });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = await this.prisma.emailOtp.create({
      data: {
        email,
        purpose,
        codeHash: hashCode(email, purpose, code),
        payload: payload ?? Prisma.DbNull,
        expiresAt: new Date(now + OTP_TTL_MS),
      },
      select: { id: true },
    });
    return { id: row.id, code };
  }

  /** Drops a code whose email could not be sent, so the user can retry at once. */
  async discard(id: string) {
    await this.prisma.emailOtp.deleteMany({ where: { id } });
  }

  /** Consumes the pending code if it matches; returns its payload. */
  async verify(email: string, purpose: EmailOtpPurpose, code: string): Promise<Prisma.JsonValue> {
    const pending = await this.prisma.emailOtp.findFirst({
      where: { email, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) throw new BadRequestException(INVALID_CODE);

    // Count the guess first (atomically), so parallel guesses can't exceed the cap.
    const counted = await this.prisma.emailOtp.updateMany({
      where: { id: pending.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
      throw new BadRequestException('Too many incorrect attempts. Request a new code.');
    }

    const expected = Buffer.from(pending.codeHash, 'hex');
    const actual = Buffer.from(hashCode(email, purpose, code.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new BadRequestException(INVALID_CODE);
    }

    const consumed = await this.prisma.emailOtp.updateMany({
      where: { id: pending.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw new BadRequestException(INVALID_CODE);
    return pending.payload;
  }
}

function hashCode(email: string, purpose: EmailOtpPurpose, code: string) {
  const secret = process.env.OTP_SECRET?.trim() || process.env.JWT_ACCESS_SECRET || '';
  return createHmac('sha256', secret).update(`${purpose}:${email}:${code}`).digest('hex');
}

function tooMany(retryAfterSeconds: number) {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: `Please wait ${retryAfterSeconds} seconds before requesting another code.`,
      retryAfterSeconds,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
