'use client';

import Link from 'next/link';
import { CUSTOM_PLAN_STATUS_LABEL, getCustomPlan } from '../../../lib/admin-billing';
import { CustomPlanSnapshot } from '../../billing/_components/CustomPlanSnapshot';
import { ErrorNote, Loading, Panel, Pill, buttonCls, useResource, type Tone } from '../../../dashboard/_ui';

const STATUS_TONE: Record<string, Tone> = {
  NEW: 'accent',
  CONTACTED: 'neutral',
  NEGOTIATING: 'warning',
  PROPOSAL_SENT: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  CLOSED: 'neutral',
};

export function CustomPlanBadge() {
  return <Pill tone="accent">Custom plan</Pill>;
}

/** Sidebar context for CUSTOM_PLAN tickets: plan, credits, usage, payments, link to the request. */
export function CustomPlanContextPanel({ requestId }: { requestId: string }) {
  const { data, loading, error } = useResource(
    () => getCustomPlan(requestId),
    [requestId],
    (e: any) => e?.response?.data?.message || e?.message || 'Could not load the request',
  );
  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#170B2E]">Custom plan request</p>
        {data && (
          <Pill tone={STATUS_TONE[data.status] ?? 'neutral'}>
            {CUSTOM_PLAN_STATUS_LABEL[data.status as keyof typeof CUSTOM_PLAN_STATUS_LABEL] ?? data.status}
          </Pill>
        )}
      </div>
      {loading && !data ? (
        <Loading className="py-4" />
      ) : error || !data ? (
        <ErrorNote message={error || 'Could not load the request'} />
      ) : (
        <>
          <CustomPlanSnapshot detail={data} compact />
          <Link href={`/admin/billing/custom-plans/${requestId}`} className={buttonCls('primary', 'mt-4 w-full')}>
            Open request &amp; create offer
          </Link>
        </>
      )}
    </Panel>
  );
}
