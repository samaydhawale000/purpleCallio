import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { router, api } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/settings',
}));
vi.mock('../app/lib/api', () => ({ api }));

import SettingsPage from '../app/dashboard/settings/page';
import { useAuthStore } from '../app/store/auth.store';

const profile = {
  userId: 'u1',
  email: 'samay@acme.com',
  name: 'Samay Dhawale',
  avatarUrl: null,
  phone: '+919876543210',
  companyName: 'Acme Inc',
  jobTitle: 'Engineering Lead',
  country: 'IN',
  companyWebsite: 'https://acme.com',
  expectedUsageRange: 'FROM_1K_TO_10K',
  primaryUseCase: 'TELEHEALTH',
  profileCompleted: true,
  onboardingRequired: false,
};

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ token: 'access', refreshToken: 'r', hasHydrated: true, user: { userId: 'u1' } });
  api.get.mockResolvedValue({ data: profile });
});

describe('/dashboard/settings — profile', () => {
  it('shows every saved profile field, pre-filled', async () => {
    render(<SettingsPage />);

    await screen.findByLabelText(/Full name/);
    expect(field(/Full name/).value).toBe('Samay Dhawale');
    expect(field(/Work email/).value).toBe('samay@acme.com');
    expect((field(/Work email/) as HTMLInputElement).disabled).toBe(true);
    expect(field(/^Country(?! calling)/).value).toBe('IN');
    expect((screen.getByLabelText('Country calling code') as HTMLSelectElement).value).toBe('IN');
    expect(field(/^Phone number/).value).toBe('9876543210');
    expect(field(/Company \/ Organization/).value).toBe('Acme Inc');
    expect(field(/Job title \/ Role/).value).toBe('Engineering Lead');
    expect(field(/Company website/).value).toBe('https://acme.com');
    expect(field(/Expected monthly usage/).value).toBe('FROM_1K_TO_10K');
    expect(field(/Primary use case/).value).toBe('TELEHEALTH');
  });

  it('saves edits through PATCH /auth/profile and updates the store', async () => {
    api.patch.mockResolvedValue({ data: { user: { ...profile, id: 'u1', jobTitle: 'CTO' }, onboardingRequired: false } });
    render(<SettingsPage />);
    await screen.findByLabelText(/Job title/);

    fireEvent.change(field(/Job title \/ Role/), { target: { value: 'CTO' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({
      jobTitle: 'CTO',
      phone: '+919876543210',
      companyName: 'Acme Inc',
      country: 'IN',
    }));
    await screen.findByText('Saved');
    expect(useAuthStore.getState().user?.jobTitle).toBe('CTO');
  });

  it('validates before saving and shows server errors', async () => {
    render(<SettingsPage />);
    await screen.findByLabelText(/Company \/ Organization/);

    fireEvent.change(field(/Company \/ Organization/), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(screen.getByText('Company / organization is required.')).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.change(field(/Company \/ Organization/), { target: { value: 'Acme' } });
    api.patch.mockRejectedValue({ response: { status: 500 } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't save your profile");
    expect(field(/Company \/ Organization/).value).toBe('Acme');
  });

  it('fetches /auth/me once instead of looping', async () => {
    render(<SettingsPage />);
    await screen.findByLabelText(/Full name/);
    await new Promise((r) => setTimeout(r, 50));
    // One call from useRequireAuth + one from the page itself.
    expect(api.get.mock.calls.filter(([u]) => u === '/auth/me').length).toBeLessThanOrEqual(2);
  });
});
