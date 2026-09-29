'use client';

import Link from 'next/link';
import { Blocks, Monitor, Atom } from 'lucide-react';
import { AuthCard } from '../components/auth/AuthCard';

const ARCHITECTURE = [
  {
    icon: Monitor,
    label: 'Hosted UI',
    desc: 'Ready-made meeting pages',
  },
  {
    icon: Atom,
    label: 'React Components',
    desc: 'Custom UI, zero WebRTC',
  },
  {
    icon: Blocks,
    label: 'Headless SDK',
    desc: 'Full control over calls',
  },
];

const TRUST_POINTS = [
  'Secure authentication',
  'Built for developers',
  'Transparent, predictable billing',
];

export default function LoginPage() {
  return (
    <div className="min-h-screen" style={{ background: '#FFFFFF' }}>
      <div className="min-h-screen grid lg:grid-cols-2">
        {/* ── Left: Branding / Architecture ── */}
        <div
          className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 20% 20%, rgba(127,64,232,0.25), transparent), radial-gradient(ellipse 60% 50% at 80% 80%, rgba(160,93,249,0.15), transparent), linear-gradient(180deg, #2B0F52 0%, #1A0B33 100%)',
          }}
        >
          {/* Subtle grid overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />

          {/* Middle: headline + architecture */}
          <div className="relative">
            <h1 className="text-4xl font-bold text-white leading-tight mb-3">
              One Backend.
              <br />
              <span
                style={{
                  background: 'linear-gradient(135deg, #C9A6F5, #FFFFFF)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Three Integration Modes.
              </span>
            </h1>
            <p className="text-slate-200 text-lg mb-10 max-w-md">
              Embed real-time voice and video into your product with a single
              REST + WebSocket backend.
            </p>

            {/* Architecture illustration */}
            <div
              className="rounded-2xl p-6 max-w-md"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <p className="text-xs font-mono uppercase tracking-widest text-white/80 mb-5">
                Architecture
              </p>
              <div className="flex flex-col gap-3">
                {ARCHITECTURE.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 rounded-xl px-4 py-3"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{
                        background: 'rgba(255,255,255,0.12)',
                        border: '1px solid rgba(255,255,255,0.2)',
                      }}
                    >
                    <item.icon size={18} strokeWidth={1.8} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <p className="text-xs text-white/80">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom: trust */}
          <div className="relative flex flex-wrap gap-2">
            {TRUST_POINTS.map((point) => (
              <span
                key={point}
                className="inline-flex items-center gap-1.5 text-xs text-white/90 px-3 py-1.5 rounded-full border border-white/15"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
                {point}
              </span>
            ))}
          </div>
        </div>

        {/* ── Right: Login card ── */}
        <div
          className="relative flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16"
          style={{ background: '#FFFFFF' }}
        >
          {/* Glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 50% 40% at 50% 20%, rgba(127,64,232,0.06), transparent)',
            }}
          />

          <AuthCard
            title="Welcome back"
            subtitle="Sign in to access your PurpleCallio dashboard."
            footer={
              <p className="text-center text-xs text-[#3D3650]">
                No passwords. No setup.{' '}
                <Link
                  href="/signup"
                  className="font-medium text-[#7F40E8] hover:text-[#6425C4] transition-colors"
                >
                  Create an account
                </Link>
              </p>
            }
            legal={
              <p className="text-center text-xs text-[#3D3650] mt-6">
                By continuing you agree to our{' '}
                <Link href="/terms" className="hover:text-[#170B2E] transition-colors">
                  Terms
                </Link>{' '}
                &amp;{' '}
                <Link href="/privacy" className="hover:text-[#170B2E] transition-colors">
                  Privacy Policy
                </Link>
                .
              </p>
            }
          />
        </div>
      </div>
    </div>
  );
}
