'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { TranslationUsageBreakdown, fmtNumber, getTranslationUsage } from '../../../lib/translation';

/**
 * CostGuard breakdown on the Usage page: call minutes vs captions vs voice
 * translation vs AI agent minutes vs report credits. Renders nothing when the
 * server has no Live Translate usage endpoint (feature off) or on error, so the
 * rest of the Usage page is unaffected.
 */
export function TranslationUsageSection() {
  const [data, setData] = useState<TranslationUsageBreakdown | null>(null);

  useEffect(() => {
    let alive = true;
    getTranslationUsage()
      .then((d) => alive && d && typeof d === 'object' && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;

  const rows = [
    { key: 'call', label: 'Call minutes', unit: 'min', amount: data.callMinutes?.minutes, credits: data.callMinutes?.credits ?? 0, color: '#7F40E8' },
    { key: 'captions', label: 'Translated captions', unit: 'min', amount: data.captions?.minutes, credits: data.captions?.credits ?? 0, color: '#A05DF9' },
    { key: 'voice', label: 'Voice translation', unit: 'min', amount: data.voice?.minutes, credits: data.voice?.credits ?? 0, color: '#410686' },
    { key: 'ai', label: 'AI agent minutes', unit: 'min', amount: data.aiAgent?.minutes, credits: data.aiAgent?.credits ?? 0, color: '#34D399' },
    { key: 'reports', label: 'Post-call reports', unit: data.reports?.count === 1 ? 'report' : 'reports', amount: data.reports?.count, credits: data.reports?.credits ?? 0, color: '#F59E0B' },
  ];
  const total = data.totalCredits ?? rows.reduce((s, r) => s + r.credits, 0);

  return (
    <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }} data-testid="costguard-breakdown">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <p className="text-sm font-semibold text-[#170B2E]">Where credits went</p>
          <p className="text-xs text-[#3D3650] mt-0.5">
            CostGuard breakdown for this period · {fmtNumber(total)} credits in total
          </p>
        </div>
        <Link href="/dashboard/translation/settings" className="inline-flex items-center gap-1 text-xs font-medium text-[#6425C4] hover:text-[#170B2E]">
          Translation budgets <ArrowUpRight size={14} />
        </Link>
      </div>
      {total > 0 && (
        <div className="flex h-2.5 rounded-full overflow-hidden bg-[#F0E9FA] mb-4" role="img" aria-label="Share of credits by usage type">
          {rows.map((r) => (r.credits > 0 ? <div key={r.key} style={{ width: `${(r.credits / total) * 100}%`, background: r.color }} /> : null))}
        </div>
      )}
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {rows.map((r) => (
          <li key={r.key} className="rounded-xl border border-[#E7DFF5] px-4 py-3" data-testid={`breakdown-${r.key}`}>
            <p className="flex items-center gap-1.5 text-xs text-[#3D3650]">
              <span className="w-2 h-2 rounded-full" style={{ background: r.color }} aria-hidden="true" />
              {r.label}
            </p>
            <p className="text-lg font-bold text-[#170B2E] tabular-nums mt-1">{fmtNumber(r.credits)} credits</p>
            <p className="text-xs text-[#3D3650]">
              {fmtNumber(r.amount ?? 0, 1)} {r.unit}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
