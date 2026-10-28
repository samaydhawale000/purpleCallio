'use client';

import { FormEvent, useState } from 'react';
import { Check, Copy, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  AiAgentTool,
  AiToolMethod,
  AiToolTestResult,
  MAX_TOOL_TIMEOUT_MS,
  MIN_TOOL_TIMEOUT_MS,
  TOOL_DESCRIPTION_MAX_LENGTH,
  TOOL_NAME,
  apiErrorMessages,
  isToolEndpointUrl,
  sampleToolArguments,
  toolErrorText,
} from '../../../lib/ai';
import { Empty, Panel, Pill, buttonCls, type Tone } from '../../_ui';
import { ActionButton, Checkbox, Select, TextArea, TextInput } from './fields';

interface ToolFormValues {
  name: string;
  description: string;
  parametersSchema: string;
  endpointUrl: string;
  method: AiToolMethod;
  enabled: boolean;
  requiresConfirmation: boolean;
  timeoutMs: string;
}

type ToolFormErrors = Partial<Record<keyof ToolFormValues, string>>;

const EXAMPLE_SCHEMA = JSON.stringify(
  {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'The order number the caller gives' },
    },
    required: ['orderId'],
  },
  null,
  2,
);

const EMPTY_TOOL: ToolFormValues = {
  name: '',
  description: '',
  parametersSchema: EXAMPLE_SCHEMA,
  endpointUrl: '',
  method: 'POST',
  enabled: true,
  requiresConfirmation: false,
  timeoutMs: '',
};

function toolToForm(tool: AiAgentTool): ToolFormValues {
  return {
    name: tool.name,
    description: tool.description,
    parametersSchema: JSON.stringify(tool.parametersSchema, null, 2),
    endpointUrl: tool.endpointUrl,
    method: tool.method,
    enabled: tool.enabled,
    requiresConfirmation: tool.requiresConfirmation,
    timeoutMs: String(tool.timeoutMs),
  };
}

/** Client-side checks; the API validates the schema subset itself. */
function validateTool(values: ToolFormValues): { errors: ToolFormErrors; schema?: unknown } {
  const errors: ToolFormErrors = {};
  if (!TOOL_NAME.test(values.name)) {
    errors.name = 'Start with a letter; use only letters, digits and underscores (max 64).';
  }
  if (!values.description.trim()) errors.description = 'Description is required.';
  if (!isToolEndpointUrl(values.endpointUrl)) errors.endpointUrl = 'Endpoint URL must be an https:// URL.';
  if (values.timeoutMs.trim()) {
    const t = Number(values.timeoutMs);
    if (!Number.isInteger(t) || t < MIN_TOOL_TIMEOUT_MS || t > MAX_TOOL_TIMEOUT_MS) {
      errors.timeoutMs = `Timeout must be between ${MIN_TOOL_TIMEOUT_MS} and ${MAX_TOOL_TIMEOUT_MS} ms.`;
    }
  }
  let schema: unknown;
  try {
    schema = JSON.parse(values.parametersSchema);
  } catch {
    errors.parametersSchema = 'Parameters schema must be valid JSON.';
  }
  return { errors, schema };
}

function toolPayload(values: ToolFormValues, schema: unknown) {
  return {
    name: values.name,
    description: values.description.trim(),
    parametersSchema: schema,
    endpointUrl: values.endpointUrl.trim(),
    method: values.method,
    enabled: values.enabled,
    requiresConfirmation: values.requiresConfirmation,
    ...(values.timeoutMs.trim() ? { timeoutMs: Number(values.timeoutMs) } : {}),
  };
}

function ToolForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ToolFormValues;
  submitLabel: string;
  onSubmit: (payload: ReturnType<typeof toolPayload>) => Promise<string[] | void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<ToolFormErrors>({});
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ToolFormValues>(key: K, value: ToolFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { errors: next, schema } = validateTool(values);
    setErrors(next);
    setServerErrors([]);
    if (Object.values(next).some(Boolean)) return;
    setSaving(true);
    try {
      const messages = await onSubmit(toolPayload(values, schema));
      if (messages && messages.length > 0) setServerErrors(messages);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-[#F7F6FA] p-5">
      {serverErrors.length > 0 && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverErrors.map((m) => (
            <p key={m} className="break-words">{m}</p>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextInput
          id="tool-name"
          label="Name"
          value={values.name}
          placeholder="getOrderStatus"
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <TextInput
          id="tool-endpoint"
          label="Endpoint URL"
          value={values.endpointUrl}
          placeholder="https://api.example.com/tools/order-status"
          onChange={(e) => set('endpointUrl', e.target.value)}
          error={errors.endpointUrl}
        />
      </div>
      <TextArea
        id="tool-description"
        label="Description"
        rows={2}
        maxLength={TOOL_DESCRIPTION_MAX_LENGTH}
        value={values.description}
        placeholder="Looks up the shipping status of an order."
        onChange={(e) => set('description', e.target.value)}
        error={errors.description}
        helper="The agent reads this to decide when to call the tool."
      />
      <TextArea
        id="tool-schema"
        label="Parameters schema (JSON)"
        rows={9}
        spellCheck={false}
        className="font-mono text-xs"
        value={values.parametersSchema}
        onChange={(e) => set('parametersSchema', e.target.value)}
        error={errors.parametersSchema}
        helper="An object with flat string, number, integer or boolean properties (optional enum and description)."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select id="tool-method" label="Method" value={values.method} onChange={(e) => set('method', e.target.value as AiToolMethod)}>
          <option value="POST">POST</option>
          <option value="GET">GET</option>
        </Select>
        <TextInput
          id="tool-timeout"
          label="Timeout (ms, optional)"
          type="number"
          min={MIN_TOOL_TIMEOUT_MS}
          max={MAX_TOOL_TIMEOUT_MS}
          value={values.timeoutMs}
          onChange={(e) => set('timeoutMs', e.target.value)}
          error={errors.timeoutMs}
          helper="Capped by the server's tool timeout."
        />
      </div>
      <div className="flex flex-col gap-2">
        <Checkbox label="Enabled" checked={values.enabled} onChange={(v) => set('enabled', v)} />
        <Checkbox
          label="Requires confirmation"
          helper="The caller must approve each call before it runs."
          checked={values.requiresConfirmation}
          onChange={(v) => set('requiresConfirmation', v)}
        />
      </div>
      <div className="flex gap-3">
        <ActionButton type="submit" loading={saving}>{submitLabel}</ActionButton>
        <ActionButton variant="secondary" onClick={onCancel}>Cancel</ActionButton>
      </div>
    </form>
  );
}

const TEST_STATUS: Record<AiToolTestResult['status'], { label: string; tone: Tone }> = {
  SUCCESS: { label: 'Success', tone: 'success' },
  TIMEOUT: { label: 'Timed out', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  REJECTED: { label: 'Rejected', tone: 'warning' },
  UNCONFIRMED: { label: 'Not confirmed', tone: 'warning' },
};

/** Sends sample arguments through the server's tool gateway (signed, SSRF-checked). */
function ToolTester({ agentId, tool, onClose }: { agentId: string; tool: AiAgentTool; onClose: () => void }) {
  const [args, setArgs] = useState(() => JSON.stringify(sampleToolArguments(tool.parametersSchema), null, 2));
  const [argsError, setArgsError] = useState<string | null>(null);
  const [result, setResult] = useState<AiToolTestResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args);
    } catch {
      parsed = undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setArgsError('Arguments must be a JSON object.');
      return;
    }
    setArgsError(null);
    setRequestError(null);
    setResult(null);
    setSending(true);
    try {
      const res = await api.post(`/ai/agents/${agentId}/tools/${tool.id}/test`, { arguments: parsed });
      setResult(res.data as AiToolTestResult);
    } catch (e) {
      setRequestError(apiErrorMessages(e, 'The test call could not be sent.')[0]);
    } finally {
      setSending(false);
    }
  }

  const status = result ? TEST_STATUS[result.status] : null;

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl bg-[#F7F6FA] p-4" data-testid="tool-tester">
      <TextArea
        id={`tool-test-args-${tool.id}`}
        label="Sample arguments (JSON)"
        rows={5}
        spellCheck={false}
        className="font-mono text-xs"
        value={args}
        onChange={(e) => setArgs(e.target.value)}
        error={argsError ?? undefined}
        helper="Sent to your endpoint with sessionId null and test: true, signed like a real call."
      />
      <div className="flex gap-2">
        <ActionButton small onClick={send} loading={sending}>
          Send test call
        </ActionButton>
        <ActionButton small variant="secondary" onClick={onClose}>
          Close
        </ActionButton>
      </div>
      {requestError && (
        <p role="alert" className="text-sm text-red-700">
          {requestError}
        </p>
      )}
      {result && status && (
        <div className="flex flex-col gap-2" data-testid="tool-test-result">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B6478]">
            <Pill tone={status.tone}>{status.label}</Pill>
            <span>{result.latencyMs} ms</span>
            {result.httpStatus !== null && <span>HTTP {result.httpStatus}</span>}
          </div>
          {result.errorCode && <p className="text-sm text-red-700">{toolErrorText(result.errorCode)}</p>}
          {result.errors?.map((m) => (
            <p key={m} className="text-xs text-red-700 font-mono">
              {m}
            </p>
          ))}
          {result.responsePreview !== null && (
            <pre className="max-h-64 overflow-auto rounded-lg border border-[#ECE8F2] bg-white p-3 text-xs font-mono text-[#170B2E] whitespace-pre-wrap break-all">
              {result.responsePreview || '(empty response)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolsPanel({
  agentId,
  tools,
  onChange,
}: {
  agentId: string;
  tools: AiAgentTool[];
  onChange: (tools: AiAgentTool[]) => void;
}) {
  const [mode, setMode] = useState<{ kind: 'create' } | { kind: 'edit'; tool: AiAgentTool } | null>(null);
  const [secret, setSecret] = useState<{ toolName: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  async function create(payload: ReturnType<typeof toolPayload>) {
    try {
      const res = await api.post(`/ai/agents/${agentId}/tools`, payload);
      const { signingSecret, ...tool } = res.data as AiAgentTool;
      onChange([...tools, tool]);
      if (signingSecret) setSecret({ toolName: tool.name, value: signingSecret });
      setMode(null);
    } catch (e) {
      return apiErrorMessages(e, 'Failed to create tool');
    }
  }

  async function update(tool: AiAgentTool, payload: ReturnType<typeof toolPayload>) {
    try {
      const res = await api.patch(`/ai/agents/${agentId}/tools/${tool.id}`, payload);
      onChange(tools.map((t) => (t.id === tool.id ? res.data : t)));
      setMode(null);
    } catch (e) {
      return apiErrorMessages(e, 'Failed to save tool');
    }
  }

  async function remove(tool: AiAgentTool) {
    if (!confirm(`Delete tool "${tool.name}"? The agent will no longer be able to call it.`)) return;
    setBusy(tool.id);
    try {
      await api.delete(`/ai/agents/${agentId}/tools/${tool.id}`);
      onChange(tools.filter((t) => t.id !== tool.id));
    } catch (e) {
      alert(apiErrorMessages(e, 'Failed to delete tool')[0]);
    } finally {
      setBusy(null);
    }
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-[13px] text-[#6B6478]">
          Tools let the agent call your HTTPS endpoints during a conversation. Each request is signed with the
          tool&apos;s signing secret.
        </p>
        {!mode && (
          <ActionButton small onClick={() => setMode({ kind: 'create' })}>
            <Plus size={14} /> Add tool
          </ActionButton>
        )}
      </div>

      {secret && (
        <Panel>
          <p className="mb-1 text-sm font-medium text-[#170B2E]">Signing secret for {secret.toolName}</p>
          <p className="mb-3 text-xs text-amber-700">
            Copy it now. You won&apos;t be able to see it again. Use it to verify the X-PurpleCallio-Signature header.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-[#ECE8F2] bg-white px-3 py-2.5 font-mono text-xs text-[#170B2E]">
              {secret.value}
            </code>
            <button
              onClick={copySecret}
              className={buttonCls('secondary', 'px-2.5')}
              title="Copy"
              aria-label="Copy signing secret"
            >
              {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
            </button>
          </div>
          <div className="mt-3">
            <ActionButton variant="secondary" small onClick={() => setSecret(null)}>I&apos;ve saved it</ActionButton>
          </div>
        </Panel>
      )}

      {mode?.kind === 'create' && (
        <ToolForm initial={EMPTY_TOOL} submitLabel="Create tool" onSubmit={create} onCancel={() => setMode(null)} />
      )}

      {tools.length === 0 && mode?.kind !== 'create' ? (
        <Empty title="No tools yet" body="Add one to let the agent look things up or take actions." />
      ) : (
        tools.length > 0 && (
          <div className="divide-y divide-[#F2EFF6] overflow-hidden rounded-xl border border-[#ECE8F2] bg-white">
            {tools.map((tool) =>
              mode?.kind === 'edit' && mode.tool.id === tool.id ? (
                <div key={tool.id} className="p-4">
                  <ToolForm
                    initial={toolToForm(tool)}
                    submitLabel="Save tool"
                    onSubmit={(payload) => update(tool, payload)}
                    onCancel={() => setMode(null)}
                  />
                </div>
              ) : (
                <div key={tool.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-[13px] font-medium text-[#170B2E]">{tool.name}</p>
                      <Pill tone={tool.enabled ? 'success' : 'neutral'}>{tool.enabled ? 'Enabled' : 'Disabled'}</Pill>
                      {tool.requiresConfirmation && <Pill tone="warning">Needs confirmation</Pill>}
                    </div>
                    <p className="mt-1 truncate text-xs text-[#6B6478]">{tool.description}</p>
                    <p className="text-xs font-mono text-[#6B6478] mt-0.5 truncate">
                      {tool.method} {tool.endpointUrl}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTesting(testing === tool.id ? null : tool.id)}
                      className="rounded-md p-2 text-[#6B6478] hover:bg-[#F7F6FA] hover:text-[#170B2E]"
                      aria-label={`Test ${tool.name}`}
                      title="Test call"
                    >
                      <FlaskConical size={15} />
                    </button>
                    <button
                      onClick={() => setMode({ kind: 'edit', tool })}
                      disabled={!!mode}
                      className="rounded-md p-2 text-[#6B6478] hover:bg-[#F7F6FA] hover:text-[#170B2E] disabled:opacity-40"
                      aria-label={`Edit ${tool.name}`}
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => remove(tool)}
                      disabled={busy === tool.id}
                      className="rounded-md p-2 text-[#6B6478] hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      aria-label={`Delete ${tool.name}`}
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {testing === tool.id && (
                    <ToolTester agentId={agentId} tool={tool} onClose={() => setTesting(null)} />
                  )}
                </div>
              ),
            )}
          </div>
        )
      )}
    </div>
  );
}
