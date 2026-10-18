'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getCreditRates, updateCreditRates, type BillingConfigUpdate } from '../../../lib/admin-billing';
import { formatCredits } from '../../../lib/billing';
import { Button } from '../../../components/ui/Button';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { useCanWrite } from '../../../lib/admin-access';
import { ErrorText, Field, inputCls, Panel, Spinner, useAdminErrorHandler, useResource } from './ui';

const FIELDS = [
  { key: 'audioCreditsPerMinute', label: 'Audio' },
  { key: 'videoCreditsPerMinute', label: 'Video' },
  { key: 'screenShareCreditsPerMinute', label: 'Screen share' },
] as const;

type Key = (typeof FIELDS)[number]['key'] | 'minimumCreditsToStartCall' | 'aiCreditsPerMinute';

/** Mirrors the server: participant-minutes × rate, rounded up to whole credits. */
export function exampleCredits(participants: number, minutes: number, perMinute: number) {
  const raw = participants * minutes * perMinute;
  return raw > 0 ? Math.ceil(raw - 1e-6) : 0;
}

export function CreditRatesTab() {
  const handle = useAdminErrorHandler();
  const { data, loading, error } = useResource(getCreditRates, []);
  const [form, setForm] = useState<Record<Key, string> | null>(null);
  const [participants, setParticipants] = useState('2');
  const [minutes, setMinutes] = useState('10');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const canWrite = useCanWrite();

  useEffect(() => {
    if (!data) return;
    const f = {} as Record<Key, string>;
    for (const { key } of FIELDS) f[key] = String(data[key] ?? 0);
    f.minimumCreditsToStartCall = String(data.minimumCreditsToStartCall ?? 0);
    // Only servers with AI billing send the AI rate.
    if (data.aiCreditsPerMinute !== undefined) f.aiCreditsPerMinute = String(data.aiCreditsPerMinute);
    setForm(f);
  }, [data]);

  if (loading || (!form && !error)) return <Spinner />;
  if (error || !form) return <ErrorText>{error || 'Failed to load'}</ErrorText>;

  const num = (k: Key) => Number(form[k]) || 0;
  const p = Math.max(0, Number(participants) || 0);
  const m = Math.max(0, Number(minutes) || 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaveError('');
    const body: BillingConfigUpdate = {};
    for (const k of Object.keys(form) as Key[]) {
      if (!/^\d+$/.test(form[k].trim())) return setSaveError('All rates must be non-negative whole numbers.');
      body[k] = Number(form[k]);
    }
    if (body.aiCreditsPerMinute !== undefined && body.aiCreditsPerMinute < 1) {
      return setSaveError('AI voice must be at least 1 credit per minute.');
    }
    setSaving(true);
    try {
      await updateCreditRates(body);
      setToast({ id: Date.now(), type: 'success', message: 'Credit rates saved — applied to calls that finish from now on' });
    } catch (err) {
      setSaveError(handle(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <Panel title="Credit rates" subtitle="Credits consumed per participant-minute. Each media type is rounded up to whole credits per call.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label} (credits / participant-min)`}>
              <input
                type="number"
                min={0}
                disabled={!canWrite}
                className={inputCls}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="Minimum credits to start a call" hint="New calls are blocked below this balance. Active calls are never cut off.">
            <input
              type="number"
              min={0}
              disabled={!canWrite}
              className={inputCls}
              value={form.minimumCreditsToStartCall}
              onChange={(e) => setForm({ ...form, minimumCreditsToStartCall: e.target.value })}
            />
          </Field>
        </div>
      </Panel>

      {form.aiCreditsPerMinute !== undefined && (
        <Panel
          title="AI voice agents"
          subtitle="Credits per minute of an AI voice agent call (whole call, not per participant), rounded up to whole credits per call."
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field
              label="AI voice (credits / call-min)"
              hint={`New AI calls need at least max(minimum to start, this rate) credits. A ${m}-min AI call uses ${formatCredits(exampleCredits(1, m, num('aiCreditsPerMinute')))} credits.`}
            >
              <input
                type="number"
                min={1}
                disabled={!canWrite}
                className={inputCls}
                value={form.aiCreditsPerMinute}
                onChange={(e) => setForm({ ...form, aiCreditsPerMinute: e.target.value })}
              />
            </Field>
          </div>
        </Panel>
      )}

      <Panel title="Live example" subtitle="Calculated from the values above.">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <Field label="Participants">
            <input type="number" min={1} className={`${inputCls} w-28`} value={participants} onChange={(e) => setParticipants(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <input type="number" min={1} className={`${inputCls} w-28`} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        <ul className="space-y-1 text-sm text-[#170B2E]" data-testid="credit-example">
          {FIELDS.map((f) => (
            <li key={f.key}>
              {p} participants × {m} min {f.label.toLowerCase()} ={' '}
              <strong>{formatCredits(exampleCredits(p, m, num(f.key)))} credits</strong>
            </li>
          ))}
        </ul>
      </Panel>

      {canWrite && (
        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving}>Save credit rates</Button>
          <ErrorText>{saveError}</ErrorText>
        </div>
      )}
    </form>
  );
}
