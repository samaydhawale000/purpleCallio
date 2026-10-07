'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { useAuthStore } from '../../../../store/auth.store';
import {
  CUSTOM_PLAN_STATUS_LABEL,
  CUSTOM_PLAN_STATUSES,
  getCustomPlan,
  listAdminFeatures,
  listAdminUsers,
  optionalInt,
  updateCustomPlan,
  withdrawCustomOffer,
  type AdminFeature,
  type CustomPlanDetail,
  type CustomPlanUpdate,
  type UserRef,
} from '../../../../lib/admin-billing';
import type { CustomPlanRequestStatus } from '../../../../lib/billing';
import { formatCredits, formatDate, formatMoney, intervalLabel } from '../../../../lib/billing';
import { countryByCode, usageRangeLabel, useCaseLabel } from '../../../../lib/onboarding';
import { Button } from '../../../../components/ui/Button';
import { ToastHost, type ToastState } from '../../../../dashboard/billing/Toast';
import { CustomOfferForm } from '../../_components/CustomOfferForm';
import { CustomPlanSnapshot } from '../../_components/CustomPlanSnapshot';
import { ErrorText, Field, inputCls, Panel, Spinner, StatusBadge, useAdminErrorHandler } from '../../_components/ui';

export default function CustomPlanRequestPage() {
  const { id } = useParams<{ id: string }>();
  const me = useAuthStore((s) => s.user);
  const handle = useAdminErrorHandler();
  const [detail, setDetail] = useState<CustomPlanDetail | null>(null);
  const [features, setFeatures] = useState<AdminFeature[]>([]);
  const [admins, setAdmins] = useState<UserRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [estimate, setEstimate] = useState('');
  const [saving, setSaving] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, f] = await Promise.all([getCustomPlan(id), listAdminFeatures()]);
        if (cancelled) return;
        setDetail(d);
        setNotes(d.notes ?? '');
        setEstimate(d.estimatedMonthlyCredits == null ? '' : String(d.estimatedMonthlyCredits));
        setFeatures(f);
      } catch (e) {
        if (!cancelled) setError(handle(e, 'Failed to load request'));
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Admin list is best-effort; "Assign to me" works without it.
      listAdminUsers()
        .then((a) => !cancelled && setAdmins(a))
        .catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [id, handle]);

  const patch = async (body: CustomPlanUpdate, success: string) => {
    setSaving(true);
    try {
      setDetail(await updateCustomPlan(id, body));
      setToast({ id: Date.now(), type: 'success', message: success });
    } catch (e) {
      const m = handle(e, 'Update failed');
      if (m) setToast({ id: Date.now(), type: 'error', message: m });
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (offerId: string) => {
    if (!window.confirm('Withdraw this offer? The customer will no longer be able to accept it.')) return;
    try {
      await withdrawCustomOffer(offerId);
      setDetail(await getCustomPlan(id));
      setToast({ id: Date.now(), type: 'success', message: 'Offer withdrawn' });
    } catch (e) {
      const m = handle(e, 'Failed to withdraw');
      if (m) setToast({ id: Date.now(), type: 'error', message: m });
    }
  };

  const back = (
    <Link href="/admin/billing?tab=custom-plans" className="inline-flex items-center gap-1 text-sm text-[#3D3650] hover:text-[#170B2E]">
      <ArrowLeft size={14} /> Back to custom plans
    </Link>
  );

  if (loading) return <Spinner />;
  if (error || !detail) {
    return (
      <div className="space-y-4">
        {back}
        <ErrorText>{error || 'Request not found'}</ErrorText>
      </div>
    );
  }

  const c = detail.customer;
  const adminOptions = [...admins];
  if (detail.assignedAdmin && !adminOptions.some((a) => a.id === detail.assignedAdmin!.id)) adminOptions.unshift(detail.assignedAdmin);

  const saveNotes = () => {
    const est = optionalInt(estimate);
    if (Number.isNaN(est)) {
      setToast({ id: Date.now(), type: 'error', message: 'Estimated monthly credits must be a whole number.' });
      return;
    }
    patch({ notes: notes.trim() || null, estimatedMonthlyCredits: est }, 'Notes saved');
  };

  return (
    <div className="flex flex-col gap-6">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <div>
        {back}
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <h1 className="text-2xl font-bold text-[#170B2E]">Custom plan — {c.companyName || c.name || c.email}</h1>
          <StatusBadge status={detail.status} label={CUSTOM_PLAN_STATUS_LABEL[detail.status]} />
        </div>
        <p className="text-sm text-[#3D3650] mt-1">
          Requested {formatDate(detail.requestedAt)}
          {detail.closedAt && <> · Closed {formatDate(detail.closedAt)}</>}
        </p>
        <div className="mt-3">
          <Link
            href={`/admin/support/${detail.ticket.id}`}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-[#D6C4EE] text-[#6425C4] hover:border-[#7F40E8]"
          >
            <MessageSquare size={15} /> Open conversation ({detail.ticket.ticketNumber})
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <Panel title="Customer profile">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {(
                [
                  ['Name', c.name],
                  ['Email', c.email],
                  ['Phone', c.phone],
                  ['Company', c.companyName],
                  ['Job title', c.jobTitle],
                  ['Country', countryByCode(c.country)?.name ?? c.country],
                  ['Website', c.companyWebsite],
                  ['Expected usage', usageRangeLabel(c.expectedUsageRange)],
                  ['Use case', useCaseLabel(c.primaryUseCase)],
                  ['Customer since', formatDate(c.createdAt)],
                ] as [string, string | null | undefined][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-[#3D3650]">{k}</dt>
                  <dd className="text-[#170B2E] break-words">
                    {k === 'Website' && v ? (
                      <a href={v} target="_blank" rel="noopener noreferrer" className="text-[#7F40E8] hover:underline">{v}</a>
                    ) : (
                      v || <span className="text-[#6B6478]">—</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <Link href={`/admin/customers/${c.id}`} className="inline-block mt-4 text-xs font-medium text-[#6425C4] hover:text-[#170B2E]">
              View customer →
            </Link>
          </Panel>

          <Panel
            title="Offers"
            subtitle="Private plans proposed to this customer."
            actions={!offerOpen && <Button size="sm" onClick={() => setOfferOpen(true)}>Create custom offer</Button>}
          >
            {offerOpen && (
              <div className="mb-6 rounded-xl border border-[#E7DFF5] p-4">
                <CustomOfferForm
                  requestId={detail.id}
                  features={features.filter((f) => f.isActive)}
                  onCancel={() => setOfferOpen(false)}
                  onCreated={(d) => {
                    setDetail(d);
                    setOfferOpen(false);
                    setToast({ id: Date.now(), type: 'success', message: 'Offer sent to the customer' });
                  }}
                />
              </div>
            )}
            {detail.offers.length === 0 ? (
              <p className="text-sm text-[#3D3650]">No offers yet.</p>
            ) : (
              <div className="space-y-3">
                {detail.offers.map((o) => {
                  const v = o.plan.version;
                  return (
                    <div key={o.id} className="rounded-xl border border-[#E7DFF5] p-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#170B2E]">{o.plan.name}</span>
                          <StatusBadge status={o.status} />
                        </div>
                        {o.status === 'SENT' && (
                          <button className="text-xs font-medium text-red-600 hover:text-red-800" onClick={() => withdraw(o.id)}>
                            Withdraw
                          </button>
                        )}
                      </div>
                      {v && (
                        <p className="text-[#3D3650] mt-1">
                          {formatMoney(v.pricePaise, v.currency)} / {intervalLabel(v)} · {formatCredits(v.includedCredits)} credits
                          {v.features.length ? ` · ${v.features.length} features` : ''}
                        </p>
                      )}
                      <p className="text-xs text-[#6B6478] mt-1">
                        Sent {formatDate(o.createdAt)}
                        {o.expiresAt && <> · Expires {formatDate(o.expiresAt)}</>}
                        {o.acceptedAt && <> · Accepted {formatDate(o.acceptedAt)}</>}
                      </p>
                      {o.message && <p className="text-xs text-[#3D3650] mt-2 whitespace-pre-wrap">{o.message}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Request">
            <div className="space-y-4">
              <Field label="Status">
                <select
                  className={inputCls}
                  value={detail.status}
                  disabled={saving}
                  onChange={(e) => patch({ status: e.target.value as CustomPlanRequestStatus }, 'Status updated')}
                >
                  {CUSTOM_PLAN_STATUSES.map((s) => (
                    <option key={s} value={s}>{CUSTOM_PLAN_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </Field>
              <div>
                <span className="block text-xs font-medium text-[#3D3650] mb-1">Assignee</span>
                <select
                  aria-label="Assignee"
                  className={inputCls}
                  disabled={saving}
                  value={detail.assignedAdmin?.id ?? ''}
                  onChange={(e) => patch({ assignedAdminId: e.target.value || null }, e.target.value ? 'Assigned' : 'Unassigned')}
                >
                  <option value="">Unassigned</option>
                  {adminOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.email}</option>
                  ))}
                </select>
                <div className="flex gap-3 mt-2">
                  {me?.userId && detail.assignedAdmin?.id !== me.userId && (
                    <button className="text-xs font-medium text-[#6425C4]" disabled={saving} onClick={() => patch({ assignedAdminId: me.userId }, 'Assigned to you')}>
                      Assign to me
                    </button>
                  )}
                  {detail.assignedAdmin && (
                    <button className="text-xs font-medium text-[#3D3650]" disabled={saving} onClick={() => patch({ assignedAdminId: null }, 'Unassigned')}>
                      Unassign
                    </button>
                  )}
                </div>
              </div>
              <Field label="Estimated monthly credits">
                <input type="number" min={0} className={inputCls} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
              </Field>
              <Field label="Internal notes">
                <textarea className={inputCls} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Button size="sm" variant="secondary" onClick={saveNotes} loading={saving}>Save notes</Button>
            </div>
          </Panel>
          <Panel title="Account">
            <CustomPlanSnapshot detail={detail} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
