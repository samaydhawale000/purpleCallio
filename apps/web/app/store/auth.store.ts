import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  userId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  country?: string | null;
  companyWebsite?: string | null;
  expectedUsageRange?: string | null;
  primaryUseCase?: string | null;
  /** Backend-controlled onboarding gate; undefined only for a stale persisted session. */
  profileCompleted?: boolean;
}

/**
 * Normalizes a user from /auth/google ({ id, ... }), /auth/profile
 * ({ id, ... }) or /auth/me ({ userId, ... }) to the store shape.
 */
export function toAuthUser(u: any): AuthUser {
  return {
    userId: u.userId ?? u.id,
    email: u.email ?? null,
    name: u.name ?? null,
    avatarUrl: u.avatarUrl ?? null,
    phone: u.phone ?? null,
    companyName: u.companyName ?? null,
    jobTitle: u.jobTitle ?? null,
    country: u.country ?? null,
    companyWebsite: u.companyWebsite ?? null,
    expectedUsageRange: u.expectedUsageRange ?? null,
    primaryUseCase: u.primaryUseCase ?? null,
    profileCompleted: typeof u.profileCompleted === 'boolean' ? u.profileCompleted : undefined,
  };
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  hasHydrated: boolean;
  setTokens: (access: string, refresh: string) => void;
  setToken: (token: string) => void;
  setUser: (user: AuthUser) => void;
  setHasHydrated: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      hasHydrated: false,
      setTokens: (token, refreshToken) => set({ token, refreshToken }),
      setToken: (token) => set({ token }),
      setUser: (user) => set({ user }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      logout: () =>
        set({ token: null, refreshToken: null, user: null }),
    }),
    {
      name: 'PurpleCallio-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
