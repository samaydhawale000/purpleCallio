'use client';

import Link from 'next/link';
import { AuthCard } from '../components/auth/AuthCard';
import { AuthShell } from '../components/auth/AuthShell';

export default function SignupPage() {
  return (
    <AuthShell
      headline="Start building today."
      accent="Free to get started."
      description="Create your account and add real-time voice, video, AI agents and live translation to your product."
    >
      <AuthCard
        mode="signup"
        title="Create your account"
        subtitle="Get started free — no credit card required."
        footer={
          <p className="text-center text-sm text-[#625d81]">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-[#7133ee] hover:text-[#5620c9]">
              Sign in
            </Link>
          </p>
        }
        legal={
          <p className="mt-6 text-center text-xs text-[#77708f]">
            By creating an account, you agree to our{' '}
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
