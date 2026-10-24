'use client';

import { CreditCard, Gauge, PlusCircle, Sparkles } from 'lucide-react';

const STEPS = [
  { icon: CreditCard, title: 'Choose an amount', body: 'Select the amount of credits to buy.' },
  { icon: Sparkles, title: 'Credits are added', body: 'Credits land in your balance after payment is confirmed.' },
  { icon: Gauge, title: 'Usage consumes credits', body: 'Calls use credits per participant-minute of audio, video and screen share.' },
  { icon: PlusCircle, title: 'Top up when needed', body: 'Buy more credits whenever your wallet needs them.' },
];

/** Compact "How prepaid billing works" explainer for the billing overview. */
export default function PrepaidExplainer() {
  return (
    <section className="rounded-2xl border border-[#E7DFF5] bg-white p-6" aria-labelledby="prepaid-explainer">
      <h2 id="prepaid-explainer" className="text-sm font-semibold text-[#170B2E]">How prepaid billing works</h2>
      <p className="text-xs text-[#3D3650] mt-0.5">No surprise usage bills — you always know what you pay.</p>
      <ol className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-[#E7DFF5] p-3" style={{ background: '#F8F4FD' }}>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}>
                {i + 1}
              </span>
              <s.icon size={14} className="text-[#6425C4]" />
            </div>
            <p className="text-xs font-semibold text-[#170B2E] mt-2">{s.title}</p>
            <p className="text-[11px] text-[#3D3650] mt-0.5">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
