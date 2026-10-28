'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, m } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { GoogleSignInButton } from '../ui/GoogleSignInButton';
import { ProfileCompletionForm } from './ProfileCompletionForm';
import { api } from '../../lib/api';
import { useAuthStore, toAuthUser, type AuthUser } from '../../store/auth.store';
import { captureBillingIntent, consumeBillingIntent } from '../../lib/billing-intent';
import logo from '../../assets/images/logo.webp';

type Phase = 'loading' | 'signin' | 'profile' | 'redirecting' | 'error';

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: 'easeOut' as const },
};

/**
 * The right-hand card on /login and /signup: Google sign-in first, then — on
 * the same page — the profile-completion step when the backend says
 * onboarding is required. Completed profiles go straight to /dashboard (or
 * to the plan chosen on the pricing page — see lib/billing-intent.ts).
 */
export function AuthCard({
  title,
  subtitle,
  footer,
  legal,
}: {
  title: string;
  subtitle: string;
  footer: ReactNode;
  legal: ReactNode;
}) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const [meError, setMeError] = useState(false);
  const [retry, setRetry] = useState(0);
  const refreshedFor = useRef<string | null>(null);

  // Remember a plan picked on the pricing page (?plan= / ?intent=custom).
  useEffect(() => {
    captureBillingIntent(window.location.search);
  }, []);

  // A session restored from storage may predate the onboarding fields (or
  // be stale), so ask the server once per session for the authoritative
  // profile state before deciding where the user belongs.
  useEffect(() => {
    if (!hasHydrated || !token) return;
    const key = `${token}:${retry}`;
    if (refreshedFor.current === key) return;
    refreshedFor.current = key;
    setMeError(false);
    api
      .get('/auth/me')
      .then((res) => {
        const next = toAuthUser(res.data);
        setUser(next);
        // A backend that doesn't report profile state can't be routed safely.
        if (typeof next.profileCompleted !== 'boolean') setMeError(true);
      })
      .catch((e) => {
        // 401 is handled by the api interceptor (logout -> sign-in state).
        if (e?.response?.status !== 401) setMeError(true);
      });
  }, [hasHydrated, token, retry, setUser]);

  let phase: Phase;
  if (!hasHydrated) phase = 'loading';
  else if (!token) phase = 'signin';
  else if (user?.profileCompleted === true) phase = 'redirecting';
  else if (user?.profileCompleted === false) phase = 'profile';
  else phase = meError ? 'error' : 'loading';

  useEffect(() => {
    if (phase === 'redirecting') router.replace(consumeBillingIntent());
  }, [phase, router]);

  const handleCompleted = (updated: AuthUser) => {
    setUser(updated);
    router.replace(consumeBillingIntent());
  };

  const signOut = () => {
    api.post('/auth/logout').catch(() => {});
    logout();
  };

  const wide = phase === 'profile';

  return (
    <div className={`relative w-full transition-[max-width] duration-300 ${wide ? 'max-w-lg' : 'max-w-md'}`}>
      {/* Mobile brand */}
      <div className={`text-center lg:hidden ${wide ? 'mb-5' : 'mb-8'}`}>
        <Link href="/" className="inline-flex">
          <Image src={logo} alt="PurpleCallio" width={176} height={42} className="h-auto w-44 object-contain" />
        </Link>
        {!wide && <p className="text-[#3D3650] text-sm mt-1">Communication Infrastructure</p>}
      </div>

      <div
        className={`rounded-2xl border border-[#EDE6F8] bg-white ${wide ? 'p-5 sm:p-8' : 'px-8 py-10 sm:px-9'}`}
        style={{ boxShadow: '0 20px 50px rgba(110,60,200,0.08)' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'profile' && user ? (
            <m.div key="profile" {...fade}>
              <ProfileCompletionForm user={user} onCompleted={handleCompleted} />
              <p className="text-center text-xs text-[#3D3650] mt-4">
                Signed in as {user.email}.{' '}
                <button
                  type="button"
                  onClick={signOut}
                  className="font-medium text-[#7F40E8] hover:text-[#6425C4] transition-colors"
                >
                  Use a different account
                </button>
              </p>
            </m.div>
          ) : phase === 'signin' ? (
            <m.div key="signin" {...fade}>
              <div className="mb-8 flex flex-col items-center text-center">
                <Image src={logo} alt="PurpleCallio" width={176} height={42} className="mb-6 h-auto w-48 object-contain" />
                <h2 className="text-[28px] font-bold tracking-tight text-[#170B2E]">{title}</h2>
                <p className="mt-2 text-sm text-[#6B6478]">{subtitle}</p>
              </div>

              <div className="flex flex-col gap-5">
                <GoogleSignInButton />

                <div className="flex items-center gap-3 my-1">
                  <div className="h-px flex-1 bg-[#ECE6F6]" />
                  <span className="text-xs uppercase tracking-widest text-[#9C95A8]">or</span>
                  <div className="h-px flex-1 bg-[#ECE6F6]" />
                </div>

                {footer}
              </div>
            </m.div>
          ) : phase === 'error' ? (
            <m.div key="error" {...fade} className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-[#3D3650]">We couldn&apos;t load your account. Please try again.</p>
              <div className="flex gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => setRetry((n) => n + 1)}
                  className="font-medium text-[#7F40E8] hover:text-[#6425C4]"
                >
                  Try again
                </button>
                <button type="button" onClick={signOut} className="text-[#3D3650] hover:text-[#170B2E]">
                  Sign out
                </button>
              </div>
            </m.div>
          ) : (
            <m.div key="loading" {...fade} className="flex items-center justify-center py-12" role="status">
              <Loader2 className="animate-spin h-6 w-6 text-[#7F40E8]" />
              <span className="sr-only">Loading</span>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {!wide && legal}
    </div>
  );
}
