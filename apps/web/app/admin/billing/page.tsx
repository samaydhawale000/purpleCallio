'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IndianRupee,
  Loader2,
  PhoneCall,
  Receipt,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { api } from '../../lib/api';

interface UsageSummary {
  since: string;
  usage: {
    audioMinutes: number;
    videoMinutes: number;
    screenShareMinutes: number;
    participants: number;
    estimatedCostPaise: number;
    callsCompleted: number;
    activeAccounts: number;
  };
  lineItems: {
    audioMinutes: number;
    videoMinutes: number;
    screenShareMinutes: number;
    participants: number;
    costPaise: number;
    calls: number;
  };
  rates: {
    audioPaise: number;
    videoPaise: number;
    screenSharePaise: number;
    freeAudioMins: number;
    freeVideoMins: number;
    taxPercent: number;
  };
  currency: string;
}

interface Rates {
  audioPaise: number;
  videoPaise: number;
  screenSharePaise: number;
  freeAudioMins: number;
  freeVideoMins: number;
  taxPercent: number;
}

interface SegmentAnalytics {
  since: string;
  segmentCount: number;
  totals: {
    audioMins: number;
    videoMins: number;
    screenShareMins: number;
    costPaise: number;
    calls: number;
  };
}

const paiseToINR = (paise: number) =>
  `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function AdminBillingPage() {
  const { token, logout } = useAuthStore();
  const router = useRouter();
  const { isReady } = useRequireAuth();

const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [segAnalytics, setSegAnalytics] = useState<SegmentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [sum, rt, segs] = await Promise.all([
        api.get('/billing/admin/usage-summary'),
        api.get('/billing/admin/rates'),
        api.get('/billing/admin/segment-analytics'),
      ]);
      setSummary(sum.data);
      setRates(rt.data);
      setSegAnalytics(segs.data);
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        logout();
        router.push('/');
      }
    } finally {
      setLoading(false);
    }
  }, [logout, router]);

  useEffect(() => {
    if (!isReady) return;
    if (!token) { router.push('/'); return; }
    fetchAll();
  }, [isReady, token, fetchAll, router]);

  const updateRate = (key: keyof Rates, value: number) => {
    setRates((r) => (r ? { ...r, [key]: value } : r));
  };

  const saveRates = async () => {
    if (!rates) return;
    setSaving(true);
    try {
      await api.post('/billing/admin/rates', rates);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      fetchAll();
    } catch (e) {
      window.alert('Failed to save rates');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin h-6 w-6 text-[#7F40E8]" />
      </div>
    );
  }

  const usage = summary?.usage;

  const statCards = [
    { icon: IndianRupee, label: 'Est. billable this cycle', value: paiseToINR(usage?.estimatedCostPaise ?? 0), color: '#34D399' },
    { icon: PhoneCall, label: 'Calls completed', value: usage?.callsCompleted ?? 0, color: '#6425C4' },
    { icon: Users, label: 'Participants', value: usage?.participants ?? 0, color: '#FBBF24' },
    { icon: TrendingUp, label: 'Active accounts', value: usage?.activeAccounts ?? 0, color: '#60A5FA' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#170B2E]">Billing &amp; Revenue</h1>
        <p className="text-sm text-[#3D3650] mt-1">
          Usage-based revenue, platform usage, and edit your billing rates.
        </p>
      </div>

      {/* Revenue stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
            <div className="flex items-center gap-2 mb-2">
              <s.icon size={16} style={{ color: s.color }} />
              <p className="text-xs text-[#3D3650]">{s.label}</p>
            </div>
            <p className="text-2xl font-bold text-[#170B2E]">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Usage breakdown */}
      <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-[#170B2E]">Usage breakdown (current cycle)</p>
          <span className="text-xs text-[#3D3650]">Since {summary ? new Date(summary.since).toLocaleDateString('en-IN') : '—'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                <th className="py-2 pr-4 font-medium">Media</th>
                <th className="py-2 pr-4 font-medium">Participant-min</th>
                <th className="py-2 font-medium">Line items</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Audio', minutes: usage?.audioMinutes ?? 0, items: summary?.lineItems?.audioMinutes ?? 0 },
                { name: 'Video', minutes: usage?.videoMinutes ?? 0, items: summary?.lineItems?.videoMinutes ?? 0 },
                { name: 'Screen share', minutes: usage?.screenShareMinutes ?? 0, items: summary?.lineItems?.screenShareMinutes ?? 0 },
              ].map((row) => (
                <tr key={row.name} className="border-b border-[#E7DFF5]/60 last:border-0">
                  <td className="py-3 pr-4 font-medium text-[#170B2E]">{row.name}</td>
                  <td className="py-3 pr-4 text-[#3D3650]">{Math.round(row.minutes).toLocaleString('en-IN')} participant-min</td>
                  <td className="py-3 text-[#3D3650]">{Math.round(row.items).toLocaleString('en-IN')} participant-min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

{/* Segment analytics */}
      <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-[#170B2E]">Segment analytics</p>
            <p className="text-xs text-[#3D3650] mt-0.5">
              Per-participant-minute media segments rated this cycle.
            </p>
          </div>
          <span className="text-xs text-[#3D3650]">
            {segAnalytics?.segmentCount ?? 0} segments
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SegStat label="Audio min" value={`${Math.round(segAnalytics?.totals.audioMins ?? 0)} min`} color="#7F40E8" />
          <SegStat label="Video min" value={`${Math.round(segAnalytics?.totals.videoMins ?? 0)} min`} color="#A05DF9" />
          <SegStat label="Screen-share min" value={`${Math.round(segAnalytics?.totals.screenShareMins ?? 0)} min`} color="#34D399" />
          <SegStat label="Rated revenue" value={paiseToINR(segAnalytics?.totals.costPaise ?? 0)} color="#FBBF24" />
        </div>
        <p className="text-xs text-[#3D3650] mt-3">
          Across {segAnalytics?.totals.calls ?? 0} calls since{' '}
          {segAnalytics?.since ? new Date(segAnalytics.since).toLocaleDateString('en-IN') : '—'}.
          Segment-based rating reflects actual media state (audio / video / screen) per
          participant-minute rather than a whole-call approximation.
        </p>
      </div>

      {/* Editable rates */}
      <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-[#170B2E]">Billing rates</p>
          <span className="text-xs text-[#3D3650]">Applied to new usage immediately</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <RateField label="Audio (paise/min)" value={rates?.audioPaise ?? 0} onChange={(v) => updateRate('audioPaise', v)} suffix="paise" />
          <RateField label="Video (paise/min)" value={rates?.videoPaise ?? 0} onChange={(v) => updateRate('videoPaise', v)} suffix="paise" />
          <RateField label="Screen share (paise/min)" value={rates?.screenSharePaise ?? 0} onChange={(v) => updateRate('screenSharePaise', v)} suffix="paise" />
          <RateField label="Free audio mins/month" value={rates?.freeAudioMins ?? 0} onChange={(v) => updateRate('freeAudioMins', v)} suffix="min" />
          <RateField label="Free video mins/month" value={rates?.freeVideoMins ?? 0} onChange={(v) => updateRate('freeVideoMins', v)} suffix="min" />
          <RateField label="GST (%)" value={rates?.taxPercent ?? 0} onChange={(v) => updateRate('taxPercent', v)} suffix="%" />
        </div>
        <button
          onClick={saveRates}
          disabled={saving}
          className="mt-5 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save rates'}
        </button>
      </div>

      {/* Recent line items note */}
      <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={16} className="text-[#7F40E8]" />
          <p className="text-sm font-semibold text-[#170B2E]">Invoicing</p>
        </div>
        <p className="text-xs text-[#3D3650] leading-relaxed">
          Invoices are generated automatically on the 1st of each month for the
          previous cycle's billable usage, then charged to the customer's saved
          card. Failed payments enter a 7-day grace period before new-call
          access is suspended (active calls are never interrupted).
        </p>
      </div>
    </div>
  );
}

function RateField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-[#3D3650]">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          value={value}
          min={0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-full rounded-lg border border-[#E7DFF5] bg-[#FFFFFF] px-3 py-2 text-sm text-[#170B2E] focus:border-[#7F40E8] outline-none"
        />
<span className="text-xs text-[#3D3650] whitespace-nowrap">{suffix}</span>
      </div>
    </label>
  );
}

function SegStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-[#E7DFF5] p-4" style={{ background: '#F8F4FD' }}>
      <p className="text-[11px] text-[#3D3650] mb-1" style={{ borderLeft: `2px solid ${color}`, paddingLeft: 8 }}>
        {label}
      </p>
      <p className="text-lg font-bold text-[#170B2E]">{value}</p>
    </div>
  );
}
