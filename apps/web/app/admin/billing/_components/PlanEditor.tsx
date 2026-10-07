'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import {
  BILLING_INTERVALS,
  createPlan,
  CTA_ACTION_LABEL,
  CTA_ACTIONS,
  getAdminPlan,
  INTERVAL_LABEL,
  listAdminFeatures,
  optionalInt,
  paiseToRupeesInput,
  PLAN_STATUSES,
  PLAN_TYPES,
  rupeesToPaise,
  updatePlan,
  type AdminFeature,
  type AdminPlanDetail,
  type PlanInput,
} from '../../../lib/admin-billing';
import type { BillingInterval, PlanCtaAction, PlanStatus, PlanType } from '../../../lib/billing';
import { formatCredits, formatDate, formatMoney, intervalLabel } from '../../../lib/billing';
import { Button } from '../../../components/ui/Button';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { FeatureChecklist } from './PlanFields';
import { Checkbox, ErrorText, Field, inputCls, Panel, rowCls, Spinner, StatusBadge, Table, tdCls, useAdminErrorHandler } from './ui';

export const VERSIONING_NOTE =
  'Changing price, credits, media caps or features creates a new version. Existing subscribers keep the terms they purchased.';

interface FormState {
  name: string;
  slug: string;
  description: string;
  badge: string;
  isPopular: boolean;
  displayOrder: string;
  isPublic: boolean;
  type: PlanType;
  status: PlanStatus;
  ctaLabel: string;
  ctaAction: PlanCtaAction;
  price: string;
  currency: string;
  billingInterval: BillingInterval;
  intervalCount: string;
  includedCredits: string;
  audio: string;
  video: string;
  screenShare: string;
  features: string[];
}

const EMPTY: FormState = {
  name: '',
  slug: '',
  description: '',
  badge: '',
  isPopular: false,
  displayOrder: '0',
  isPublic: true,
  type: 'PAID',
  status: 'ACTIVE',
  ctaLabel: '',
  ctaAction: 'CHECKOUT',
  price: '',
  currency: 'INR',
  billingInterval: 'MONTH',
  intervalCount: '1',
  includedCredits: '',
  audio: '',
  video: '',
  screenShare: '',
  features: [],
};

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

function fromPlan(p: AdminPlanDetail): FormState {
  const v = p.version;
  return {
    name: p.name,
    slug: p.slug,
    description: p.description ?? '',
    badge: p.badge ?? '',
    isPopular: p.isPopular,
    displayOrder: String(p.displayOrder),
    isPublic: p.isPublic,
    type: p.type,
    status: p.status,
    ctaLabel: p.ctaLabel ?? '',
    ctaAction: p.ctaAction,
    price: paiseToRupeesInput(v?.pricePaise ?? 0),
    currency: v?.currency ?? 'INR',
    billingInterval: v?.billingInterval ?? 'MONTH',
    intervalCount: String(v?.intervalCount ?? 1),
    includedCredits: str(v?.includedCredits ?? 0),
    audio: str(v?.includedAudioCredits),
    video: str(v?.includedVideoCredits),
    screenShare: str(v?.includedScreenShareCredits),
    features: v?.features ?? [],
  };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

/** Validates the form and builds the API payload. Returns an error string on failure. */
export function buildPlanInput(f: FormState): PlanInput | string {
  if (!f.name.trim()) return 'Name is required.';
  const slug = f.slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) return 'Slug may only contain lowercase letters, numbers and dashes.';
  const displayOrder = Number(f.displayOrder);
  if (!Number.isInteger(displayOrder)) return 'Display order must be a whole number.';
  const pricePaise = rupeesToPaise(f.price || '0');
  if (Number.isNaN(pricePaise)) return 'Enter a valid price in ₹ (up to 2 decimals).';
  if (f.type === 'FREE' && pricePaise !== 0) return 'A Free plan must cost ₹0.';
  if (f.type === 'PAID' && pricePaise <= 0) return 'A paid plan needs a price above zero.';
  if (f.type === 'FREE' && f.billingInterval !== 'MONTH') return 'Free plan credits refresh monthly; use a monthly interval.';
  if (!/^[A-Z]{3}$/.test(f.currency)) return 'Currency must be a 3-letter code (e.g. INR).';
  const intervalCount = optionalInt(f.intervalCount);
  if (intervalCount == null || Number.isNaN(intervalCount) || intervalCount < 1) {
    return f.billingInterval === 'CUSTOM' ? 'Enter the period length in days (at least 1).' : 'Interval count must be at least 1.';
  }
  const includedCredits = optionalInt(f.includedCredits || '0');
  if (includedCredits == null || Number.isNaN(includedCredits)) return 'Included credits must be a whole number.';
  const caps = {
    includedAudioCredits: optionalInt(f.audio),
    includedVideoCredits: optionalInt(f.video),
    includedScreenShareCredits: optionalInt(f.screenShare),
  };
  for (const [k, v] of Object.entries(caps)) {
    if (Number.isNaN(v)) return `${k.replace('included', '').replace('Credits', '')} cap must be a whole number or blank.`;
    if (v != null && v > includedCredits) return 'A per-media cap cannot exceed the total included credits.';
  }
  return {
    name: f.name.trim(),
    slug,
    description: f.description.trim() || null,
    badge: f.badge.trim() || null,
    isPopular: f.isPopular,
    displayOrder,
    isPublic: f.isPublic,
    type: f.type,
    status: f.status,
    ctaLabel: f.ctaLabel.trim() || null,
    ctaAction: f.ctaAction,
    pricePaise,
    currency: f.currency,
    billingInterval: f.billingInterval,
    intervalCount,
    includedCredits,
    ...caps,
    features: f.features,
  };
}

export function PlanEditor({ planId }: { planId: string | null }) {
  const router = useRouter();
  const handle = useAdminErrorHandler();
  const [plan, setPlan] = useState<AdminPlanDetail | null>(null);
  const [features, setFeatures] = useState<AdminFeature[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(!!planId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [feats, p] = await Promise.all([listAdminFeatures(), planId ? getAdminPlan(planId) : Promise.resolve(null)]);
        if (cancelled) return;
        setFeatures(feats);
        if (p) {
          setPlan(p);
          setForm(fromPlan(p));
        }
      } catch (e) {
        if (!cancelled) setLoadError(handle(e, 'Failed to load plan'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, handle]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const input = buildPlanInput(form);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    setSaving(true);
    try {
      if (planId) {
        await updatePlan(planId, input);
        const fresh = await getAdminPlan(planId);
        setPlan(fresh);
        setForm(fromPlan(fresh));
        setToast({ id: Date.now(), type: 'success', message: 'Plan saved' });
      } else {
        const created = await createPlan(input);
        router.push(`/admin/billing/plans/${created.id}`);
      }
    } catch (err) {
      setError(handle(err, 'Failed to save plan'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (loadError) return <ErrorText>{loadError}</ErrorText>;

  const isCustomInterval = form.billingInterval === 'CUSTOM';

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <div>
        <Link href="/admin/billing?tab=plans" className="inline-flex items-center gap-1 text-sm text-[#3D3650] hover:text-[#170B2E] mb-3">
          <ArrowLeft size={14} /> Back to plans
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-[#170B2E]">{planId ? `Edit plan — ${plan?.name}` : 'New plan'}</h1>
          {plan && <StatusBadge status={plan.status} />}
          {plan?.version && <span className="text-xs text-[#3D3650]">Current version v{plan.version.version}</span>}
        </div>
        {plan && (
          <p className="text-sm text-[#3D3650] mt-1">
            {plan.activeSubscribers} active subscriber{plan.activeSubscribers === 1 ? '' : 's'}
            {plan.assignedUser && <> · Private plan for {plan.assignedUser.email}</>}
          </p>
        )}
      </div>

      <div className="flex gap-2 items-start rounded-xl border border-[#D6C4EE] bg-[#F8F4FD] p-4 text-sm text-[#3D3650]">
        <Info size={16} className="text-[#6425C4] shrink-0 mt-0.5" />
        <p>{VERSIONING_NOTE}</p>
      </div>
      {plan?.status === 'ARCHIVED' && (
        <p className="text-sm text-amber-700">This plan is archived. Set its status to Active or Inactive to restore and edit it.</p>
      )}

      <Panel title="General">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name">
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => {
                set('name', e.target.value);
                if (!slugTouched) set('slug', slugify(e.target.value));
              }}
            />
          </Field>
          <Field label="Slug" hint="Lowercase letters, numbers and dashes. Used in URLs.">
            <input
              className={`${inputCls} font-mono`}
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set('slug', e.target.value);
              }}
            />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <textarea className={inputCls} rows={2} maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Badge" hint="Optional label shown on the plan card.">
            <input className={inputCls} maxLength={60} value={form.badge} onChange={(e) => set('badge', e.target.value)} />
          </Field>
          <Field label="Display order">
            <input type="number" className={inputCls} value={form.displayOrder} onChange={(e) => set('displayOrder', e.target.value)} />
          </Field>
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value as PlanType)}>
              {PLAN_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value as PlanStatus)}>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="CTA label">
            <input className={inputCls} maxLength={60} value={form.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} />
          </Field>
          <Field label="CTA action">
            <select className={inputCls} value={form.ctaAction} onChange={(e) => set('ctaAction', e.target.value as PlanCtaAction)}>
              {CTA_ACTIONS.map((a) => (
                <option key={a} value={a}>{CTA_ACTION_LABEL[a]}</option>
              ))}
            </select>
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <Checkbox label="Public (shown on the pricing page and in the dashboard)" checked={form.isPublic} onChange={(v) => set('isPublic', v)} />
            <Checkbox label="Highlight as popular" checked={form.isPopular} onChange={(v) => set('isPopular', v)} />
          </div>
        </div>
      </Panel>

      <Panel title="Pricing" subtitle="Customers pay this upfront at checkout. GST is added on top using the configured tax %.">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="Price (₹)" hint={form.type === 'CUSTOM' && form.ctaAction === 'CONTACT_SALES' ? 'Shown as “Custom pricing”.' : undefined}>
            <input inputMode="decimal" className={inputCls} value={form.price} placeholder="0" onChange={(e) => set('price', e.target.value)} />
          </Field>
          <Field label="Currency">
            <input className={`${inputCls} uppercase`} maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Billing interval">
            <select className={inputCls} value={form.billingInterval} onChange={(e) => set('billingInterval', e.target.value as BillingInterval)}>
              {BILLING_INTERVALS.map((i) => (
                <option key={i} value={i}>{INTERVAL_LABEL[i]}</option>
              ))}
            </select>
          </Field>
          <Field label={isCustomInterval ? 'Period length (days)' : 'Interval count'}>
            <input type="number" min={1} className={inputCls} value={form.intervalCount} onChange={(e) => set('intervalCount', e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Credits" subtitle="Credits granted each paid period (each month for the Free plan).">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Total included credits" className="sm:col-span-3 sm:max-w-xs">
            <input type="number" min={0} className={inputCls} value={form.includedCredits} onChange={(e) => set('includedCredits', e.target.value)} />
          </Field>
          <p className="sm:col-span-3 text-xs text-[#3D3650]">
            Optional per-media caps within the total. Leave blank for no cap — all media types then share the total.
          </p>
          <Field label="Audio cap">
            <input type="number" min={0} className={inputCls} value={form.audio} onChange={(e) => set('audio', e.target.value)} />
          </Field>
          <Field label="Video cap">
            <input type="number" min={0} className={inputCls} value={form.video} onChange={(e) => set('video', e.target.value)} />
          </Field>
          <Field label="Screen-share cap">
            <input type="number" min={0} className={inputCls} value={form.screenShare} onChange={(e) => set('screenShare', e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title="Features" subtitle="From the feature registry (manage it in the Features tab).">
        <FeatureChecklist features={features} selected={form.features} onChange={(keys) => set('features', keys)} />
      </Panel>

      <div className="flex flex-wrap items-center gap-3 sticky bottom-0 bg-white/90 backdrop-blur py-3 border-t border-[#E7DFF5]">
        <Button type="submit" loading={saving}>
          {planId ? 'Save plan' : 'Create plan'}
        </Button>
        <Link href="/admin/billing?tab=plans" className="text-sm text-[#3D3650] hover:text-[#170B2E]">
          Cancel
        </Link>
        <ErrorText>{error}</ErrorText>
      </div>

      {plan && plan.versions.length > 0 && (
        <Panel title="Version history" subtitle="Versions are immutable. Subscribers stay on the version they purchased.">
          <Table headers={['Version', 'Price', 'Credits', 'Features', 'Created']}>
            {plan.versions.map((v) => (
              <tr key={v.id} className={rowCls}>
                <td className={tdCls}>
                  v{v.version}
                  {plan.version?.id === v.id && <span className="ml-2 text-[10px] text-emerald-700">current</span>}
                </td>
                <td className={tdCls}>{formatMoney(v.pricePaise, v.currency)} / {intervalLabel(v)}</td>
                <td className={tdCls}>{formatCredits(v.includedCredits)}</td>
                <td className={tdCls}>{v.features.length}</td>
                <td className={tdCls}>{formatDate(v.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </form>
  );
}
