'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { getCreditRates, updateCreditRates, type BillingConfigUpdate } from '../../../lib/admin-billing';
import {
  MarginRow,
  TranslationBillingConfig,
  TranslationRateOverride,
  dateInput,
  deleteRateOverride,
  fmtInr,
  fmtNumber,
  getMarginReport,
  listRateOverrides,
  saveRateOverride,
} from '../../../lib/translation';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { useCanWrite } from '../../../lib/admin-access';
import { ErrorText, Field, inputCls, linkBtn, Modal, Panel, rowCls, Spinner, Table, tdCls, useAdminErrorHandler, useResource } from './ui';

/** Soniox list prices (server falls back to the same values). */
const SONIOX_DEFAULT_COSTS: Record<string, number> = { 'soniox-voice': 67, 'soniox-captions': 17 };
const RETIRED_ROUTE = /^(sarvam|openai)/;

const whole = (s: string) => /^\d+$/.test(s.trim());

/** Admin → Billing → Live Translate: provider costs, guardrails, margin report and per-customer overrides. */
export function TranslationTab() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const notify = (message: string, type: ToastState['type'] = 'success') => setToast({ id: Date.now(), type, message });
  return (
    <div className="flex flex-col gap-6">
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <CostsPanel notify={notify} />
      <MarginPanel />
      <OverridesPanel notify={notify} />
    </div>
  );
}

// ── Provider costs & guardrails ────────────────────────────
interface CostRow {
  route: string;
  paise: string;
}

function CostsPanel({ notify }: { notify: (m: string) => void }) {
  const handle = useAdminErrorHandler();
  const canWrite = useCanWrite();
  const { data, loading, error } = useResource(getCreditRates, []);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [warn, setWarn] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const cfg = data as (typeof data & TranslationBillingConfig) | null;
  const supported = cfg?.translationVoiceCreditsPerMinute !== undefined;

  useEffect(() => {
    if (!cfg || !supported) return;
    // Soniox is the only route: retired OpenAI/Sarvam entries drop out on the next save.
    const saved = Object.entries(cfg.translationProviderCostsPaise ?? {}).filter(([route]) => !RETIRED_ROUTE.test(route));
    const defaults = Object.entries(SONIOX_DEFAULT_COSTS).filter(([route]) => !saved.some(([r]) => r === route));
    setCosts([...defaults, ...saved].map(([route, paise]) => ({ route, paise: String(paise) })));
    setWarn(String(cfg.translationMarginWarnPercent ?? 40));
    setMaxMinutes(String(cfg.translationDefaultMaxMinutes ?? 60));
    setMaxBudget(String(cfg.translationMaxBudgetCredits ?? ''));
  }, [cfg, supported]);

  if (loading) return <Spinner tall={false} />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!supported) {
    return (
      <Panel title="Live Translate pricing">
        <p className="text-sm text-[#3D3650]">This server does not have Live Translate billing yet.</p>
      </Panel>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaveError('');
    const map: Record<string, number> = {};
    for (const c of costs) {
      const route = c.route.trim();
      if (!route && !c.paise.trim()) continue;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(route)) return setSaveError('Route ids use lowercase letters, numbers and dashes (e.g. soniox-voice).');
      if (!whole(c.paise)) return setSaveError(`Cost for "${route}" must be a whole number of paise.`);
      if (route in map) return setSaveError(`Route "${route}" is listed twice.`);
      map[route] = Number(c.paise);
    }
    if (!whole(warn) || Number(warn) > 100) return setSaveError('Margin warning must be a whole percentage between 0 and 100.');
    if (!whole(maxMinutes) || Number(maxMinutes) < 1 || Number(maxMinutes) > 600) {
      return setSaveError('Default per-call limit must be between 1 and 600 minutes.');
    }
    if (!whole(maxBudget) || Number(maxBudget) < 1) return setSaveError('Maximum project budget must be at least 1 credit.');
    const body: TranslationBillingConfig = {
      translationProviderCostsPaise: map,
      translationMarginWarnPercent: Number(warn),
      translationDefaultMaxMinutes: Number(maxMinutes),
      translationMaxBudgetCredits: Number(maxBudget),
    };
    setSaving(true);
    try {
      await updateCreditRates(body as BillingConfigUpdate);
      notify('Live Translate settings saved');
    } catch (err) {
      setSaveError(handle(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Panel
        title="Provider costs & guardrails"
        subtitle="Provider cost is used only for the margin report below. It is never shown to customers. Customer rates are on the Credits tab."
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-medium text-[#3D3650] mb-2">Provider cost (paise per direction-minute)</p>
            <p className="text-xs text-[#3D3650] mb-2">
              Soniox bills the whole open stream: about 17 paise/min for captions; voice adds speech synthesis (about 67 paise/min).
              These list prices are used when a route has no entry.
            </p>
            <div className="flex flex-col gap-2" data-testid="provider-costs">
              {costs.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    aria-label={`Route ${i + 1}`}
                    className={inputCls}
                    disabled={!canWrite}
                    value={c.route}
                    placeholder="route id"
                    onChange={(e) => setCosts(costs.map((x, j) => (j === i ? { ...x, route: e.target.value } : x)))}
                  />
                  <input
                    aria-label={`Cost for ${c.route || `route ${i + 1}`} (paise)`}
                    type="number"
                    min={0}
                    className={`${inputCls} w-32`}
                    disabled={!canWrite}
                    value={c.paise}
                    onChange={(e) => setCosts(costs.map((x, j) => (j === i ? { ...x, paise: e.target.value } : x)))}
                  />
                  {canWrite && (
                    <button type="button" aria-label={`Remove ${c.route || 'route'}`} onClick={() => setCosts(costs.filter((_, j) => j !== i))} className="p-2 text-[#3D3650] hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {canWrite && (
                <button type="button" className={`${linkBtn} self-start inline-flex items-center gap-1`} onClick={() => setCosts([...costs, { route: '', paise: '' }])}>
                  <Plus size={12} /> Add route
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
            <Field label="Margin warning below (%)" hint="Routes and pairs under this gross margin are flagged.">
              <input type="number" min={0} max={100} disabled={!canWrite} className={inputCls} value={warn} onChange={(e) => setWarn(e.target.value)} />
            </Field>
            <Field label="Default per-call limit (minutes)" hint="Used when neither the call nor the project sets one.">
              <input type="number" min={1} max={600} disabled={!canWrite} className={inputCls} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} />
            </Field>
            <Field label="Maximum project budget (credits)" hint="Customer daily/monthly budgets are clamped to this.">
              <input type="number" min={1} disabled={!canWrite} className={inputCls} value={maxBudget} onChange={(e) => setMaxBudget(e.target.value)} />
            </Field>
          </div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-3 mt-5">
            <Button type="submit" loading={saving}>Save Live Translate settings</Button>
            <ErrorText>{saveError}</ErrorText>
          </div>
        )}
      </Panel>
    </form>
  );
}

// ── Margin report ──────────────────────────────────────────
function MarginPanel() {
  const [from, setFrom] = useState(dateInput(29));
  const [to, setTo] = useState(dateInput(0));
  const { data, loading, error } = useResource(() => getMarginReport({ from, to }), [from, to]);
  const low = data ? [...data.byRoute, ...data.byPair].filter((r) => r.warn).length : 0;

  return (
    <Panel
      title="Margin report"
      subtitle="Revenue at the credit value used for AI, against provider cost."
      actions={
        <div className="flex items-end gap-2">
          <Field label="From">
            <input type="date" className={inputCls} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className={inputCls} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      }
    >
      {loading && !data ? (
        <Spinner tall={false} />
      ) : error ? (
        <ErrorText>{error}</ErrorText>
      ) : data ? (
        <div className="flex flex-col gap-5" data-testid="margin-report">
          {low > 0 && (
            <p role="alert" className="text-sm text-amber-800 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              {low} {low === 1 ? 'row is' : 'rows are'} below the {data.warnPercent ?? 'configured'}
              {data.warnPercent != null ? '%' : ''} margin warning. Consider raising the rate or changing the route.
            </p>
          )}
          <MarginTable title="By route" rows={data.byRoute} labelKey="route" />
          <MarginTable title="By language pair" rows={data.byPair} labelKey="pair" />
        </div>
      ) : null}
    </Panel>
  );
}

function MarginTable({ title, rows, labelKey }: { title: string; rows: MarginRow[]; labelKey: 'route' | 'pair' }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[#170B2E] mb-2">{title}</p>
      <Table
        headers={[labelKey === 'route' ? 'Route' : 'Pair', 'Minutes', 'Revenue (credits)', 'Revenue', 'Provider cost', 'Margin']}
        empty={rows.length === 0 ? 'No translated minutes in this period.' : undefined}
      >
        {rows.map((r) => (
          <tr key={`${r[labelKey]}-${r.route ?? ''}`} className={rowCls}>
            <td className={`${tdCls} font-mono text-xs text-[#170B2E]`}>{r[labelKey] ?? '—'}</td>
            <td className={tdCls}>{r.minutes != null ? fmtNumber(r.minutes, 1) : '—'}</td>
            <td className={tdCls}>{fmtNumber(r.revenueCredits)}</td>
            <td className={tdCls}>{fmtInr(r.revenueInr)}</td>
            <td className={tdCls}>{fmtInr(r.providerCostInr)}</td>
            <td className={tdCls}>
              <span className="tabular-nums">{r.marginPercent == null ? '—' : `${fmtNumber(r.marginPercent, 1)}%`}</span>{' '}
              {r.warn && <Badge variant="warning">Low margin</Badge>}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ── Per-customer overrides ─────────────────────────────────
interface OverrideForm {
  userId: string;
  voice: string;
  captions: string;
  report: string;
  note: string;
}

const emptyOverride: OverrideForm = { userId: '', voice: '', captions: '', report: '', note: '' };
const optNum = (v: string) => (v.trim() ? Number(v) : null);

function OverridesPanel({ notify }: { notify: (m: string) => void }) {
  const handle = useAdminErrorHandler();
  const canWrite = useCanWrite();
  const { data, loading, error, reload } = useResource(listRateOverrides, []);
  const [editing, setEditing] = useState<{ form: OverrideForm; isNew: boolean } | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');

  const edit = (o?: TranslationRateOverride) =>
    setEditing({
      isNew: !o,
      form: o
        ? {
            userId: o.userId,
            voice: o.voiceCreditsPerMinute == null ? '' : String(o.voiceCreditsPerMinute),
            captions: o.captionsCreditsPerMinute == null ? '' : String(o.captionsCreditsPerMinute),
            report: o.postCallReportCredits == null ? '' : String(o.postCallReportCredits),
            note: o.note ?? '',
          }
        : emptyOverride,
    });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const f = editing.form;
    setSaveError('');
    if (!f.userId.trim()) return setSaveError('Enter the customer ID.');
    for (const [label, v] of [['Voice rate', f.voice], ['Captions rate', f.captions], ['Report credits', f.report]] as const) {
      if (v.trim() && !whole(v)) return setSaveError(`${label} must be a whole number, or blank to use the standard rate.`);
    }
    if (!f.voice.trim() && !f.captions.trim() && !f.report.trim()) return setSaveError('Set at least one rate to override.');
    setSaving(true);
    try {
      await saveRateOverride(f.userId.trim(), {
        voiceCreditsPerMinute: optNum(f.voice),
        captionsCreditsPerMinute: optNum(f.captions),
        postCallReportCredits: optNum(f.report),
        note: f.note.trim() || null,
      });
      setEditing(null);
      notify('Override saved — applies to new translation sessions');
      reload();
    } catch (err) {
      setSaveError(handle(err, 'Failed to save the override'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (o: TranslationRateOverride) => {
    const who = o.user?.email ?? o.userId;
    if (!confirm(`Remove the Live Translate override for ${who}? Standard rates apply to their new sessions.`)) return;
    setBusy(o.userId);
    setRowError('');
    try {
      await deleteRateOverride(o.userId);
      notify('Override removed');
      reload();
    } catch (err) {
      setRowError(handle(err, 'Failed to remove the override'));
    } finally {
      setBusy(null);
    }
  };

  const set = (k: keyof OverrideForm, v: string) => editing && setEditing({ ...editing, form: { ...editing.form, [k]: v } });

  return (
    <Panel
      title="Per-customer overrides"
      subtitle="Custom Live Translate rates for a customer. Blank fields use the standard rate."
      actions={canWrite ? <Button size="sm" onClick={() => edit()}><Plus size={13} className="mr-1" /> Add override</Button> : undefined}
    >
      {loading && !data ? (
        <Spinner tall={false} />
      ) : error ? (
        <ErrorText>{error}</ErrorText>
      ) : (
        <>
          <ErrorText>{rowError}</ErrorText>
          <Table
            headers={['Customer', 'Voice / min', 'Captions / min', 'Report', 'Note', '']}
            empty={(data ?? []).length === 0 ? 'No overrides. Every customer pays the standard rates.' : undefined}
          >
            {(data ?? []).map((o) => (
              <tr key={o.userId} className={rowCls}>
                <td className={tdCls}>
                  <p className="text-[#170B2E]">{o.user?.companyName || o.user?.name || o.user?.email || o.userId}</p>
                  {o.user?.email && <p className="text-xs">{o.user.email}</p>}
                </td>
                <td className={tdCls}>{o.voiceCreditsPerMinute ?? 'Standard'}</td>
                <td className={tdCls}>{o.captionsCreditsPerMinute ?? 'Standard'}</td>
                <td className={tdCls}>{o.postCallReportCredits ?? 'Standard'}</td>
                <td className={tdCls}>{o.note ?? ''}</td>
                <td className={`${tdCls} whitespace-nowrap`}>
                  {canWrite && (
                    <div className="flex gap-3">
                      <button className={linkBtn} onClick={() => edit(o)} aria-label={`Edit override for ${o.user?.email ?? o.userId}`}>Edit</button>
                      <button className={linkBtn} disabled={busy === o.userId} onClick={() => remove(o)} aria-label={`Remove override for ${o.user?.email ?? o.userId}`}>
                        Remove
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {editing && (
        <Modal title={editing.isNew ? 'Add Live Translate override' : 'Edit Live Translate override'} onClose={() => setEditing(null)}>
          <form onSubmit={save} noValidate className="flex flex-col gap-4">
            <Field label="Customer ID" hint="The customer's user ID (from Admin → Customers).">
              <input className={inputCls} disabled={!editing.isNew} value={editing.form.userId} onChange={(e) => set('userId', e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Voice (credits / min)">
                <input type="number" min={0} className={inputCls} placeholder="Standard" value={editing.form.voice} onChange={(e) => set('voice', e.target.value)} />
              </Field>
              <Field label="Captions (credits / min)">
                <input type="number" min={0} className={inputCls} placeholder="Standard" value={editing.form.captions} onChange={(e) => set('captions', e.target.value)} />
              </Field>
              <Field label="Report (credits)">
                <input type="number" min={0} className={inputCls} placeholder="Standard" value={editing.form.report} onChange={(e) => set('report', e.target.value)} />
              </Field>
            </div>
            <Field label="Note (internal)">
              <input className={inputCls} maxLength={500} value={editing.form.note} onChange={(e) => set('note', e.target.value)} />
            </Field>
            <p className="text-xs text-[#3D3650]">Applies to new translation sessions; sessions in progress keep their locked rate.</p>
            <div className="flex items-center gap-3">
              <Button type="submit" loading={saving}>Save override</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <ErrorText>{saveError}</ErrorText>
            </div>
          </form>
        </Modal>
      )}
    </Panel>
  );
}
