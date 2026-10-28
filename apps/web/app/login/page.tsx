'use client';

import Link from 'next/link';
import { Code2, Languages, Layers3, ShieldCheck, Sparkles, Video } from 'lucide-react';
import { AuthCard } from '../components/auth/AuthCard';

const capabilities = [
  { icon: Video, title: 'Voice & Video', copy: 'Reliable real-time conversations' },
  { icon: Languages, title: 'Live Translate', copy: 'Speak naturally across languages' },
  { icon: Sparkles, title: 'AI Voice Agents', copy: 'Automate conversations intelligently' },
  { icon: Code2, title: 'Developer APIs', copy: 'REST + WebSocket integration' },
];

const badges = [
  { icon: ShieldCheck, label: 'Secure by design' },
  { icon: Code2, label: 'Developer-first' },
  { icon: Layers3, label: 'Usage-based credits' },
];

/** Heights of the audio bars drawn over the wave crest. */
const BARS = [18, 34, 52, 74, 112, 86, 60, 38, 22];

function SoundBars({ className, color, max = 112 }: { className?: string; color: string; max?: number }) {
  const w = BARS.length * 14;
  return (
    <svg className={className} viewBox={`0 0 ${w} ${max}`} aria-hidden="true">
      {BARS.map((h, i) => {
        const height = (h / 112) * max;
        return <rect key={i} x={i * 14 + 4} y={(max - height) / 2} width={4} height={height} rx={2} fill={color} />;
      })}
    </svg>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Brand panel */}
        <section className="relative hidden overflow-hidden bg-[#14053A] px-10 py-10 text-white lg:flex lg:flex-col lg:justify-center xl:px-16">
          <div
            className="absolute inset-0 opacity-[.18]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(184,142,255,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(184,142,255,.25) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
            }}
          />
          <div className="absolute -right-24 top-10 h-80 w-[36rem] rounded-full bg-[#7727f5]/30 blur-3xl" />
          <div className="absolute -bottom-40 -left-20 h-80 w-[30rem] rounded-full bg-[#4b16ab]/30 blur-3xl" />

          {/* Wave with audio bars on its crest */}
          <svg className="absolute left-0 top-[9%] h-[26%] w-full" viewBox="0 0 900 260" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="loginWave" x1="0" x2="1">
                <stop stopColor="#3b1fd1" stopOpacity=".2" />
                <stop offset=".55" stopColor="#8f4dff" />
                <stop offset="1" stopColor="#b56bff" />
              </linearGradient>
            </defs>
            <path d="M-10 120 C120 40, 220 220, 360 140 S560 210, 640 110 S800 20, 910 140" fill="none" stroke="url(#loginWave)" strokeWidth="2" />
            <path d="M-10 150 C140 230, 250 70, 380 160 S580 60, 680 150 S820 230, 910 90" fill="none" stroke="#9f54ff" strokeOpacity=".35" strokeWidth="1.2" />
          </svg>
          <SoundBars className="absolute right-[12%] top-[14%] h-28 w-36 drop-shadow-[0_0_14px_rgba(170,110,255,.8)]" color="#b98bff" />
          <span className="absolute right-[27%] top-[11%] h-3 w-3 rounded-full bg-[#8f4dff] shadow-[0_0_16px_4px_rgba(143,77,255,.6)]" />
          <span className="absolute right-[8%] top-[31%] h-3.5 w-3.5 rounded-full bg-[#7a3cf5] shadow-[0_0_18px_4px_rgba(122,60,245,.55)]" />

          <div className="relative z-10 mx-auto w-full max-w-2xl pt-28">
            <p className="mb-4 font-mono text-xs tracking-[.22em] text-[#c5a1ff]">VOICE • VIDEO • AI • TRANSLATION</p>
            <h1 className="text-4xl font-bold leading-[1.12] tracking-tight xl:text-5xl">
              Every conversation.
              <br />
              <span className="text-[#c4a2ff]">One platform.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-7 text-[#eee8ff]">
              Real-time voice, video, AI agents and live translation — built for your product.
            </p>

            <div className="mt-9 grid grid-cols-2 gap-4">
              {capabilities.map(({ icon: Icon, title, copy }) => (
                <article
                  key={title}
                  className="flex items-start gap-4 rounded-2xl border border-[#7d4fd0]/40 bg-[#3a157a]/35 p-5 backdrop-blur-sm"
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#6b34e0] shadow-[0_6px_20px_rgba(107,52,224,.45)]">
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0">
                    <b className="block text-[15px]">{title}</b>
                    <span className="mt-1.5 block text-sm leading-5 text-[#ded0fb]">{copy}</span>
                  </span>
                </article>
              ))}
            </div>
          </div>

          <div className="relative z-10 mx-auto mt-10 flex w-full max-w-2xl flex-wrap gap-3 text-[13px] text-[#eadfff]">
            {badges.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-2 rounded-full border border-[#6f45c0] px-4 py-2">
                <Icon size={15} /> {label}
              </span>
            ))}
          </div>
        </section>

        {/* Sign-in */}
        <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#FBF9FF] px-5 py-12 sm:px-10">
          <svg className="absolute -bottom-10 right-0 h-64 w-[34rem] text-[#EFE6FF]" viewBox="0 0 540 260" aria-hidden="true">
            <path d="M540 20 C430 60, 360 200, 200 230 S40 250, 0 260 L540 260 Z" fill="currentColor" />
            <path d="M540 90 C450 120, 400 230, 260 250 L540 260 Z" fill="#E7DAFF" opacity=".6" />
          </svg>
          <div className="absolute -top-24 right-0 h-72 w-72 rounded-full bg-[#F1E9FF] blur-2xl" />
          <span className="absolute right-[6%] top-[8%] h-8 w-8 rounded-full bg-[#E4D3FF]" />
          <SoundBars className="absolute right-[5%] top-[14%] h-14 w-24 opacity-70" color="#C9A8FF" max={60} />
          <span className="absolute bottom-[14%] right-[9%] h-6 w-6 rounded-full bg-[#E4D3FF]" />
          <span className="absolute bottom-[10%] right-[14%] h-3 w-3 rounded-full bg-[#D9C4FF]" />

          <div className="relative z-10 flex w-full justify-center">
            <AuthCard
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
          </div>
        </section>
      </div>
    </main>
  );
}
