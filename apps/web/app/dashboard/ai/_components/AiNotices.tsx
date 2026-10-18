'use client';

import Link from 'next/link';
import { Bot, Sparkles } from 'lucide-react';
import { PLANS_HREF } from '../../../lib/ai';

/** Shown on every AI page while the account is on the Free plan. */
export function AiUpgradeCard() {
  return (
    <div
      className="rounded-2xl border border-[#D6C4EE] p-5 flex flex-wrap items-center gap-4"
      style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.08), rgba(65,6,134,0.03))' }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'rgba(127,64,232,0.12)', border: '1px solid rgba(127,64,232,0.25)' }}
      >
        <Sparkles size={20} style={{ color: '#7F40E8' }} />
      </div>
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-semibold text-[#170B2E]">AI voice agents are available on paid plans</p>
        <p className="text-xs text-[#3D3650] mt-0.5">
          Upgrade to create agents and talk to them in the playground. Existing agents stay here so you can
          disable or delete them.
        </p>
      </div>
      <Link
        href={PLANS_HREF}
        className="inline-flex items-center justify-center text-sm font-medium text-white px-4 py-2.5 rounded-lg"
        style={{ background: 'linear-gradient(135deg, #7F40E8 0%, #410686 100%)' }}
      >
        View plans
      </Link>
    </div>
  );
}

export function AiDisabledNotice() {
  return (
    <div className="rounded-2xl border border-[#E7DFF5] py-16 px-6 text-center" style={{ background: '#FFFFFF' }}>
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
        style={{ background: 'rgba(65,6,134,0.1)', border: '1px solid rgba(65,6,134,0.2)' }}
      >
        <Bot size={24} style={{ color: '#A05DF9' }} />
      </div>
      <p className="text-base font-semibold text-[#170B2E] mb-1">AI voice agents are not enabled</p>
      <p className="text-sm text-[#3D3650] max-w-sm mx-auto">This feature isn&apos;t available on your account yet.</p>
    </div>
  );
}

export function AiLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <svg className="animate-spin h-6 w-6 text-[#7F40E8]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm text-[#3D3650]">{label}</span>
      </div>
    </div>
  );
}
