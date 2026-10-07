'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, CalendarDays, Coins, ChartColumn, CircleCheck, Clock3, CreditCard, FileText, FolderKanban, HandCoins, HeartPulse, PhoneCall, Users } from 'lucide-react';
import { api } from '../lib/api';

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

// "Platform minutes" (call wall-clock duration) and "participant-minutes"
// (what credits are consumed for) are deliberately shown as separate cards.
// Revenue is prepaid payments received this month (plans + top-ups).
const STAT_CARDS = (s: OverviewData['stats']) => [
  { label: 'Total Companies', value: s.totalCompanies, icon: Building2 },
  { label: 'Free Users', value: s.freeUsers, icon: CircleCheck },
  { label: 'Paid Users', value: s.paidUsers, icon: CreditCard },
  { label: 'Total Projects', value: s.totalProjects, icon: FolderKanban },
  { label: 'Active Calls', value: s.activeCalls, icon: PhoneCall },
  { label: 'Active Participants', value: s.activeParticipants, icon: Users },
  { label: 'Platform Minutes Today', value: s.minutesToday, icon: Clock3 },
  { label: 'Platform Minutes This Month', value: s.minutesMonth, icon: CalendarDays },
  { label: 'Participant-Minutes This Month', value: Math.round(s.participantMinutesMonth), icon: ChartColumn },
  { label: 'Credits Consumed This Month', value: Math.round(s.creditsConsumedMonth ?? 0).toLocaleString('en-IN'), icon: Coins },
  { label: 'Revenue This Month', value: paiseToINR(s.revenueMonthPaise ?? 0), icon: HandCoins },
];

function BarChart({
  data,
  color = '#7F40E8',
}: {
  data: { label: string; value: number }[];
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end justify-between gap-1.5 h-44">
      {data.map((d) => (
        <div
          key={d.label}
          className="flex-1 flex flex-col items-center gap-1 h-full min-w-0"
        >
          <div className="flex-1 flex items-end w-full justify-center">
            <div
              className="w-full max-w-[28px] rounded-t"
              style={{
                height: `${Math.max(6, (d.value / max) * 100)}%`,
                background: color,
                opacity: 0.85,
              }}
            />
          </div>
          <div className="text-[10px] text-[#3D3650] truncate max-w-full text-center">
            {d.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/admin/overview')
      .then((res) => setData(res.data))
      .catch((e) => setError(e?.response?.data?.message || e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-[#3D3650] text-sm py-20 text-center">Loading overview…</div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-600 text-sm mb-3">{error}</p>
        <p className="text-[#3D3650] text-xs">Admin access required.</p>
      </div>
    );
  }

  const stats = data!.stats;
  const charts = data!.charts;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-mono uppercase tracking-widest text-[#3D3650] mb-1">
          Internal Dashboard
        </p>
        <h1 className="text-2xl font-bold text-[#170B2E]">Platform Overview</h1>
        <p className="text-[#3D3650] text-sm mt-1">
          Is PurpleCallio healthy right now?
        </p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {STAT_CARDS(stats).map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-[#E7DFF5] p-4"
            style={{ background: '#FFFFFF' }}
          >
            <div className="mb-2 text-[#6425C4]"><c.icon size={20} /></div>
            <div className="text-2xl font-bold text-[#170B2E]">{c.value}</div>
            <div className="text-xs text-[#3D3650] mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-sm font-semibold text-[#170B2E] mb-4">Calls (7d)</p>
          <BarChart data={charts.calls} color="#7F40E8" />
        </div>
        <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-sm font-semibold text-[#170B2E] mb-4">Platform Minutes (7d)</p>
          <BarChart data={charts.minutes} color="#410686" />
        </div>
        <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-sm font-semibold text-[#170B2E] mb-4">New Users (30d)</p>
          <BarChart data={charts.newUsers} color="#10B981" />
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { href: '/admin/customers', label: 'Customers', icon: Users },
          { href: '/admin/calls', label: 'Live Calls', icon: PhoneCall },
          { href: '/admin/health', label: 'System Health', icon: HeartPulse },
          { href: '/admin/audit-logs', label: 'Audit Logs', icon: FileText },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-xl border border-[#E7DFF5] p-5 text-center hover:border-[#D6C4EE] transition-all"
            style={{ background: '#FFFFFF' }}
          >
            <div className="mb-2 flex justify-center text-[#6425C4]"><l.icon size={22} /></div>
            <p className="text-sm font-medium text-[#170B2E]">{l.label}</p>
            <p className="text-xs text-[#3D3650] mt-1">View →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
