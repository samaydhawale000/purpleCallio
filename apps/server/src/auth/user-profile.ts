import type { Prisma } from '@prisma/client';

/**
 * The only User columns returned to the client by the auth endpoints
 * (/auth/google, /auth/me, /auth/profile). Never widen this to secrets such
 * as refreshTokenHash, passwordHash or the saved-card token.
 */
export const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  phone: true,
  companyName: true,
  jobTitle: true,
  country: true,
  companyWebsite: true,
  expectedUsageRange: true,
  primaryUseCase: true,
  profileCompleted: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{
  select: typeof PROFILE_SELECT;
}>;

/** Picks the public profile fields off a full User row. */
export function toUserProfile(user: UserProfile): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
    phone: user.phone ?? null,
    companyName: user.companyName ?? null,
    jobTitle: user.jobTitle ?? null,
    country: user.country ?? null,
    companyWebsite: user.companyWebsite ?? null,
    expectedUsageRange: user.expectedUsageRange ?? null,
    primaryUseCase: user.primaryUseCase ?? null,
    profileCompleted: !!user.profileCompleted,
  };
}
