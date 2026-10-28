'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Empty, Loading, Panel, buttonCls, type Tone } from '../../_ui';

/** Shown while the account has not yet completed a credit purchase. */
export function AiUpgradeCard() {
  return (
    <Panel className="mb-6 flex flex-wrap items-center gap-4">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium text-[#170B2E]">AI voice agents unlock with prepaid credits</p>
        <p className="mt-0.5 text-[13px] text-[#6B6478]">
          Add credits to create agents and talk to them in the playground. Existing agents stay here so you can
          disable or delete them.
        </p>
      </div>
      <Link href="/dashboard/billing?add=1" className={buttonCls('primary')}>
        Add credits
      </Link>
    </Panel>
  );
}

export function AiDisabledNotice() {
  return <Empty title="AI voice agents are not enabled" body="This feature isn't available on your account yet." />;
}

export function AiLoading({ label }: { label: string }) {
  return <Loading label={label} />;
}

/** Back link at the top of the AI detail pages. */
export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-[#6B6478] hover:text-[#170B2E]">
      <ArrowLeft size={14} /> {children}
    </Link>
  );
}

/** Maps the status tones from lib/ai onto the kit's Pill tones. */
export function pillTone(tone: string): Tone {
  switch (tone) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'danger';
    case 'info':
    case 'purple':
      return 'accent';
    default:
      return 'neutral';
  }
}
