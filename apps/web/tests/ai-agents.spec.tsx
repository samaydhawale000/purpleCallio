import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { router, api } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    defaults: { baseURL: 'http://api.test' },
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
  useParams: () => ({ id: 'agent-1' }),
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../app/lib/api', () => ({ api }));

import DashboardLayout from '../app/dashboard/DashboardLayoutClient';
import AiAgentsPage from '../app/dashboard/ai/page';
import AiAgentPage from '../app/dashboard/ai/[id]/page';
import { AgentForm } from '../app/dashboard/ai/_components/AgentForm';
import { useAuthStore } from '../app/store/auth.store';
import {
  EMPTY_AGENT_FORM,
  agentToForm,
  buildAgentPatch,
  buildCreateAgentPayload,
  validateAgentForm,
  type AiAgent,
} from '../app/lib/ai';

const AGENT: AiAgent = {
  id: 'agent-1',
  projectId: 'p1',
  name: 'Support bot',
  description: 'Answers order questions',
  status: 'ACTIVE',
  currentVersionId: 'v1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  currentVersion: {
    id: 'v1',
    agentId: 'agent-1',
    version: 1,
    instructions: 'Be helpful.',
    welcomeMessage: 'Hi there!',
    language: 'en',
    voice: null,
    provider: 'gemini',
    model: null,
    maxDurationSeconds: 600,
    createdAt: '2026-10-01T10:00:00.000Z',
  },
  tools: [],
};

/** Routes api.get by path; anything unlisted rejects. */
function routeGet(routes: Record<string, unknown>) {
  api.get.mockImplementation((url: string) =>
    url in routes ? Promise.resolve({ data: routes[url] }) : Promise.reject(new Error(`unexpected GET ${url}`)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ token: 'access', refreshToken: 'r', hasHydrated: true, user: { userId: 'u1', profileCompleted: true } });
});

describe('agent form helpers', () => {
  it('requires name and instructions and a duration of at least 30 seconds', () => {
    const errors = validateAgentForm({ ...EMPTY_AGENT_FORM, maxDurationSeconds: '10' });
    expect(errors.name).toBe('Name is required.');
    expect(errors.instructions).toBe('Instructions are required.');
    expect(errors.maxDurationSeconds).toMatch(/at least 30 seconds/);
    expect(validateAgentForm({ ...EMPTY_AGENT_FORM, name: 'A', instructions: 'Hi' })).toEqual({});
  });

  it('rejects over-long instructions and fractional durations', () => {
    const errors = validateAgentForm({
      ...EMPTY_AGENT_FORM,
      name: 'A',
      instructions: 'x'.repeat(20_001),
      maxDurationSeconds: '90.5',
    });
    expect(errors.instructions).toMatch(/at most 20,000/);
    expect(errors.maxDurationSeconds).toBeTruthy();
  });

  it('PATCH carries only the changed fields, with cleared text as null', () => {
    const original = agentToForm(AGENT);
    expect(buildAgentPatch(original, { ...original })).toEqual({});
    expect(buildAgentPatch(original, { ...original, name: '  New name ' })).toEqual({ name: 'New name' });
    expect(
      buildAgentPatch(original, { ...original, description: '', welcomeMessage: '  ', maxDurationSeconds: '120', voice: 'Kore' }),
    ).toEqual({ description: null, welcomeMessage: null, maxDurationSeconds: 120, voice: 'Kore' });
  });

  it('create payload omits empty optional fields', () => {
    expect(
      buildCreateAgentPayload('p1', { ...EMPTY_AGENT_FORM, name: ' Bot ', instructions: ' Help. ' }),
    ).toEqual({ projectId: 'p1', name: 'Bot', instructions: 'Help.', language: 'en', maxDurationSeconds: 600 });
  });
});

describe('AgentForm', () => {
  it('shows validation errors and does not submit an empty form', async () => {
    const onSubmit = vi.fn();
    render(<AgentForm initial={EMPTY_AGENT_FORM} submitLabel="Create agent" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Create agent'));
    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(screen.getByText('Instructions are required.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('counts instruction characters and shows server errors', async () => {
    const onSubmit = vi.fn().mockResolvedValue(['Select a valid voice.']);
    render(<AgentForm initial={EMPTY_AGENT_FORM} submitLabel="Create agent" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bot' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Hello' } });
    expect(screen.getByText('5 / 20,000 characters')).toBeTruthy();
    fireEvent.click(screen.getByText('Create agent'));
    expect((await screen.findByRole('alert')).textContent).toContain('Select a valid voice.');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bot', instructions: 'Hello' }));
  });
});

describe('agent page', () => {
  it('saves only the edited fields', async () => {
    routeGet({
      '/ai/status': { enabled: true, paidPlan: true },
      '/ai/agents/agent-1': AGENT,
      '/ai/agents/agent-1/versions': [AGENT.currentVersion],
    });
    api.patch.mockResolvedValue({ data: { ...AGENT, name: 'Renamed' } });

    render(<AiAgentPage />);
    const name = await screen.findByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/ai/agents/agent-1', { name: 'Renamed' }));
  });

  it('shows the agent id to copy and no playground tab', async () => {
    routeGet({
      '/ai/status': { enabled: true, paidPlan: true },
      '/ai/agents/agent-1': AGENT,
      '/ai/agents/agent-1/versions': [AGENT.currentVersion],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AiAgentPage />);
    expect((await screen.findByTestId('agent-id')).textContent).toBe('agent-1');
    expect(screen.queryByRole('tab', { name: 'Playground' })).toBeNull();

    fireEvent.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('agent-1');
    expect(await screen.findByText('Copied')).toBeTruthy();
  });
});

describe('AI nav item', () => {
  it('is hidden when AI is disabled', async () => {
    routeGet({ '/auth/me': { userId: 'u1', profileCompleted: true }, '/ai/status': { enabled: false } });
    render(<DashboardLayout><p>content</p></DashboardLayout>);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/ai/status'));
    expect(screen.queryByText('AI Agents')).toBeNull();
    expect(screen.getByText('Playground')).toBeTruthy();
  });

  it('is hidden when the status request fails', async () => {
    routeGet({ '/auth/me': { userId: 'u1', profileCompleted: true } });
    render(<DashboardLayout><p>content</p></DashboardLayout>);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/ai/status'));
    expect(screen.queryByText('AI Agents')).toBeNull();
  });

  it('is shown when AI is enabled', async () => {
    routeGet({ '/auth/me': { userId: 'u1', profileCompleted: true }, '/ai/status': { enabled: true, paidPlan: false } });
    render(<DashboardLayout><p>content</p></DashboardLayout>);
    const link = await screen.findByText('AI Agents');
    expect(link.closest('a')?.getAttribute('href')).toBe('/dashboard/ai');
  });
});

describe('Free plan', () => {
  const listRoutes = (paidPlan: boolean) => ({
    '/ai/status': { enabled: true, paidPlan },
    '/projects': [{ id: 'p1', name: 'Main' }],
    '/ai/agents': [AGENT],
  });

  beforeEach(() => {
    // /ai/agents is fetched with ?projectId as axios params.
    api.get.mockImplementation((url: string) => {
      const routes: Record<string, unknown> = (api as any).routes;
      return url in routes ? Promise.resolve({ data: routes[url] }) : Promise.reject(new Error(url));
    });
  });

  it('shows the upgrade card, hides New agent and keeps agents visible', async () => {
    (api as any).routes = listRoutes(false);
    render(<AiAgentsPage />);
    expect(await screen.findByText('AI voice agents are available on paid plans')).toBeTruthy();
    expect(screen.getByText('View plans').closest('a')?.getAttribute('href')).toBe('/dashboard/billing/plans');
    expect(screen.getByText('Support bot')).toBeTruthy();
    expect(screen.getByText('Disable')).toBeTruthy();
    expect(screen.getByLabelText('Delete Support bot')).toBeTruthy();
    expect(screen.queryByText('New agent')).toBeNull();
  });

  it('shows New agent and no upgrade card on a paid plan', async () => {
    (api as any).routes = listRoutes(true);
    render(<AiAgentsPage />);
    expect(await screen.findByText('New agent')).toBeTruthy();
    expect(screen.queryByText('AI voice agents are available on paid plans')).toBeNull();
  });
});
