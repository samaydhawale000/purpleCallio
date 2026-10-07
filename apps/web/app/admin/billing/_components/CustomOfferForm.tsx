'use client';

import { FormEvent, useState } from 'react';
import {
  BILLING_INTERVALS,
  createCustomOffer,
  INTERVAL_LABEL,
  optionalInt,
  rupeesToPaise,
  type AdminFeature,
  type CustomOfferInput,
  type CustomPlanDetail,
} from '../../../lib/admin-billing';
import type { BillingInterval } from '../../../lib/billing';
import { Button } from '../../../components/ui/Button';
import { FeatureChecklist } from './PlanFields';
import { ErrorText, Field, inputCls, useAdminErrorHandler } from './ui';

/** Validates the offer form; returns the payload or an error message. */
export function buildOfferInput(f: {
  name: string;
  description: string;
  price: string;
  billingInterval: BillingInterval;
  intervalCount: string;
  credits: string;
  audio: string;
  video: string;
  screenShare: string;
  features: string[];
  message: string;
  expiresOn: string;
}): CustomOfferInput | string {
  if (!f.name.trim()) return 'Plan name is required.';
  const pricePaise = rupeesToPaise(f.price);
  if (Number.isNaN(pricePaise) || pricePaise < 100) return 'Enter a price of at least ₹1.';
  const intervalCount = optionalInt(f.intervalCount);
  if (intervalCount == null || Number.isNaN(intervalCount) || intervalCount < 1) return 'Interval count must be at least 1.';
  const includedCredits = optionalInt(f.credits);
  if (includedCredits == null || Number.isNaN(includedCredits)) return 'Included credits must be a whole number.';
  const caps = {
    includedAudioCredits: optionalInt(f.audio),
    includedVideoCredits: optionalInt(f.video),
    includedScreenShareCredits: optionalInt(f.screenShare),
  };
  if (Object.values(caps).some((v) => Number.isNaN(v))) return 'Media caps must be whole numbers or blank.';
  if (Object.values(caps).some((v) => v != null && v > includedCredits)) return 'A per-media cap cannot exceed the total credits.';
  let expiresAt: string | null = null;
  if (f.expiresOn) {
    const d = new Date(`${f.expiresOn}T23:59:59`);
    if (Number.isNaN(d.getTime()) || d <= new Date()) return 'Offer expiry must be a future date.';
    expiresAt = d.toISOString();
  }
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    pricePaise,
    currency: 'INR',
    billingInterval: f.billingInterval,
    intervalCount,
    includedCredits,
    ...caps,
    features: f.features,
    message: f.message.trim() || null,
    expiresAt,
  };
}

export function CustomOfferForm({
  requestId,
  features,
  onCreated,
  onCancel,
}: {
  requestId: string;
  features: AdminFeature[];
  onCreated: (detail: CustomPlanDetail) => void;
  onCancel: () => void;
}) {
  const handle = useAdminErrorHandler();
  const [f, setF] = useState({
    name: '',
    description: '',
    price: '',
    billingInterval: 'MONTH' as BillingInterval,
    intervalCount: '1',
    credits: '',
    audio: '',
    video: '',
    screenShare: '',
    features: [] as string[],
    message: '',
    expiresOn: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const input = buildOfferInput(f);
    if (typeof input === 'string') return setError(input);
    setSaving(true);
    try {
      onCreated(await createCustomOffer(requestId, input));
    } catch (err) {
      setError(handle(err, 'Failed to send offer'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <p className="text-sm text-[#3D3650] rounded-xl border border-[#D6C4EE] bg-[#F8F4FD] p-3">
        This creates a private plan for this customer only and posts the offer into the conversation. Nothing changes on
        their account until they accept and pay — the plan activates only after payment is confirmed. Sending a new offer
        withdraws any open one.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Plan name">
          <input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Price (₹)" hint="GST is added at checkout.">
          <input inputMode="decimal" className={inputCls} value={f.price} onChange={(e) => set('price', e.target.value)} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <input className={inputCls} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Billing interval">
          <select className={inputCls} value={f.billingInterval} onChange={(e) => set('billingInterval', e.target.value as BillingInterval)}>
            {BILLING_INTERVALS.map((i) => (
              <option key={i} value={i}>{INTERVAL_LABEL[i]}</option>
            ))}
          </select>
        </Field>
        <Field label={f.billingInterval === 'CUSTOM' ? 'Period length (days)' : 'Interval count'}>
          <input type="number" min={1} className={inputCls} value={f.intervalCount} onChange={(e) => set('intervalCount', e.target.value)} />
        </Field>
        <Field label="Included credits per period">
          <input type="number" min={0} className={inputCls} value={f.credits} onChange={(e) => set('credits', e.target.value)} />
        </Field>
        <Field label="Offer expires on (optional)">
          <input type="date" className={inputCls} value={f.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} />
        </Field>
      </div>
      <div>
        <p className="text-xs font-medium text-[#3D3650] mb-2">Optional per-media caps within the total (blank = no cap)</p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Audio cap">
            <input type="number" min={0} className={inputCls} value={f.audio} onChange={(e) => set('audio', e.target.value)} />
          </Field>
          <Field label="Video cap">
            <input type="number" min={0} className={inputCls} value={f.video} onChange={(e) => set('video', e.target.value)} />
          </Field>
          <Field label="Screen-share cap">
            <input type="number" min={0} className={inputCls} value={f.screenShare} onChange={(e) => set('screenShare', e.target.value)} />
          </Field>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-[#3D3650] mb-2">Features</p>
        <FeatureChecklist features={features} selected={f.features} onChange={(keys) => set('features', keys)} />
      </div>
      <Field label="Message to customer (optional)" hint="Included in the conversation with the offer.">
        <textarea className={inputCls} rows={3} value={f.message} onChange={(e) => set('message', e.target.value)} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" loading={saving}>Send offer</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
