'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, toAuthUser } from '../store/auth.store';
import { api } from '../lib/api';

/**
 * Redirects to /login if the user is not authenticated.
 * Waits for zustand persist rehydration to complete before deciding,
 * so a hard refresh on /dashboard no longer bounces to /login.
 */
export function useRequireAuth() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const setUser = useAuthStore((s) => s.setUser);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);

useEffect(() => {
    // Wait until the persisted session has been restored from localStorage.
    if (!hasHydrated) return;

    if (!token) {
      router.replace('/login');
      return;
    }

    // Keep the user profile in sync from the server on every mount. This
    // ensures the sidebar/settings show the correct name, email and avatar
    // even after a hard reload, and repairs any stale persisted user.
    api
      .get('/auth/me')
      .then((res) => {
        if (res.data) {
          setUser(toAuthUser(res.data));
        }
      })
      .catch(() => {
        // ignore — will be handled by the auth guard on next request
      });
  }, [hasHydrated, token, setUser, router]);

  return { isAuthed: hasHydrated && !!token, isReady: hasHydrated };
}
