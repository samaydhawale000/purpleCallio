'use client';

import type { CustomPlanDetail } from '../../../lib/admin-billing';
import { formatCredits, formatDate, formatMoney, PURPOSE_LABEL } from '../../../lib/billing';
import { StatusBadge } from './ui';

const mins = (n: number) => `${Math.round(n ?? 0).toLocaleString('en-IN')}`;

/** Current plan, credit balance, last-30-day usage and recent payments for a custom plan request. */
export function CustomPlanSnapshot({ detail, compact }: { detail: CustomPlanDetail; compact?: boolean }) {
  const s = detail.subscription;
  const u = detail.usageLast30Days;
  const payments = compact ? detail.payments.slice(0, 3) : detail.payments;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs text-[#3D3650]">Current plan</p>
        <p className="font-medium text-[#170B2E]">
          {s.planName ?? '—'} <span className="text-xs text-[#3D3650]">({s.planType ?? '—'})</span>
        </p>
        <p className="text-xs text-[#3D3650]">
          <StatusBadge status={s.status} />{' '}
          {s.currentPeriodEnd && <>Period ends {formatDate(s.currentPeriodEnd)}</>}
        </p>
      </div>
      <div>
        <p className="text-xs text-[#3D3650]">Credit balance</p>
        <p className="font-medium text-[#170B2E]">{formatCredits(detail.wallet.available)} available</p>
        <p className="text-xs text-[#3D3650]">
          {formatCredits(detail.wallet.used)} used of {formatCredits(detail.wallet.granted)} this period
        </p>
      </div>
      <div>
        <p className="text-xs text-[#3D3650]">Usage (last 30 days)</p>
        <p className="text-[#170B2E]">
          {formatCredits(u.credits)} credits · {u.calls} calls
        </p>
        <p className="text-xs text-[#3D3650]">
          {mins(u.audioMinutes)} audio · {mins(u.videoMinutes)} video · {mins(u.screenShareMinutes)} screen-share participant-min
        </p>
      </div>
      <div>
        <p className="text-xs text-[#3D3650] mb-1">Payments</p>
        {payments.length === 0 ? (
          <p className="text-xs text-[#6B6478]">No payments yet.</p>
        ) : (
          <ul className="space-y-1">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 text-xs">
                <span className="text-[#3D3650] truncate">
                  {formatDate(p.paidAt ?? p.createdAt)} · {PURPOSE_LABEL[p.purpose] ?? p.purpose}
                </span>
                <span className="text-[#170B2E] whitespace-nowrap">
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
