'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getCreditRates, updateCreditRates, type BillingConfigUpdate } from '../../../lib/admin-billing';
import { formatCredits } from '../../../lib/billing';
import { translatedCallCredits, type TranslationBillingConfig } from '../../../lib/translation';
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

/** Live Translate rates; `optional` fields may be left blank (saved as null). */
const T_FIELDS = [
  { key: 'translationVoiceCreditsPerMinute', label: 'Voice translation (credits / min)', optional: false, min: 1 },
  { key: 'translationCaptionsCreditsPerMinute', label: 'Captions (credits / min)', optional: false, min: 1 },
  { key: 'translationIndicVoiceCreditsPerMinute', label: 'Indian-language voice (credits / min, optional)', optional: true, min: 1 },
  { key: 'translationMinimumCredits', label: 'Minimum credits to start translation (optional)', optional: true, min: 0 },
  { key: 'translationTrialMinutes', label: 'Free trial minutes', optional: false, min: 0 },
  { key: 'postCallReportCredits', label: 'Post-call report (credits / report)', optional: false, min: 0 },
] as const;
type TKey = (typeof T_FIELDS)[number]['key'];

/** Mirrors the server: participant-minutes × rate, rounded up to whole credits. */
export function exampleCredits(participants: number, minutes: number, perMinute: number) {
  const raw = participants * minutes * perMinute;
  return raw > 0 ? Math.ceil(raw - 1e-6) : 0;
}

export function CreditRatesTab() {
  const handle = useAdminErrorHandler();
  const { data, loading, error } = useResource(getCreditRates, []);
  const [form, setForm] = useState<Record<Key, string> | null>(null);
  const [tForm, setTForm] = useState<Record<TKey, string> | null>(null);
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
    // Only servers with Live Translate send the translation rates.
    const t = data as typeof data & TranslationBillingConfig;
    if (t.translationVoiceCreditsPerMinute !== undefined) {
      const tf = {} as Record<TKey, string>;
      for (const { key } of T_FIELDS) tf[key] = t[key] == null ? '' : String(t[key]);
      setTForm(tf);
    }
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
    if (tForm) {
      const tBody = body as BillingConfigUpdate & TranslationBillingConfig;
      for (const f of T_FIELDS) {
        const v = tForm[f.key].trim();
        if (!v && f.optional) {
          (tBody as Record<string, number | null>)[f.key] = null;
          continue;
        }
        if (!/^\d+$/.test(v) || Number(v) < f.min) {
          return setSaveError(`${f.label.replace(/ \(.*\)$/, '')} must be a whole number of at least ${f.min}.`);
        }
        (tBody as Record<string, number | null>)[f.key] = Number(v);
      }
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

      {tForm && (
        <Panel
          title="Live Translate"
          subtitle="Credits per translated minute, per listener direction (a two-way call has two directions). Rounded up once per direction."
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="translation-rates">
            {T_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={translationHint(f.key, tForm, m)}>
                <input
                  type="number"
                  min={f.min}
                  disabled={!canWrite}
                  placeholder={f.key === 'translationMinimumCredits' ? 'One minute of the chosen mode' : f.optional ? 'Same as voice' : undefined}
                  className={inputCls}
                  value={tForm[f.key]}
                  onChange={(e) => setTForm({ ...tForm, [f.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-[#3D3650] mt-4">
            Changes apply to new translation sessions only — rates are locked when a session starts. Customers are notified of
            rate changes. Per-customer overrides are on the Live Translate tab.
          </p>
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

function translationHint(key: TKey, f: Record<TKey, string>, minutes: number): string | undefined {
  const n = (k: TKey) => Number(f[k]) || 0;
  switch (key) {
    case 'translationVoiceCreditsPerMinute':
      return `A ${minutes}-min two-way voice call ≈ ${formatCredits(translatedCallCredits(minutes, n(key)))} credits.`;
    case 'translationCaptionsCreditsPerMinute':
      return `A ${minutes}-min two-way captioned call ≈ ${formatCredits(translatedCallCredits(minutes, n(key)))} credits.`;
    case 'translationIndicVoiceCreditsPerMinute':
      return f[key].trim()
        ? `Used when both languages are Indian. A ${minutes}-min call ≈ ${formatCredits(translatedCallCredits(minutes, n(key)))} credits.`
        : 'Blank = the voice rate applies to Indian-language pairs too.';
    case 'translationMinimumCredits':
      return 'Blank = one minute of the chosen mode. Calls themselves are never blocked by this.';
    case 'translationTrialMinutes':
      return 'One-time free minutes for accounts whose plan lacks Live Translate. 0 = no trial.';
    case 'postCallReportCredits':
      return 'Charged once per Post-Call Suite report.';
  }
}
