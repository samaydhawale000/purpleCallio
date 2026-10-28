import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { router, api } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/projects',
}));
vi.mock('../app/lib/api', () => ({ api }));

import ProjectsPage from '../app/dashboard/projects/page';
import { useAuthStore } from '../app/store/auth.store';

const project = (id: string, name: string) => ({
  id,
  name,
  description: null,
  webhookUrl: null,
  webhookSecret: null,
  createdAt: '2026-10-01T00:00:00Z',
});
const key = (id: string, projectId: string, isActive = true) => ({
  id,
  name: `Key ${id}`,
  keyPrefix: 'bj_live_abcd',
  isActive,
  createdAt: '2026-10-01T00:00:00Z',
  project: { id: projectId, name: 'ABC' },
});

function mockGet(projects: unknown[], keys: unknown[]) {
  api.get.mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/projects' ? projects : keys }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: 'access', refreshToken: 'r', hasHydrated: true, user: { userId: 'u1' } });
});

describe('/dashboard/projects — projects and API keys together', () => {
  it('shows each project with its real key count', async () => {
    mockGet([project('p1', 'ABC'), project('p2', 'Staging')], [key('k1', 'p1'), key('k2', 'p1', false)]);
    render(<ProjectsPage />);

    expect(await screen.findByText('2 API keys · 1 active')).toBeTruthy();
    expect(screen.getByText('No API keys')).toBeTruthy();
  });

  it('creates the project and its first API key in one step, then reveals the key', async () => {
    mockGet([], []);
    api.post.mockImplementation((url: string) =>
      Promise.resolve({
        data:
          url === '/projects'
            ? project('p9', 'Mobile app')
            : { id: 'k9', name: 'Default key', keyPrefix: 'bj_live_9999', isActive: true, createdAt: '2026-10-21T00:00:00Z', key: 'bj_live_secret' },
      }),
    );
    render(<ProjectsPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'New project' }))[0]);
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Mobile app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project & key' }));

    expect(await screen.findByText('bj_live_secret')).toBeTruthy();
    expect(api.post).toHaveBeenNthCalledWith(1, '/projects', { name: 'Mobile app', description: undefined });
    expect(api.post).toHaveBeenNthCalledWith(2, '/api-keys', { projectId: 'p9', name: 'Default key' });
    expect(screen.getByText('1 API key')).toBeTruthy();
  });

  it('skips key creation when the checkbox is unticked', async () => {
    mockGet([], []);
    api.post.mockResolvedValue({ data: project('p9', 'Mobile app') });
    render(<ProjectsPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'New project' }))[0]);
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Mobile app' } });
    fireEvent.click(screen.getByLabelText('Generate an API key for this project'));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Mobile app')).toBeTruthy();
  });

  it('keeps the project and explains when the key fails', async () => {
    mockGet([], []);
    api.post.mockImplementation((url: string) =>
      url === '/projects' ? Promise.resolve({ data: project('p9', 'Mobile app') }) : Promise.reject(new Error('500')),
    );
    render(<ProjectsPage />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'New project' }))[0]);
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Mobile app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project & key' }));

    expect(await screen.findByText(/Project created, but the API key could not be generated/)).toBeTruthy();
    expect(screen.getByText('Mobile app')).toBeTruthy();
  });
});
