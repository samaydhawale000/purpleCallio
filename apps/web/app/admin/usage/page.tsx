'use client';

import { api } from '../../lib/api';
import { useAdminAccess } from '../../lib/admin-access';
import { AiUsagePanel } from '../billing/_components/AiUsagePanel';
import { Block, PageHeader, Panel, Section, Stat, fmtNumber, useResource } from '../../dashboard/_ui';

type UsageData = {
  minutesToday: number;
  minutesMonth: number;
  callsToday: number;
  callsMonth: number;
  avgDuration: number;
};

export default function AdminUsagePage() {
  const usage = useResource(
    () => api.get<UsageData>('/admin/usage').then((r) => r.data),
    [],
    (e: any) => e?.response?.data?.message || e?.message || 'Failed to load',
  );
  // The AI report is a billing endpoint; a 403 there would sign the admin out.
  const canSeeBilling = useAdminAccess('billing').canRead;

  return (
    <>
      <PageHeader title="Usage" description="Platform usage metrics" />

      <Section title="Calls">
        <Block res={usage} loadingLabel="Loading usage…">
          {(d) => (
            <Panel>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 lg:grid-cols-5">
                <Stat label="Calls today" value={fmtNumber(d.callsToday)} />
                <Stat label="Calls this month" value={fmtNumber(d.callsMonth)} />
                <Stat label="Platform minutes today" value={fmtNumber(d.minutesToday)} />
                <Stat label="Platform minutes this month" value={fmtNumber(d.minutesMonth)} />
                <Stat label="Avg call duration" value={d.avgDuration} unit="min" />
              </div>
            </Panel>
          )}
        </Block>
      </Section>

      {canSeeBilling && <AiUsagePanel />}
    </>
  );
}
