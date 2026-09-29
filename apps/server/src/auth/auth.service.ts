import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import * as bcrypt from 'bcrypt';

import { JwtService } from '@nestjs/jwt';

import { OAuth2Client } from 'google-auth-library';

import { BillingService } from '../billing/billing.service';

import { UpdateProfileDto } from './dto/update-profile.dto';
import { toUserProfile, PROFILE_SELECT } from './user-profile';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private billingService: BillingService,
  ) {
    this.googleClient = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
  }

  async loginWithGoogle(idToken: string) {
    // Verify the Google ID token.
    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException(
        'Invalid Google token',
      );
    }

    if (!payload || !payload.email) {
      throw new UnauthorizedException(
        'Invalid Google token payload',
      );
    }

    const email = payload.email;
    const googleId = payload.sub;
    const name =
      payload.name ?? null;
    const avatarUrl =
      payload.picture ?? null;

    // Find an existing user by googleId, then by email.
    let user =
      await this.prisma.user.findUnique({
        where: { googleId },
      });

    if (!user) {
      user =
        await this.prisma.user.findUnique({
          where: { email },
        });

      // New user — create one.
      if (!user) {
        user =
          await this.prisma.user.create({
            data: {
              email,
              googleId,
              name,
              avatarUrl,
            },
          });
} else {
        // Existing email user — link the Google account.
        user =
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              googleId,
              name: name ?? user.name,
              avatarUrl: avatarUrl ?? user.avatarUrl,
            },
          });
      }
    }

    // Ensure the user has a subscription + usage record (Free plan by default).
    this.billingService.getOrCreateFreeSubscription(user.id).catch(() => {
      // Non-fatal: subscription assignment should not block login.
    });

    const tokens =
      await this.generateTokens(user.id);

    await this.saveRefreshToken(
      user.id,
      tokens.refreshToken,
    );

    return {
      user: toUserProfile(user),
      ...tokens,
      // Backend-controlled: the client stays on /login and shows the
      // profile-completion step until this is false.
      onboardingRequired: !user.profileCompleted,
    };
  }

  private async generateTokens(
    userId: string,
  ) {
    const accessToken =
      await this.jwtService.signAsync(
        {
          sub: userId,
        },
        {
          secret:
            process.env.JWT_ACCESS_SECRET,
          expiresIn: '15m',
        },
      );

    const refreshToken =
      await this.jwtService.signAsync(
        {
          sub: userId,
        },
        {
          secret:
            process.env.JWT_REFRESH_SECRET,
          expiresIn: '30d',
        },
      );

    return {
      accessToken,
      refreshToken,
    };
  }

  private async saveRefreshToken(
    userId: string,
    refreshToken: string,
  ) {
    const hash =
      await bcrypt.hash(
        refreshToken,
        10,
      );

    await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        refreshTokenHash: hash,
      },
    });
  }

  async refreshToken(
    refreshToken: string,
  ) {
    const payload =
      await this.jwtService.verifyAsync(
        refreshToken,
        {
          secret:
            process.env.JWT_REFRESH_SECRET,
        },
      );

    const user =
      await this.prisma.user.findUnique({
        where: {
          id: payload.sub,
        },
      });

    if (!user) {
      throw new UnauthorizedException();
    }

    const valid =
      await bcrypt.compare(
        refreshToken,
        user.refreshTokenHash || '',
      );

    if (!valid) {
      throw new UnauthorizedException();
    }

    const tokens =
      await this.generateTokens(user.id);

    await this.saveRefreshToken(
      user.id,
      tokens.refreshToken,
    );

    return tokens;
  }

  /**
   * Contact number, collected once right after login (not re-asked later,
   * e.g. when saving a card) — see BillingService.setContactPhone for why
   * Razorpay needs this synced onto the payment-provider customer too.
   */
  async setPhone(userId: string, phone: string) {
    return this.billingService.setContactPhone(userId, phone);
  }

  /**
   * Onboarding / profile completion for the authenticated user (id always
   * from the JWT). The phone goes through the existing setContactPhone path
   * so the Razorpay customer contact stays in sync — only when it actually
   * changed, so re-submitting an unchanged number doesn't re-hit Razorpay.
   * Phone is saved first: if that fails, profileCompleted stays false and
   * the user can simply retry.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (!current) {
      throw new UnauthorizedException();
    }

    const phone = dto.phone.trim();
    if (phone !== current.phone) {
      await this.billingService.setContactPhone(userId, phone);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name.trim(),
        companyName: dto.companyName.trim(),
        jobTitle: dto.jobTitle.trim(),
        country: dto.country.toUpperCase(),
        // undefined leaves an optional field unchanged; null clears it.
        companyWebsite:
          typeof dto.companyWebsite === 'string'
            ? normalizeWebsite(dto.companyWebsite)
            : dto.companyWebsite,
        expectedUsageRange: dto.expectedUsageRange,
        primaryUseCase: dto.primaryUseCase,
        profileCompleted: true,
      },
      select: PROFILE_SELECT,
    });

    return {
      user: toUserProfile(user),
      onboardingRequired: false,
    };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        refreshTokenHash: null,
      },
    });

    return {
      success: true,
    };
  }
}

/** Stores websites with an explicit scheme ("acme.com" -> "https://acme.com"). */
function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
