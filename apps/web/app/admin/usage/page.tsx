'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CalendarDays, Clock3, Hourglass, PhoneCall } from 'lucide-react';

type UsageData = {
  minutesToday: number;
  minutesMonth: number;
  callsToday: number;
  callsMonth: number;
  avgDuration: number;
};

export default function AdminUsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/admin/usage')
      .then((res) => setData(res.data))
      .catch((e) => setError(e?.response?.data?.message || e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-[#3D3650] text-sm py-20 text-center">Loading usage…</div>;
  }

  if (error || !data) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  const cards = [
    { label: 'Platform Minutes Today', value: data.minutesToday, icon: Clock3 },
    { label: 'Platform Minutes This Month', value: data.minutesMonth, icon: CalendarDays },
    { label: 'Calls Today', value: data.callsToday, icon: PhoneCall },
    { label: 'Calls This Month', value: data.callsMonth, icon: PhoneCall },
    { label: 'Avg Call Duration', value: `${data.avgDuration} min`, icon: Hourglass },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[#170B2E]">Usage</h1>
        <p className="text-[#3D3650] text-sm mt-1">Platform usage metrics</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#FFFFFF' }}>
            <div className="mb-2 text-[#6425C4]"><c.icon size={20} /></div>
            <div className="text-2xl font-bold text-[#170B2E]">{c.value}</div>
            <div className="text-xs text-[#3D3650] mt-1">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
