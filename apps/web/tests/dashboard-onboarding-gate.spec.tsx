import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { router, api } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
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
import { useAuthStore } from '../app/store/auth.store';
import { buildE164, splitE164 } from '../app/lib/onboarding';

const me = (profileCompleted: boolean) => ({
  data: { userId: 'u1', email: 'samay@acme.com', name: 'Samay', phone: '+919876543210', profileCompleted },
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('dashboard onboarding gate', () => {
  it('sends a signed-in user with an incomplete profile back to /login', async () => {
    api.get.mockResolvedValue(me(false));
    useAuthStore.setState({ token: 'access', refreshToken: 'r', hasHydrated: true, user: { userId: 'u1', profileCompleted: false } });

    render(<DashboardLayout><p>dashboard content</p></DashboardLayout>);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('dashboard content')).toBeNull();
  });

  it('renders the dashboard for a completed profile without asking for a phone', async () => {
    api.get.mockResolvedValue(me(true));
    useAuthStore.setState({ token: 'access', refreshToken: 'r', hasHydrated: true, user: { userId: 'u1', profileCompleted: true } });

    render(<DashboardLayout><p>dashboard content</p></DashboardLayout>);

    expect(screen.getByText('dashboard content')).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'));
    expect(router.replace).not.toHaveBeenCalledWith('/login');
    expect(screen.queryByText('One more thing')).toBeNull();
  });
});

describe('phone helpers', () => {
  it('builds E.164 without altering digits', () => {
    expect(buildE164('91', '98765 43210')).toEqual({ phone: '+919876543210' });
    expect(buildE164('1', '(415) 555-0100')).toEqual({ phone: '+14155550100' });
  });

  it('rejects leading zeros, letters and bad lengths instead of rewriting them', () => {
    expect(buildE164('91', '09876543210').error).toBeTruthy();
    expect(buildE164('91', '98765abc').error).toBeTruthy();
    expect(buildE164('91', '12').error).toBeTruthy();
    expect(buildE164('91', '').error).toBeTruthy();
  });

  it('splits a stored number back into calling code + national part', () => {
    expect(splitE164('+919876543210')).toEqual({ country: 'IN', national: '9876543210' });
    expect(splitE164('+14155550100')).toEqual({ country: 'US', national: '4155550100' });
    expect(splitE164('+14165550100', 'CA')).toEqual({ country: 'CA', national: '4165550100' });
    expect(splitE164('not-a-phone')).toBeNull();
  });
});
