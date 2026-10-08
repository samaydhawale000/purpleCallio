'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { getBillingSettings, updateBillingSettings, type TopUpExpiryPolicy } from '../../../lib/admin-billing';
import { Button } from '../../../components/ui/Button';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { ErrorText, Field, inputCls, Panel, Spinner, useAdminErrorHandler, useResource } from './ui';

interface Form {
  taxPercent: string;
  thresholds: string[];
  topUpExpiryPolicy: TopUpExpiryPolicy;
  topUpExpiryDays: string;
  renewalReminderDays: string;
  pendingCheckoutTtlHours: string;
  autoRenewDefault: boolean;
  autoRenewGraceHours: string;
}

const whole = (s: string) => /^\d+$/.test(s.trim());

export function SettingsTab() {
  const handle = useAdminErrorHandler();
  const { data, loading, error } = useResource(getBillingSettings, []);
  const [form, setForm] = useState<Form | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      taxPercent: String(data.taxPercent),
      thresholds: (data.lowCreditThresholds ?? []).map(String),
      topUpExpiryPolicy: data.topUpExpiryPolicy,
      topUpExpiryDays: data.topUpExpiryDays ? String(data.topUpExpiryDays) : '',
      renewalReminderDays: String(data.renewalReminderDays),
      pendingCheckoutTtlHours: String(data.pendingCheckoutTtlHours),
      autoRenewDefault: data.autoRenewDefault ?? true,
      autoRenewGraceHours: String(data.autoRenewGraceHours ?? 72),
    });
  }, [data]);

  if (loading || (!form && !error)) return <Spinner />;
  if (error || !form) return <ErrorText>{error || 'Failed to load'}</ErrorText>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaveError('');
    if (!whole(form.taxPercent) || Number(form.taxPercent) > 100) return setSaveError('Tax must be a whole percentage between 0 and 100.');
    const thresholds = form.thresholds.map((t) => t.trim()).filter(Boolean);
    if (thresholds.some((t) => !whole(t) || Number(t) < 1 || Number(t) > 100)) {
      return setSaveError('Low-credit thresholds must be whole percentages between 1 and 100.');
    }
    if (form.topUpExpiryPolicy === 'DAYS' && (!whole(form.topUpExpiryDays) || Number(form.topUpExpiryDays) < 1)) {
      return setSaveError('Enter the number of days after which top-up credits expire.');
    }
    if (!whole(form.renewalReminderDays)) return setSaveError('Renewal reminder days must be a whole number.');
    if (!whole(form.pendingCheckoutTtlHours) || Number(form.pendingCheckoutTtlHours) < 1) {
      return setSaveError('Abandoned checkout expiry must be at least 1 hour.');
    }
    if (!whole(form.autoRenewGraceHours)) return setSaveError('Auto-renew grace must be a whole number of hours.');
    setSaving(true);
    try {
      await updateBillingSettings({
        taxPercent: Number(form.taxPercent),
        lowCreditThresholds: thresholds.map(Number),
        topUpExpiryPolicy: form.topUpExpiryPolicy,
        topUpExpiryDays: form.topUpExpiryPolicy === 'DAYS' ? Number(form.topUpExpiryDays) : form.topUpExpiryDays ? Number(form.topUpExpiryDays) : null,
        renewalReminderDays: Number(form.renewalReminderDays),
        pendingCheckoutTtlHours: Number(form.pendingCheckoutTtlHours),
        autoRenewDefault: form.autoRenewDefault,
        autoRenewGraceHours: Number(form.autoRenewGraceHours),
      });
      setToast({ id: Date.now(), type: 'success', message: 'Billing settings saved' });
    } catch (err) {
      setSaveError(handle(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const setThreshold = (i: number, v: string) => setForm({ ...form, thresholds: form.thresholds.map((t, j) => (i === j ? v : t)) });

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <Panel title="Tax">
        <Field label="GST (%)" hint="Added at checkout on top of plan and top-up prices (after any customer discount)." className="max-w-xs">
          <input type="number" min={0} max={100} className={inputCls} value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
        </Field>
      </Panel>

      <Panel title="Low-credit notifications" subtitle="Customers are notified when their remaining credits drop below each percentage of the credits granted this period.">
        <div className="flex flex-wrap gap-2 items-center">
          {form.thresholds.map((t, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                aria-label={`Threshold ${i + 1}`}
                type="number"
                min={1}
                max={100}
                className={`${inputCls} w-20`}
                value={t}
                onChange={(e) => setThreshold(i, e.target.value)}
              />
              <span className="text-xs text-[#3D3650]">%</span>
              <button
                type="button"
                aria-label={`Remove threshold ${i + 1}`}
                className="text-[#3D3650] hover:text-red-600"
                onClick={() => setForm({ ...form, thresholds: form.thresholds.filter((_, j) => j !== i) })}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setForm({ ...form, thresholds: [...form.thresholds, ''] })}
            className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-md border border-dashed border-[#D6C4EE] text-[#6425C4]"
          >
            <Plus size={12} /> Add threshold
          </button>
        </div>
      </Panel>

      <Panel title="Top-up expiry">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <Field label="Top-up credits expire">
            <select
              className={inputCls}
              value={form.topUpExpiryPolicy}
              onChange={(e) => setForm({ ...form, topUpExpiryPolicy: e.target.value as TopUpExpiryPolicy })}
            >
              <option value="NEVER">Never</option>
              <option value="DAYS">After a number of days</option>
              <option value="SUBSCRIPTION_END">At the end of the current plan period</option>
            </select>
          </Field>
          {form.topUpExpiryPolicy === 'DAYS' && (
            <Field label="Days after purchase">
              <input type="number" min={1} className={inputCls} value={form.topUpExpiryDays} onChange={(e) => setForm({ ...form, topUpExpiryDays: e.target.value })} />
            </Field>
          )}
        </div>
      </Panel>

      <Panel title="Renewals & checkout">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <Field label="Renewal reminder (days before period end)" hint="Customers get a reminder (auto-renew: an upcoming-charge notice) this many days before period end.">
            <input type="number" min={0} className={inputCls} value={form.renewalReminderDays} onChange={(e) => setForm({ ...form, renewalReminderDays: e.target.value })} />
          </Field>
          <Field label="Abandoned checkout expiry (hours)" hint="Unpaid checkouts are cancelled after this long.">
            <input type="number" min={1} className={inputCls} value={form.pendingCheckoutTtlHours} onChange={(e) => setForm({ ...form, pendingCheckoutTtlHours: e.target.value })} />
          </Field>
          <Field label="Auto-renew grace (hours)" hint="An auto-renewing plan stays active this long past period end while the renewal payment is retried.">
            <input type="number" min={0} className={inputCls} value={form.autoRenewGraceHours} onChange={(e) => setForm({ ...form, autoRenewGraceHours: e.target.value })} />
          </Field>
          <label className="sm:col-span-2 flex items-start gap-2 text-sm text-[#170B2E]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[#7F40E8]"
              checked={form.autoRenewDefault}
              onChange={(e) => setForm({ ...form, autoRenewDefault: e.target.checked })}
            />
            <span>
              Pre-select auto-renew at checkout
              <span className="block text-xs text-[#3D3650]">Customers can always untick it, and turn it off later from Billing.</span>
            </span>
          </label>
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving}>Save settings</Button>
        <ErrorText>{saveError}</ErrorText>
      </div>
    </form>
  );
}
