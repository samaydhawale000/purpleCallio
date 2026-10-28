'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import {
  INDUSTRIES,
  Lexicon,
  RETENTION_DAYS,
  TranslationSettings,
  getSettings,
  listLexicons,
  translationErrorText,
  updateSettings,
} from '../../../lib/translation';
import { buttonCls, inputCls } from '../../_ui';
import { Form, buildSettingsPatch, toForm } from '../_components/settings-form';
import { CostEstimator } from '../_components/CostEstimator';
import {
  Card,
  ErrorBox,
  Loading,
  NoProjects,
  PageHeader,
  ProjectPicker,
  TranslationNav,
  selectCls,
  useProjects,
} from '../_components/shared';

export default function TranslationSettingsPage() {
  const { projects, projectId, setProjectId, error: projectsError, loading: projectsLoading } = useProjects();
  const [form, setForm] = useState<Form | null>(null);
  const [lexicons, setLexicons] = useState<Lexicon[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    setForm(null);
    setLoadError('');
    setSaved(false);
    Promise.all([getSettings(projectId), listLexicons(projectId).catch(() => [] as Lexicon[])])
      .then(([s, lex]) => {
        setForm(toForm(s));
        setLexicons(Array.isArray(lex) ? lex : []);
      })
      .catch((e) => setLoadError(translationErrorText(e, 'Could not load translation settings. Please try again.')));
  }, [projectId]);

  useEffect(load, [load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaveError('');
    const body = buildSettingsPatch(form);
    if (typeof body === 'string') return setSaveError(body);
    setSaving(true);
    try {
      const updated = await updateSettings(projectId, body);
      setForm(toForm({ ...(body as TranslationSettings), ...(updated ?? {}) }));
      setSaved(true);
    } catch (err) {
      setSaveError(translationErrorText(err, 'Could not save the settings. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const healthcare = form?.industry === 'healthcare';

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Settings"
        subtitle="Defaults for every translated call in this project. Calls can override some of them through the API."
        actions={projects && projects.length > 0 ? <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} /> : undefined}
      />
      <TranslationNav />

      {projectsLoading ? (
        <Loading label="Loading projects…" />
      ) : projectsError ? (
        <ErrorBox>Could not load your projects. Please refresh the page.</ErrorBox>
      ) : !projects?.length ? (
        <NoProjects />
      ) : loadError ? (
        <ErrorBox onRetry={load}>{loadError}</ErrorBox>
      ) : !form ? (
        <Loading label="Loading settings…" />
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <Card title="Call context" subtitle="Helps translation pick the right vocabulary.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="industry" label="Industry">
                <select
                  id="industry"
                  className={selectCls}
                  value={form.industry}
                  onChange={(e) => {
                    const industry = e.target.value;
                    setForm((f) => (f ? { ...f, industry, sentimentEnabled: industry === 'healthcare' ? false : f.sentimentEnabled } : f));
                    setSaved(false);
                  }}
                >
                  <option value="">Not set</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="default-lexicon"
                label="Default lexicon (PurpleLex)"
                hint={
                  <>
                    Used when a call doesn&apos;t pass its own <code className="font-mono">lexiconId</code>.
                  </>
                }
              >
                <select id="default-lexicon" className={selectCls} value={form.defaultLexiconId} onChange={(e) => set('defaultLexiconId', e.target.value)}>
                  <option value="">None</option>
                  {lexicons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <Card title="Replay" subtitle="Let listeners hear exactly what was said.">
            <Toggle
              id="replay"
              label="Let listeners replay the speaker's original audio"
              checked={form.replayEnabled}
              onChange={(v) => set('replayEnabled', v)}
            />
            <p className="mt-2 max-w-2xl text-xs text-[#6B6478]">
              Off by default. Recent original audio is kept in memory during the call only and never stored afterwards. Both
              participants see a <strong className="font-medium text-[#170B2E]">&quot;Replay enabled&quot;</strong> indicator while it is on.
            </p>
          </Card>

          <Card title="Post-call reports" subtitle="Transcript, summary in each participant's language and action items.">
            <div className="flex flex-col gap-5">
              <div>
                <Toggle
                  id="post-call"
                  label="Store transcripts and build a report after each translated call"
                  checked={form.postCallReportEnabled}
                  onChange={(v) => set('postCallReportEnabled', v)}
                />
                <p className="mt-1 max-w-2xl text-xs text-[#6B6478]">
                  Each report uses credits. Personal details are redacted before storage, and transcripts are deleted after the retention period.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="retention" label="Transcript retention">
                  <select
                    id="retention"
                    className={selectCls}
                    disabled={!form.postCallReportEnabled}
                    value={form.transcriptRetentionDays}
                    onChange={(e) => set('transcriptRetentionDays', e.target.value)}
                  >
                    {[...new Set([...RETENTION_DAYS, Number(form.transcriptRetentionDays)])]
                      .sort((a, b) => a - b)
                      .map((d) => (
                        <option key={d} value={d}>
                          {d} days
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <div>
                <Toggle
                  id="sentiment"
                  label="Include possible tone in reports"
                  checked={form.sentimentEnabled}
                  disabled={!form.postCallReportEnabled || healthcare}
                  onChange={(v) => set('sentimentEnabled', v)}
                />
                <p className="mt-1 max-w-2xl text-xs text-[#6B6478]">
                  {healthcare
                    ? 'Tone analysis is always off for healthcare projects, to avoid inferring anything about a patient’s state.'
                    : 'Adds a one-word “possible tone” per speaker. It is a hint, not a judgement about anyone.'}
                </p>
              </div>
            </div>
          </Card>

          <Card title="Budget limits" subtitle="Checked during the call. The call itself is never ended, only translation steps down.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="max-minutes" label="Per-call limit (minutes)" hint="Translated minutes per call (1–600).">
                <input
                  id="max-minutes"
                  type="number"
                  min={1}
                  max={600}
                  className={inputCls}
                  placeholder="Platform default"
                  value={form.defaultMaxMinutes}
                  onChange={(e) => set('defaultMaxMinutes', e.target.value)}
                />
              </Field>
              <Field id="alert-thresholds" label="Alert thresholds (%)" hint="You get a notification and webhook when a budget crosses each one.">
                <input
                  id="alert-thresholds"
                  className={inputCls}
                  placeholder="50, 80, 100"
                  value={form.alertThresholds}
                  onChange={(e) => set('alertThresholds', e.target.value)}
                />
              </Field>
              <Field id="daily-budget" label="Daily budget (credits)">
                <input
                  id="daily-budget"
                  type="number"
                  min={1}
                  className={inputCls}
                  placeholder="No limit"
                  value={form.dailyBudgetCredits}
                  onChange={(e) => set('dailyBudgetCredits', e.target.value)}
                />
              </Field>
              <Field id="monthly-budget" label="Monthly budget (credits)">
                <input
                  id="monthly-budget"
                  type="number"
                  min={1}
                  className={inputCls}
                  placeholder="No limit"
                  value={form.monthlyBudgetCredits}
                  onChange={(e) => set('monthlyBudgetCredits', e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-5 border-t border-[#ECE8F2] pt-5">
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-[#170B2E]">When a limit is reached</legend>
              <div className="flex flex-col gap-2">
                <Radio
                  name="onLimit"
                  checked={form.onLimit === 'captions_then_off'}
                  onChange={() => set('onLimit', 'captions_then_off')}
                  label="Switch voice translation to captions, then turn translation off"
                />
                <Radio name="onLimit" checked={form.onLimit === 'off'} onChange={() => set('onLimit', 'off')} label="Turn translation off" />
              </div>
              <p className="mt-2 text-xs text-[#6B6478]">Participants are warned at 90% and told when translation changes.</p>
            </fieldset>
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={buttonCls('primary')} disabled={saving}>
              Save settings
            </button>
            {saved && (
              <span role="status" className="text-sm text-emerald-700">
                Settings saved
              </span>
            )}
            {saveError && (
              <p role="alert" className="text-sm text-red-600">
                {saveError}
              </p>
            )}
          </div>
        </form>
      )}

      {projects && projects.length > 0 && (
        <div className="mt-10">
          <CostEstimator defaultMinutes={form?.defaultMaxMinutes} />
        </div>
      )}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-[#170B2E]">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[#6B6478]">{hint}</p>}
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className={`flex items-center gap-2.5 ${disabled ? 'opacity-60' : ''}`}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#6D28D9]"
      />
      <span className="text-sm font-medium text-[#170B2E]">{label}</span>
    </label>
  );
}

function Radio({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2.5 text-sm text-[#170B2E]">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-[#6D28D9]" />
      {label}
    </label>
  );
}
