'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import {
  AGENT_DESCRIPTION_MAX_LENGTH,
  AGENT_NAME_MAX_LENGTH,
  AI_LANGUAGES,
  AgentFormErrors,
  AgentFormValues,
  INSTRUCTIONS_MAX_LENGTH,
  MIN_DURATION_SECONDS,
  DEFAULT_AI_PROVIDER,
  WELCOME_MESSAGE_MAX_LENGTH,
  providerLabel,
  validateAgentForm,
  voicesFor,
} from '../../../lib/ai';
import { Select, TextArea, TextInput } from './fields';

interface Props {
  initial: AgentFormValues;
  submitLabel: string;
  /** Resolves on success; reject or return messages to show them above the form. */
  onSubmit: (values: AgentFormValues) => Promise<string[] | void>;
  /** Rendered above the name field (e.g. the project picker on create). */
  header?: ReactNode;
  disabled?: boolean;
  /** Providers with a configured key (`GET /ai/status`); omit to hide the select. */
  providers?: string[];
}

/**
 * Agent configuration: name and description are edited in place; every
 * other field change creates a new version on the server.
 */
export function AgentForm({ initial, submitLabel, onSubmit, header, disabled, providers }: Props) {
  const [values, setValues] = useState<AgentFormValues>(initial);
  const [errors, setErrors] = useState<AgentFormErrors>({});
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof AgentFormValues>(key: K, value: AgentFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = validateAgentForm(values);
    setErrors(next);
    setServerErrors([]);
    if (Object.values(next).some(Boolean)) return;

    setSaving(true);
    try {
      const messages = await onSubmit(values);
      if (messages && messages.length > 0) setServerErrors(messages);
    } finally {
      setSaving(false);
    }
  }

  function setProvider(provider: string) {
    setValues((v) => ({
      ...v,
      provider,
      // Voices are per provider; fall back to the default for a foreign one.
      voice: voicesFor(provider).includes(v.voice) ? v.voice : '',
    }));
    if (errors.provider || errors.voice) setErrors((e) => ({ ...e, provider: undefined, voice: undefined }));
  }

  const instructionsLength = values.instructions.length;
  const provider = values.provider || DEFAULT_AI_PROVIDER;
  // Keep the agent's current provider selectable even if its key was removed.
  const providerOptions = providers
    ? Array.from(new Set([...providers, ...(values.provider ? [values.provider] : [])]))
    : [];
  const showProvider = providerOptions.length > 0;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {serverErrors.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverErrors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}
      {header}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextInput
          id="agent-name"
          label="Name"
          value={values.name}
          maxLength={AGENT_NAME_MAX_LENGTH}
          placeholder="e.g. Support agent"
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          disabled={disabled}
        />
        <TextInput
          id="agent-description"
          label="Description (optional)"
          value={values.description}
          maxLength={AGENT_DESCRIPTION_MAX_LENGTH}
          placeholder="Shown only in your dashboard"
          onChange={(e) => set('description', e.target.value)}
          error={errors.description}
          disabled={disabled}
        />
      </div>
      <TextArea
        id="agent-instructions"
        label="Instructions"
        rows={10}
        value={values.instructions}
        placeholder="You are a friendly support agent for Acme. Help callers track orders…"
        onChange={(e) => set('instructions', e.target.value)}
        error={errors.instructions}
        disabled={disabled}
        helper={
          <span className={instructionsLength > INSTRUCTIONS_MAX_LENGTH ? 'text-red-600' : undefined}>
            {instructionsLength.toLocaleString('en-US')} / {INSTRUCTIONS_MAX_LENGTH.toLocaleString('en-US')} characters
          </span>
        }
      />
      <TextArea
        id="agent-greeting"
        label="Greeting (optional)"
        rows={2}
        value={values.welcomeMessage}
        maxLength={WELCOME_MESSAGE_MAX_LENGTH}
        placeholder="Hi! How can I help you today?"
        onChange={(e) => set('welcomeMessage', e.target.value)}
        error={errors.welcomeMessage}
        disabled={disabled}
        helper="What the agent says when the call connects."
      />
      <div className={`grid grid-cols-1 gap-4 ${showProvider ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}`}>
        {showProvider && (
          <Select
            id="agent-provider"
            label="Provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            error={errors.provider}
            disabled={disabled}
          >
            {providerOptions.map((p) => (
              <option key={p} value={p}>
                {providerLabel(p)}
                {providers?.includes(p) ? '' : ' (not configured)'}
              </option>
            ))}
          </Select>
        )}
        <Select
          id="agent-language"
          label="Language"
          value={values.language}
          onChange={(e) => set('language', e.target.value)}
          error={errors.language}
          disabled={disabled}
        >
          {AI_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </Select>
        <Select
          id="agent-voice"
          label="Voice"
          value={values.voice}
          onChange={(e) => set('voice', e.target.value)}
          error={errors.voice}
          disabled={disabled}
        >
          <option value="">Default</option>
          {voicesFor(provider).map((v) => (
            <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
          ))}
        </Select>
        <TextInput
          id="agent-max-duration"
          label="Max duration (seconds)"
          type="number"
          inputMode="numeric"
          min={MIN_DURATION_SECONDS}
          step={1}
          value={values.maxDurationSeconds}
          onChange={(e) => set('maxDurationSeconds', e.target.value)}
          error={errors.maxDurationSeconds}
          disabled={disabled}
          helper="Capped by your account's per-call limit."
        />
      </div>
      <div>
        <Button type="submit" loading={saving} disabled={disabled}>{submitLabel}</Button>
      </div>
    </form>
  );
}
