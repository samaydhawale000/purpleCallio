'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
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
    <div className={`relative w-full transition-[max-width] duration-300 ${wide ? 'max-w-lg' : 'max-w-sm'}`}>
      {/* Mobile brand */}
      <div className={`text-center lg:hidden ${wide ? 'mb-5' : 'mb-8'}`}>
        <Link href="/" className="inline-flex">
          <Image src={logo} alt="PurpleCallio" width={176} height={42} className="h-auto w-44 object-contain" />
        </Link>
        {!wide && <p className="text-[#3D3650] text-sm mt-1">Communication Infrastructure</p>}
      </div>

      <div
        className={`rounded-2xl border border-[#E7DFF5] ${wide ? 'p-5 sm:p-8' : 'p-8'}`}
        style={{ background: '#FFFFFF', boxShadow: '0 24px 60px rgba(127,64,232,0.1)' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'profile' && user ? (
            <motion.div key="profile" {...fade}>
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
            </motion.div>
          ) : phase === 'signin' ? (
            <motion.div key="signin" {...fade}>
              <div className="flex flex-col items-center gap-2 text-center mb-6">
                <Image src={logo} alt="PurpleCallio" width={176} height={42} className="mb-2 h-auto w-40 object-contain" />
                <h2 className="text-lg font-bold text-[#170B2E]">{title}</h2>
                <p className="text-sm text-[#3D3650]">{subtitle}</p>
              </div>

              <div className="flex flex-col gap-3">
                <GoogleSignInButton />

                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1" style={{ height: '1px', background: '#E7DFF5' }} />
                  <span className="text-xs text-[#3D3650] uppercase tracking-widest">or</span>
                  <div className="flex-1" style={{ height: '1px', background: '#E7DFF5' }} />
                </div>

                {footer}
              </div>
            </motion.div>
          ) : phase === 'error' ? (
            <motion.div key="error" {...fade} className="flex flex-col items-center gap-3 py-6 text-center">
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
            </motion.div>
          ) : (
            <motion.div key="loading" {...fade} className="flex items-center justify-center py-12" role="status">
              <Loader2 className="animate-spin h-6 w-6 text-[#7F40E8]" />
              <span className="sr-only">Loading</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!wide && legal}
    </div>
  );
}
