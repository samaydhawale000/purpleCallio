'use client';

import type { CustomPlanDetail } from '../../../lib/admin-billing';
import { formatCredits, formatDate, formatMoney, PURPOSE_LABEL } from '../../../lib/billing';
import { StatusBadge } from './ui';
import { formatMinutes as mins } from '../../../lib/duration';


/** Current plan, credit balance, last-30-day usage and recent payments for a custom plan request. */
export function CustomPlanSnapshot({ detail, compact }: { detail: CustomPlanDetail; compact?: boolean }) {
  const s = detail.subscription;
  const u = detail.usageLast30Days;
  const payments = compact ? detail.payments.slice(0, 3) : detail.payments;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs text-[#6B6478]">Current plan</p>
        <p className="font-medium text-[#170B2E]">
          {s.planName ?? '—'} <span className="text-xs text-[#6B6478]">({s.planType ?? '—'})</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#6B6478]">
          <StatusBadge status={s.status} />
          {s.currentPeriodEnd && <span>Period ends {formatDate(s.currentPeriodEnd)}</span>}
        </div>
      </div>
      <div>
        <p className="text-xs text-[#6B6478]">Credit balance</p>
        <p className="font-medium text-[#170B2E]">{formatCredits(detail.wallet.available)} available</p>
        <p className="text-xs text-[#6B6478]">
          {formatCredits(detail.wallet.used)} used of {formatCredits(detail.wallet.granted)} this period
        </p>
      </div>
      <div>
        <p className="text-xs text-[#6B6478]">Usage (last 30 days)</p>
        <p className="text-[#170B2E]">
          {formatCredits(u.credits)} credits · {u.calls} calls
        </p>
        <p className="text-xs text-[#6B6478]">
          {mins(u.audioMinutes)} audio · {mins(u.videoMinutes)} video · {mins(u.screenShareMinutes)} screen-share participant time
        </p>
      </div>
      <div>
        <p className="text-xs text-[#6B6478] mb-1">Payments</p>
        {payments.length === 0 ? (
          <p className="text-xs text-[#6B6478]">No payments yet.</p>
        ) : (
          <ul className="space-y-1">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 text-xs">
                <span className="text-[#6B6478] truncate">
                  {formatDate(p.paidAt ?? p.createdAt)} · {PURPOSE_LABEL[p.purpose] ?? p.purpose}
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[#170B2E]">
                  {formatMoney(p.amount)} <StatusBadge status={p.paymentStatus} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
