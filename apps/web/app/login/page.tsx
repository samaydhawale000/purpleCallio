'use client';

import Link from 'next/link';
import { AuthCard } from '../components/auth/AuthCard';
import { AuthShell } from '../components/auth/AuthShell';

export default function LoginPage() {
  return (
    <AuthShell
      headline="Every conversation."
      accent="One platform."
      description="Real-time voice, video, AI agents and live translation — built for your product."
    >
      <AuthCard
        mode="login"
        title="Welcome back"
        subtitle="Sign in to continue to your workspace."
        footer={
          <p className="text-center text-sm text-[#625d81]">
            New to PurpleCallio?{' '}
            <Link href="/signup" className="font-semibold text-[#7133ee] hover:text-[#5620c9]">
              Create an account
            </Link>
          </p>
        }
        legal={
          <p className="mt-6 text-center text-xs text-[#77708f]">
            By continuing, you agree to our{' '}
            <Link href="/terms" className="font-medium text-[#6425C4]">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="font-medium text-[#6425C4]">
              Privacy Policy
            </Link>
            .
          </p>
        }
      />
    </AuthShell>
  );
}
