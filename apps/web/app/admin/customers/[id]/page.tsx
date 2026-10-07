'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../../store/auth.store';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { api } from '../../../lib/api';
import { countryByCode, usageRangeLabel, useCaseLabel } from '../../../lib/onboarding';

import type { CurrentUsage } from '../../../lib/billing';
import { formatCredits } from '../../../lib/billing';
import { CustomerBillingPanel } from '../../billing/_components/CustomerBillingPanel';

interface CustomerDetail {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  country: string | null;
  companyWebsite: string | null;
  expectedUsageRange: string | null;
  primaryUseCase: string | null;
  profileCompleted: boolean;
  status: string;
  createdAt: string;
  usage: CurrentUsage;
  discount: DiscountDetail;
}

interface Discount {
  id: string;
  percentage: number;
  active: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string | null;
  createdAt: string;
}

interface DiscountDetail {
  discount: Discount | null;
  appliesTo: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function AdminCustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const { token, logout } = useAuthStore();
  const router = useRouter();
  const { isReady } = useRequireAuth();

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(false);
  const [percentage, setPercentage] = useState(15);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/customers/${customerId}`);
      setCustomer(res.data);
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        logout();
        router.push('/');
        return;
      }
      setError(e?.response?.data?.message || e?.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [customerId, logout, router]);

  useEffect(() => {
    if (!isReady) return;
    if (!token) {
      router.push('/');
      return;
    }
    load();
  }, [isReady, token, load, router]);

  const startEditing = () => {
    const existing = customer?.discount.discount;
    setPercentage(existing?.active ? existing.percentage : 15);
    setEffectiveFrom(existing?.effectiveFrom ? existing.effectiveFrom.slice(0, 10) : todayIso());
    setEffectiveUntil(existing?.effectiveUntil ? existing.effectiveUntil.slice(0, 10) : '');
    setReason(existing?.active ? existing.reason ?? '' : '');
    setFormError('');
    setEditing(true);
  };

  const saveDiscount = async () => {
    setFormError('');
    if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
      setFormError('Discount must be a whole number between 0 and 100.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/admin/customers/${customerId}/discount`, {
        percentage,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        effectiveUntil: effectiveUntil ? new Date(effectiveUntil).toISOString() : null,
        reason: reason || null,
      });
      setEditing(false);
      await load();
    } catch (e: any) {
      setFormError(e?.response?.data?.message || e?.message || 'Failed to save discount');
    } finally {
      setSaving(false);
    }
  };

  const disableDiscount = async () => {
    if (!window.confirm('Disable this customer’s discount? Future plan, renewal and top-up purchases will use standard prices.')) return;
    setSaving(true);
    try {
      await api.patch(`/admin/customers/${customerId}/discount/disable`, {});
      await load();
    } catch (e) {
      window.alert('Failed to disable discount');
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

  if (error || !customer) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-600 text-sm">{error || 'Customer not found'}</p>
      </div>
    );
  }

  const discount = customer.discount.discount;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/customers" className="inline-flex items-center gap-1 text-sm text-[#3D3650] hover:text-[#170B2E] mb-3">
          <ArrowLeft size={14} /> Back to customers
        </Link>
        <h1 className="text-2xl font-bold text-[#170B2E]">{customer.name || 'Unnamed'}</h1>
        <p className="text-sm text-[#3D3650] mt-1">{customer.email}</p>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs text-[#3D3650] mb-2">Usage this period</p>
          <p className="text-lg font-bold text-[#170B2E]">{formatCredits(customer.usage.credits.total)} credits</p>
          <p className="text-sm text-[#3D3650] mt-1">
            {Math.round(customer.usage.usage.audioMinutes)} audio · {Math.round(customer.usage.usage.videoMinutes)} video ·{' '}
            {Math.round(customer.usage.usage.screenShareMinutes)} screen-share participant-min
          </p>
        </div>
        <div className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <p className="text-xs text-[#3D3650] mb-2">Account status</p>
          <p className="text-sm font-medium text-[#170B2E]">{customer.status}</p>
          <p className="text-sm text-[#3D3650] mt-1">
            Customer since {new Date(customer.createdAt).toLocaleDateString('en-IN')}
          </p>
        </div>
      </div>

      {/* Plan, credits, payments */}
      <CustomerBillingPanel customerId={customerId} onChanged={load} />

      {/* Account profile (from onboarding) */}
      <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-[#170B2E]">Account profile</p>
          <span
            className={`text-[11px] px-2 py-1 rounded ${customer.profileCompleted ? 'text-emerald-700 border border-emerald-500/30' : 'text-amber-700 border border-amber-500/40'}`}
          >
            {customer.profileCompleted ? 'Profile complete' : 'Profile incomplete'}
          </span>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          {[
            ['Name', customer.name],
            ['Email', customer.email],
            ['Phone', customer.phone],
            ['Company', customer.companyName],
            ['Job title', customer.jobTitle],
            ['Country', countryByCode(customer.country)?.name ?? customer.country],
            ['Website', customer.companyWebsite],
            ['Expected usage', usageRangeLabel(customer.expectedUsageRange)],
            ['Primary use case', useCaseLabel(customer.primaryUseCase)],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-[#3D3650] mb-0.5">{label}</dt>
              <dd className="text-[#170B2E] break-words">
                {label === 'Website' && value ? (
                  <a href={value as string} target="_blank" rel="noopener noreferrer" className="text-[#7F40E8] hover:underline">
                    {value}
                  </a>
                ) : (
                  value || <span className="text-[#3D3650]">—</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Discount */}
      <div className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-[#170B2E]">Customer discount</p>
            <p className="text-xs text-[#3D3650] mt-0.5">Applies to plan, renewal and top-up prices before GST.</p>
          </div>
          {!editing && (
            <div className="flex gap-2">
              <button
                onClick={startEditing}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#D6C4EE] text-[#3D3650] hover:border-[#7F40E8]"
              >
                {discount?.active ? 'Edit Discount' : 'Add Discount'}
              </button>
              {discount?.active && (
                <button
                  onClick={disableDiscount}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 rounded-lg border border-red-300 text-red-600 hover:border-red-500 disabled:opacity-50"
                >
                  Disable Discount
                </button>
              )}
            </div>
          )}
        </div>

        {!editing && (
          discount?.active ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-[#3D3650] mb-0.5">Current discount</p>
                <p className="text-2xl font-bold text-[#170B2E]">{discount.percentage}%</p>
              </div>
              <div>
                <p className="text-xs text-[#3D3650] mb-0.5">Status</p>
                <span className="inline-block text-xs px-2 py-1 rounded border border-emerald-500/30 text-emerald-700">Active</span>
              </div>
              <div>
                <p className="text-xs text-[#3D3650] mb-0.5">Effective from</p>
                <p className="text-[#3D3650]">{new Date(discount.effectiveFrom).toLocaleDateString('en-IN')}</p>
              </div>
              <div>
                <p className="text-xs text-[#3D3650] mb-0.5">Effective until</p>
                <p className="text-[#3D3650]">
                  {discount.effectiveUntil ? new Date(discount.effectiveUntil).toLocaleDateString('en-IN') : 'No end date'}
                </p>
              </div>
              {discount.reason && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-[#3D3650] mb-0.5">Reason</p>
                  <p className="text-[#3D3650]">{discount.reason}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[#3D3650]">No discount — this customer pays standard plan and top-up prices.</p>
          )
        )}

        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[#3D3650] mb-1">Discount (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={percentage}
                  onChange={(e) => setPercentage(Math.round(Number(e.target.value) || 0))}
                  className="w-full rounded-lg border border-[#E7DFF5] bg-[#FFFFFF] px-3 py-2 text-sm text-[#170B2E] focus:border-[#7F40E8] outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#3D3650] mb-1">Effective from</label>
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="w-full rounded-lg border border-[#E7DFF5] bg-[#FFFFFF] px-3 py-2 text-sm text-[#170B2E] focus:border-[#7F40E8] outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#3D3650] mb-1">Effective until (optional)</label>
                <input
                  type="date"
                  value={effectiveUntil}
                  onChange={(e) => setEffectiveUntil(e.target.value)}
                  className="w-full rounded-lg border border-[#E7DFF5] bg-[#FFFFFF] px-3 py-2 text-sm text-[#170B2E] focus:border-[#7F40E8] outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-[#3D3650] mb-1">Reason</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enterprise volume agreement"
                  className="w-full rounded-lg border border-[#E7DFF5] bg-[#FFFFFF] px-3 py-2 text-sm text-[#170B2E] focus:border-[#7F40E8] outline-none"
                />
              </div>
            </div>

            <p className="text-xs text-[#3D3650]">
              The discount applies to plan, renewal and top-up prices before GST. It never changes credit rates.
            </p>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={saveDiscount}
                disabled={saving}
                className="text-sm px-4 py-2 rounded-lg bg-[#7F40E8] text-white hover:bg-[#6425C4] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Discount'}
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="text-sm px-4 py-2 rounded-lg border border-[#E7DFF5] text-[#3D3650]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
