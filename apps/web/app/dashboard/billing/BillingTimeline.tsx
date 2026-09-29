'use client';

import { Wallet, Activity, Calculator, CalendarClock, CreditCard, Receipt, Check } from 'lucide-react';

interface Props {
  hasUsage: boolean;
  hasBillableUsage: boolean;
  hasPaymentMethod: boolean;
  nextBillingDate: string | null;
  hasInvoices: boolean;
  freeAllowance?: { audioMinutes?: number; videoMinutes?: number };
}

export default function BillingTimeline({
  hasUsage,
  hasBillableUsage,
  hasPaymentMethod,
  nextBillingDate,
  hasInvoices,
  freeAllowance,
}: Props) {
  const nextBillingLabel = nextBillingDate
    ? new Date(nextBillingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : '—';

  const steps = [
    { icon: Wallet, label: 'Free Tier', desc: `${freeAllowance?.audioMinutes ?? 500} audio + ${freeAllowance?.videoMinutes ?? 200} video mins`, done: true },
    { icon: Activity, label: 'You Use APIs', desc: 'Usage tracked live', done: hasUsage },
    { icon: Calculator, label: 'Estimated Balance', desc: 'Beyond free allowance', done: hasBillableUsage },
    { icon: CalendarClock, label: 'Month Ends', desc: nextBillingLabel, done: false },
    {
      icon: CreditCard,
      label: 'Card Charged',
      desc: hasPaymentMethod ? 'Auto billing enabled' : 'Add a card',
      done: hasPaymentMethod && hasBillableUsage,
    },
    { icon: Receipt, label: 'Invoice Generated', desc: 'See invoices below', done: hasInvoices },
  ];

  const firstPending = steps.findIndex((s) => !s.done);
  const currentIndex = firstPending === -1 ? steps.length - 1 : firstPending;

  return (
    <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
      <p className="text-sm font-semibold text-[#170B2E] mb-1">How your billing works</p>
      <p className="text-xs text-[#3D3650] mb-5">
        Usage-based billing, start to finish — this cycle.
      </p>

      <div className="overflow-x-auto">
        <div className="flex items-start gap-1 min-w-[640px]">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isCurrent = i === currentIndex && !step.done;
            return (
              <div key={step.label} className="flex items-start flex-1">
                <div className="flex flex-col items-center gap-2 w-[92px] text-center shrink-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      background: step.done
                        ? 'rgba(16,185,129,0.12)'
                        : isCurrent
                          ? 'rgba(127,64,232,0.15)'
                          : 'rgba(148,163,184,0.06)',
                      border: `1px solid ${
                        step.done ? 'rgba(16,185,129,0.35)' : isCurrent ? 'rgba(127,64,232,0.4)' : '#E7DFF5'
                      }`,
                    }}
                  >
                    {step.done ? (
                      <Check size={15} style={{ color: '#34D399' }} />
                    ) : (
                      <Icon size={15} style={{ color: isCurrent ? '#6425C4' : '#475569' }} />
                    )}
                  </div>
                  <div>
                    <p
                      className="text-[11px] font-medium leading-tight"
                      style={{ color: step.done || isCurrent ? '#E2E8F0' : '#64748B' }}
                    >
                      {step.label}
                    </p>
                    <p className="text-[10px] text-[#3D3650] leading-tight mt-0.5">{step.desc}</p>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className="h-px flex-1 mt-[18px]"
                    style={{ background: step.done ? 'rgba(16,185,129,0.3)' : '#E7DFF5' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
