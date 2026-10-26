import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../app/lib/api', () => ({ api: { get: vi.fn() } }));

import { AgentForm } from '../app/dashboard/ai/_components/AgentForm';
import {
  AiAgent,
  EMPTY_AGENT_FORM,
  agentToForm,
  buildAgentPatch,
  buildCreateAgentPayload,
  validateAgentForm,
  voicesFor,
} from '../app/lib/ai';

const AGENT: AiAgent = {
  id: 'agent-1',
  projectId: 'p1',
  name: 'Bot',
  description: null,
  status: 'ACTIVE',
  currentVersionId: 'v1',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  currentVersion: {
    id: 'v1',
    agentId: 'agent-1',
    version: 1,
    instructions: 'Help.',
    welcomeMessage: null,
    language: 'en',
    voice: 'Puck',
    provider: 'gemini',
    model: null,
    maxDurationSeconds: 600,
    createdAt: '2026-10-01T00:00:00Z',
  },
};

describe('provider-aware agent form', () => {
  it('validates voices against the selected provider', () => {
    const base = { ...EMPTY_AGENT_FORM, name: 'Bot', instructions: 'Hi' };
    expect(voicesFor('')).toContain('Puck');
    expect(validateAgentForm({ ...base, provider: 'openai', voice: 'marin' })).toEqual({});
    expect(validateAgentForm({ ...base, provider: 'openai', voice: 'Puck' }).voice).toBe('Select a valid voice.');
    expect(validateAgentForm({ ...base, provider: 'other' }).provider).toBe('Select a valid provider.');
  });

  it('sends provider on create when chosen and in the patch only when it changes', () => {
    expect(buildCreateAgentPayload('p1', { ...EMPTY_AGENT_FORM, name: 'Bot', instructions: 'Hi', provider: 'openai' })).toMatchObject({
      provider: 'openai',
    });
    const original = agentToForm(AGENT);
    expect(original.provider).toBe('gemini');
    expect(buildAgentPatch(original, { ...original, provider: 'openai', voice: '' })).toEqual({ provider: 'openai', voice: null });
  });

  it('hides the select without a provider list', () => {
    render(<AgentForm initial={EMPTY_AGENT_FORM} submitLabel="Save" onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Provider')).toBeNull();
  });

  it('hides the select when only one provider is available', () => {
    render(<AgentForm initial={agentToForm(AGENT)} submitLabel="Save" onSubmit={vi.fn()} providers={['gemini']} />);
    expect(screen.queryByLabelText('Provider')).toBeNull();
    expect(screen.getByLabelText('Voice')).toBeTruthy();
  });

  it('lists configured providers, keeps the current one and swaps the voice list', async () => {
    const onSubmit = vi.fn();
    render(<AgentForm initial={agentToForm(AGENT)} submitLabel="Save" onSubmit={onSubmit} providers={['openai']} />);

    const select = screen.getByLabelText('Provider') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['OpenAI', 'Google Gemini (not configured)']);
    expect(select.value).toBe('gemini');

    fireEvent.change(select, { target: { value: 'openai' } });
    const voice = screen.getByLabelText('Voice') as HTMLSelectElement;
    expect(voice.value).toBe('');
    expect(Array.from(voice.options).map((o) => o.value)).toContain('marin');

    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', voice: '' })));
  });
});
