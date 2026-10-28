'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api';
import { formatMinutes } from '../lib/duration';
import { getCreditSummary } from '../lib/billing';
import {
  Block,
  Empty,
  LineChart,
  PageHeader,
  Panel,
  Pill,
  Section,
  Segmented,
  Stat,
  Table,
  TextLink,
  buttonCls,
  fmtDate,
  fmtDateTime,
  fmtDay,
  fmtNumber,
  useResource,
} from './_ui';
import { getDailyUsage, sumBy } from './_ui/usage-data';
import { callDuration, callStatus, callTypeLabel, type CallRow } from './calls/call-format';

export default function HomePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const firstName = (user?.name || '').split(' ')[0];
  const [days, setDays] = useState(30);

  const wallet = useResource(getCreditSummary);
  const daily = useResource(() => getDailyUsage(days), [days]);
  const calls = useResource(() =>
    api.get<{ data: CallRow[]; total: number }>('/dashboard/calls').then((r) => r.data),
  );

  const nextExpiry = wallet.data?.buckets
    ?.filter((b) => b.remaining > 0 && b.expiresAt)
    .sort((a, b) => +new Date(a.expiresAt!) - +new Date(b.expiresAt!))[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Home'}
        description="Your balance, usage and latest calls."
      />

      <div className="mb-10 grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <Block res={wallet}>
            {(w) => (
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <Stat
                    label="Credit balance"
                    value={fmtNumber(w.available)}
                    unit="credits"
                    tone={w.available <= 0 ? 'danger' : undefined}
                    hint={
                      w.available <= 0
                        ? 'New calls are paused until you add credits.'
                        : nextExpiry
                          ? `${fmtNumber(nextExpiry.remaining)} credits expire on ${fmtDate(nextExpiry.expiresAt)}`
                          : undefined
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Link href="/dashboard/billing?add=1" className={buttonCls('primary')}>
                    Add credits
                  </Link>
                  <Link href="/dashboard/billing" className={buttonCls('secondary')}>
                    Billing
                  </Link>
                </div>
              </div>
            )}
          </Block>
        </Panel>
        <Panel>
          <Block res={daily}>
            {(rows) => (
              <div className="grid grid-cols-2 gap-4">
                <Stat label={`Credits used · ${days}d`} value={fmtNumber(sumBy(rows, (r) => r.totalCredits))} />
                <Stat label={`Call time · ${days}d`} value={formatMinutes(sumBy(rows, (r) => r.callMinutes))} />
              </div>
            )}
          </Block>
        </Panel>
      </div>

      <Section
        title="Call minutes"
        description="Participant minutes billed per day."
        actions={
          <Segmented<number>
            label="Range"
            value={days}
            onChange={setDays}
            options={[
              { value: 7, label: '7d' },
              { value: 30, label: '30d' },
            ]}
          />
        }
      >
        <Panel>
          <Block res={daily}>
            {(rows) => (
              <LineChart
                ariaLabel="Call minutes per day"
                data={rows.map((r) => ({ label: fmtDay(r.date), minutes: r.callMinutes }))}
                series={[{ key: 'minutes', label: 'Call minutes', color: '#7F40E8' }]}
                format={(n) => formatMinutes(n)}
              />
            )}
          </Block>
        </Panel>
      </Section>

      <Section title="Recent calls" actions={<TextLink href="/dashboard/calls">View all</TextLink>}>
        <Block res={calls}>
          {(res) => (
            <Table
              rows={res.data.slice(0, 5)}
              rowKey={(c) => c.id}
              onRowClick={(c) => router.push(`/dashboard/calls?call=${c.id}`)}
              empty={
                <Empty
                  title="No calls yet"
                  body="Create a project and an API key, then start your first call from your app."
                  action={
                    <Link href="/dashboard/projects" className={buttonCls('primary')}>
                      Go to projects
                    </Link>
                  }
                />
              }
              columns={[
                { key: 'time', label: 'Started', render: (c) => fmtDateTime(c.createdAt) },
                { key: 'type', label: 'Type', render: (c) => callTypeLabel(c.type) },
                {
                  key: 'status',
                  label: 'Status',
                  render: (c) => <Pill tone={callStatus(c.status).tone}>{callStatus(c.status).label}</Pill>,
                },
                { key: 'project', label: 'Project', render: (c) => c.project?.name ?? '—' },
                { key: 'duration', label: 'Duration', align: 'right', render: (c) => callDuration(c) },
              ]}
            />
          )}
        </Block>
      </Section>
    </>
  );
}
