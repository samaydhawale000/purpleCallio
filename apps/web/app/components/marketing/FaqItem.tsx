'use client';

import { useId, useState } from 'react';

/** One collapsible FAQ card. Shared by /faq and the feature pages so every FAQ looks the same. */
export function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div
      className="rounded-xl border border-[#E7DFF5] overflow-hidden transition-all"
      style={{ background: open ? '#F3ECFB' : '#FFFFFF' }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-white/[0.02] transition-all"
      >
        <span className="text-sm font-semibold text-[#170B2E]">{q}</span>
        <span
          aria-hidden="true"
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs text-[#3D3650] transition-all"
          style={{ background: open ? 'rgba(127,64,232,0.12)' : '#F3ECFB', color: open ? '#6425C4' : '#3D3650' }}
        >
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div id={panelId} className="px-5 pb-5 border-t border-[#E7DFF5]">
          <p className="text-sm text-[#3D3650] leading-relaxed pt-4">{a}</p>
        </div>
      )}
    </div>
  );
}

/** A stack of FAQ cards. */
export function FaqList({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map(([q, a]) => (
        <FaqItem key={q} q={q} a={a} />
      ))}
    </div>
  );
}
