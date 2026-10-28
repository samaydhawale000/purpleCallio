'use client';

import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { formatMinutes } from '../lib/duration';
import {
  Block,
  LineChart,
  PageHeader,
  Panel,
  Section,
  Stat,
  TextLink,
  fmtNumber,
  useResource,
} from '../dashboard/_ui';

type OverviewData = {
  stats: {
    totalCompanies: number;
    freeUsers: number;
    paidUsers: number;
    totalProjects: number;
    activeCalls: number;
    activeParticipants: number;
    minutesToday: number;
    minutesMonth: number;
    participantMinutesMonth: number;
    creditsConsumedMonth: number;
    revenueMonthPaise: number;
  };
  charts: {
    calls: { label: string; value: number }[];
    minutes: { label: string; value: number }[];
    newUsers: { label: string; value: number }[];
  };
};

const paiseToINR = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const toPoints = (rows: { label: string; value: number }[]) => rows.map((r) => ({ label: r.label, value: r.value }));

function StatGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-[#ECE8F2] pt-5 first:border-0 first:pt-0">
      <p className="mb-3 text-[13px] font-medium text-[#170B2E]">{title}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 lg:grid-cols-5">{children}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const overview = useResource(
    () => api.get<OverviewData>('/admin/overview').then((r) => r.data),
    [],
    (e: any) => e?.response?.data?.message || e?.message || 'Failed to load. Admin access required.',
  );

  return (
    <>
      <PageHeader title="Platform overview" description="Is PurpleCallio healthy right now?" />

      <Block res={overview} loadingLabel="Loading overview…">
        {({ stats: s, charts }) => (
          <>
            <Section>
              <Panel className="space-y-5">
                <StatGroup title="Right now">
                  <Stat label="Active calls" value={fmtNumber(s.activeCalls)} hint={<TextLink href="/admin/calls">View live calls</TextLink>} />
                  <Stat label="Active participants" value={fmtNumber(s.activeParticipants)} />
                  <Stat label="Call time today" value={formatMinutes(s.minutesToday)} />
                </StatGroup>
                {/* Platform minutes (wall-clock) and participant minutes (what credits are
                    consumed for) are deliberately separate. Revenue is prepaid payments
                    received this month (plans + top-ups). */}
                <StatGroup title="This month">
                  <Stat label="Platform call time" value={formatMinutes(s.minutesMonth)} />
                  <Stat label="Participant time" value={formatMinutes(s.participantMinutesMonth)} />
                  <Stat label="Credits consumed" value={fmtNumber(Math.round(s.creditsConsumedMonth ?? 0))} />
                  <Stat label="Revenue" value={paiseToINR(s.revenueMonthPaise ?? 0)} />
                </StatGroup>
                <StatGroup title="Accounts">
                  <Stat label="Companies" value={fmtNumber(s.totalCompanies)} hint={<TextLink href="/admin/customers">View customers</TextLink>} />
                  <Stat label="Paid" value={fmtNumber(s.paidUsers)} />
                  <Stat label="Free" value={fmtNumber(s.freeUsers)} />
                  <Stat label="Projects" value={fmtNumber(s.totalProjects)} />
                </StatGroup>
              </Panel>
            </Section>

            <div className="grid gap-x-6 lg:grid-cols-2">
              <Section title="Calls" description="Calls started per day, last 7 days.">
                <Panel>
                  <LineChart
                    ariaLabel="Calls per day, last 7 days"
                    data={toPoints(charts.calls)}
                    series={[{ key: 'value', label: 'Calls', color: '#7F40E8' }]}
                  />
                </Panel>
              </Section>
              <Section title="Platform minutes" description="Call wall-clock minutes per day, last 7 days.">
                <Panel>
                  <LineChart
                    ariaLabel="Platform minutes per day, last 7 days"
                    data={toPoints(charts.minutes)}
                    series={[{ key: 'value', label: 'Minutes', color: '#7F40E8' }]}
                    format={(n) => formatMinutes(n)}
                  />
                </Panel>
              </Section>
            </div>

            <Section title="New sign-ups" description="Accounts created per day, last 30 days.">
              <Panel>
                <LineChart
                  ariaLabel="New sign-ups per day, last 30 days"
                  data={toPoints(charts.newUsers)}
                  series={[{ key: 'value', label: 'Sign-ups', color: '#7F40E8' }]}
                />
              </Panel>
            </Section>
          </>
        )}
      </Block>
    </>
  );
}
