'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { CUSTOM_PLAN_STATUS_LABEL, getCustomPlan } from '../../../lib/admin-billing';
import { CustomPlanSnapshot } from '../../billing/_components/CustomPlanSnapshot';
import { ErrorText, Spinner, StatusBadge, useResource } from '../../billing/_components/ui';

export function CustomPlanBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-white bg-[#7F40E8]">
      <Sparkles size={11} /> Custom plan
    </span>
  );
}

/** Sidebar context for CUSTOM_PLAN tickets: plan, credits, usage, payments, link to the request. */
export function CustomPlanContextPanel({ requestId }: { requestId: string }) {
  const { data, loading, error } = useResource(() => getCustomPlan(requestId), [requestId]);
  return (
    <div className="rounded-xl border-2 border-[#7F40E8]/40 p-5 bg-[#F8F4FD]">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs font-mono uppercase tracking-widest text-[#6425C4]">Custom plan request</p>
        {data && <StatusBadge status={data.status} label={CUSTOM_PLAN_STATUS_LABEL[data.status]} />}
      </div>
      {loading ? (
        <Spinner tall={false} />
      ) : error || !data ? (
        <ErrorText>{error || 'Could not load the request'}</ErrorText>
      ) : (
        <>
          <CustomPlanSnapshot detail={data} compact />
          <Link
            href={`/admin/billing/custom-plans/${requestId}`}
            className="mt-4 block text-center text-sm font-medium px-3 py-2 rounded-lg text-white"
            style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
          >
            Open request &amp; create offer
          </Link>
        </>
      )}
    </div>
  );
}
