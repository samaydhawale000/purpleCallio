'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '../../../store/auth.store';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { api } from '../../../lib/api';
import { countryByCode, usageRangeLabel, useCaseLabel } from '../../../lib/onboarding';

import type { CurrentUsage } from '../../../lib/billing';
import { formatCredits } from '../../../lib/billing';
import { formatMinutes } from '../../../lib/duration';
import { CustomerBillingPanel } from '../../billing/_components/CustomerBillingPanel';
import { useCanWrite } from '../../../lib/admin-access';
import {
  DetailList,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
  Pill,
  Section,
  Stat,
  buttonCls,
  inputCls,
} from '../../../dashboard/_ui';

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
  const canWrite = useCanWrite();

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

  const backLink = (
    <Link
      href="/admin/customers"
      className="mb-4 inline-flex items-center gap-1 text-[13px] text-[#6B6478] hover:text-[#170B2E]"
    >
      <ArrowLeft size={14} /> Back to customers
    </Link>
  );

  if (loading) {
    return (
      <>
        {backLink}
        <Loading label="Loading customer…" />
      </>
    );
  }

  if (error || !customer) {
    return (
      <>
        {backLink}
        <ErrorNote message={error || 'Customer not found'} />
      </>
    );
  }

  const discount = customer.discount.discount;
  const statusTone = customer.status === 'ACTIVE' ? 'success' : customer.status === 'SUSPENDED' ? 'danger' : 'neutral';

  return (
    <>
      {backLink}
      <PageHeader
        title={customer.name || 'Unnamed'}
        description={`${customer.email} · Customer since ${new Date(customer.createdAt).toLocaleDateString('en-IN')}`}
        actions={<Pill tone={statusTone}>{customer.status}</Pill>}
      />

      <Section title="Usage this period">
        <Panel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
            <Stat label="Credits" value={formatCredits(customer.usage.credits.total)} />
            <Stat label="Audio" value={formatMinutes(customer.usage.usage.audioMinutes)} />
            <Stat label="Video" value={formatMinutes(customer.usage.usage.videoMinutes)} />
            <Stat label="Screen share" value={formatMinutes(customer.usage.usage.screenShareMinutes)} />
          </div>
          <p className="mt-4 text-xs text-[#6B6478]">Times are participant time.</p>
        </Panel>
      </Section>

      {/* Plan, credits, payments */}
      <div className="mb-10">
        <CustomerBillingPanel customerId={customerId} onChanged={load} />
      </div>

      {/* Account profile (from onboarding) */}
      <Section
        title="Account profile"
        actions={
          <Pill tone={customer.profileCompleted ? 'success' : 'warning'}>
            {customer.profileCompleted ? 'Profile complete' : 'Profile incomplete'}
          </Pill>
        }
      >
        <Panel>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
                <dt className="mb-0.5 text-[13px] text-[#6B6478]">{label}</dt>
                <dd className="break-words text-[#170B2E]">
                  {label === 'Website' && value ? (
                    <a href={value as string} target="_blank" rel="noopener noreferrer" className="text-[#5B21B6] hover:underline">
                      {value}
                    </a>
                  ) : (
                    value || <span className="text-[#9C95A8]">—</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </Section>

      {/* Discount */}
      <Section
        title="Customer discount"
        description="Applies to plan, renewal and top-up prices before GST."
        actions={
          canWrite && !editing ? (
            <>
              <button type="button" onClick={startEditing} className={buttonCls('secondary')}>
                {discount?.active ? 'Edit Discount' : 'Add Discount'}
              </button>
              {discount?.active && (
                <button type="button" onClick={disableDiscount} disabled={saving} className={buttonCls('danger')}>
                  Disable Discount
                </button>
              )}
            </>
          ) : undefined
        }
      >
        <Panel>
          {!editing &&
            (discount?.active ? (
              <div className="grid gap-6 md:grid-cols-[200px_1fr]">
                <Stat label="Current discount" value={`${discount.percentage}%`} hint={<Pill tone="success">Active</Pill>} />
                <DetailList
                  items={[
                    { label: 'Effective from', value: new Date(discount.effectiveFrom).toLocaleDateString('en-IN') },
                    {
                      label: 'Effective until',
                      value: discount.effectiveUntil ? new Date(discount.effectiveUntil).toLocaleDateString('en-IN') : 'No end date',
                    },
                    ...(discount.reason ? [{ label: 'Reason', value: discount.reason }] : []),
                  ]}
                />
              </div>
            ) : (
              <p className="text-sm text-[#6B6478]">No discount — this customer pays standard plan and top-up prices.</p>
            ))}

          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#170B2E]">Discount (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={percentage}
                    onChange={(e) => setPercentage(Math.round(Number(e.target.value) || 0))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#170B2E]">Effective from</label>
                  <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#170B2E]">Effective until (optional)</label>
                  <input type="date" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[#170B2E]">Reason</label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Enterprise volume agreement"
                    className={inputCls}
                  />
                </div>
              </div>

              <p className="text-xs text-[#6B6478]">
                The discount applies to plan, renewal and top-up prices before GST. It never changes credit rates.
              </p>

              {formError && <ErrorNote message={formError} />}

              <div className="flex gap-2">
                <button type="button" onClick={saveDiscount} disabled={saving} className={buttonCls('primary')}>
                  {saving ? 'Saving…' : 'Save Discount'}
                </button>
                <button type="button" onClick={() => setEditing(false)} disabled={saving} className={buttonCls('secondary')}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Panel>
      </Section>
    </>
  );
}
