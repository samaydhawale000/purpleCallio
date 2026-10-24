'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
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
    <div className="flex flex-col gap-6 max-w-5xl">
      <PageHeader
        title="Live Translate settings"
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="industry" className="text-sm font-medium text-[#3D3650]">Industry</label>
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
                    <option key={i.id} value={i.id}>{i.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="default-lexicon" className="text-sm font-medium text-[#3D3650]">Default lexicon (PurpleLex)</label>
                <select id="default-lexicon" className={selectCls} value={form.defaultLexiconId} onChange={(e) => set('defaultLexiconId', e.target.value)}>
                  <option value="">None</option>
                  {lexicons.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <p className="text-xs text-[#3D3650]">Used when a call doesn&apos;t pass its own <code className="font-mono">lexiconId</code>.</p>
              </div>
            </div>
          </Card>

          <Card title="Replay of original audio" subtitle="MeaningGuard">
            <Toggle
              id="replay"
              label="Let listeners replay the speaker's original audio"
              checked={form.replayEnabled}
              onChange={(v) => set('replayEnabled', v)}
            />
            <p className="text-xs text-[#3D3650] mt-2 max-w-2xl">
              Off by default. When on, the last phrases of original audio are kept in memory during the call so a listener can hear
              exactly what was said when a translation may not be accurate. Audio is never stored after the call. Both participants
              see a <strong>&quot;Replay enabled&quot;</strong> indicator while it is on.
            </p>
          </Card>

          <Card title="Post-Call Suite" subtitle="Transcript, summary in each participant's language, action items and conversation signals.">
            <div className="flex flex-col gap-4">
              <Toggle
                id="post-call"
                label="Store transcripts and build a report after each translated call"
                checked={form.postCallReportEnabled}
                onChange={(v) => set('postCallReportEnabled', v)}
              />
              <p className="text-xs text-[#3D3650] -mt-2 max-w-2xl">
                Opt-in. Each report uses credits. Personal details are redacted before storage, and transcripts are deleted after the
                retention period.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="retention" className="text-sm font-medium text-[#3D3650]">Transcript retention</label>
                  <select
                    id="retention"
                    className={selectCls}
                    disabled={!form.postCallReportEnabled}
                    value={form.transcriptRetentionDays}
                    onChange={(e) => set('transcriptRetentionDays', e.target.value)}
                  >
                    {[...new Set([...RETENTION_DAYS, Number(form.transcriptRetentionDays)])].sort((a, b) => a - b).map((d) => (
                      <option key={d} value={d}>{d} days</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Toggle
                  id="sentiment"
                  label="Include possible tone in reports"
                  checked={form.sentimentEnabled}
                  disabled={!form.postCallReportEnabled || healthcare}
                  onChange={(v) => set('sentimentEnabled', v)}
                />
                <p className="text-xs text-[#3D3650] mt-1 max-w-2xl">
                  {healthcare
                    ? 'Tone analysis is always off for healthcare projects, to avoid inferring anything about a patient’s state.'
                    : 'Reports describe a “possible tone” per topic with quotes. It is a hint, not a judgement about anyone.'}
                </p>
              </div>
            </div>
          </Card>

          <Card title="CostGuard" subtitle="Limits are checked during the call. The call itself is never ended — only translation steps down.">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Per-call limit (minutes)"
                type="number"
                min={1}
                max={600}
                placeholder="Platform default"
                value={form.defaultMaxMinutes}
                onChange={(e) => set('defaultMaxMinutes', e.target.value)}
                helper="Translated minutes per call (1–600)."
              />
              <Input
                label="Daily budget (credits)"
                type="number"
                min={1}
                placeholder="No limit"
                value={form.dailyBudgetCredits}
                onChange={(e) => set('dailyBudgetCredits', e.target.value)}
              />
              <Input
                label="Monthly budget (credits)"
                type="number"
                min={1}
                placeholder="No limit"
                value={form.monthlyBudgetCredits}
                onChange={(e) => set('monthlyBudgetCredits', e.target.value)}
              />
              <Input
                label="Alert thresholds (%)"
                placeholder="50, 80, 100"
                value={form.alertThresholds}
                onChange={(e) => set('alertThresholds', e.target.value)}
                helper="You get a notification and webhook when a budget crosses each one."
              />
            </div>
            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-[#3D3650] mb-2">When a limit is reached</legend>
              <div className="flex flex-col gap-2">
                <Radio
                  name="onLimit"
                  checked={form.onLimit === 'captions_then_off'}
                  onChange={() => set('onLimit', 'captions_then_off')}
                  label="Switch voice translation to captions, then turn translation off"
                />
                <Radio name="onLimit" checked={form.onLimit === 'off'} onChange={() => set('onLimit', 'off')} label="Turn translation off" />
              </div>
              <p className="text-xs text-[#3D3650] mt-2">Participants are warned at 90% and told when translation changes.</p>
            </fieldset>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={saving}>Save settings</Button>
            {saved && <span role="status" className="text-sm text-emerald-700">Settings saved</span>}
            {saveError && <p role="alert" className="text-sm text-red-600">{saveError}</p>}
          </div>
        </form>
      )}

      {projects && projects.length > 0 && <CostEstimator defaultMinutes={form?.defaultMaxMinutes} />}
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
        className="h-4 w-4 accent-[#7F40E8]"
      />
      <span className="text-sm font-medium text-[#170B2E]">{label}</span>
    </label>
  );
}

function Radio({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2.5 text-sm text-[#170B2E]">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-[#7F40E8]" />
      {label}
    </label>
  );
}

