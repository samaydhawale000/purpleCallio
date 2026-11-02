import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Module mocks ────────────────────────────────────────────────────────
const { router, api } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/login',
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
// Render motion elements as plain divs so exit animations don't delay DOM swaps.
vi.mock('framer-motion', () => {
  const div = ({ children, initial, animate, exit, transition, ...rest }: any) => <div {...rest}>{children}</div>;
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: { div },
    m: { div },
  };
});

vi.mock('../app/lib/api', () => ({ api }));

import LoginPage from '../app/login/page';
import SignupPage from '../app/signup/page';
import { useAuthStore } from '../app/store/auth.store';


function installGoogleStub() {
  (window as any).google = {
    accounts: { id: { initialize: () => undefined, renderButton: (el: HTMLElement) => { el.innerHTML = '<button type="button">Continue with Google</button>'; } } },
  };
}

const user = {
  id: 'u1',
  email: 'asha@example.com',
  name: 'Asha Rao',
  phone: '+919876543210',
  profileCompleted: false,
};
const session = (profileCompleted = false) => ({
  data: { user: { ...user, profileCompleted }, accessToken: 'access', refreshToken: 'refresh', onboardingRequired: !profileCompleted },
});

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
  localStorage.clear();
  useAuthStore.setState({ token: null, refreshToken: null, user: null, hasHydrated: true });
  installGoogleStub();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { userId: user.id, ...user } };
    return { data: {} };
  });
});

describe('/login — email + password', () => {
  it('signs in with an email and shows onboarding for an incomplete profile', async () => {
    api.post.mockResolvedValueOnce(session(false));
    render(<LoginPage />);
    expect(screen.queryByText(/mobile/i)).toBeNull();
    type(/^Email$/, ' asha@gmail.com ');
    type(/^Password$/, 'secret123');
    click(/^Sign in$/);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'asha@gmail.com', password: 'secret123' }));
    expect(await screen.findByText('Complete your profile')).toBeTruthy();
    expect(useAuthStore.getState().token).toBe('access');
  });

  it('goes to the dashboard when the profile is complete', async () => {
    api.post.mockResolvedValueOnce(session(true));
    render(<LoginPage />);
    type(/^Email$/, 'asha@example.com');
    type(/^Password$/, 'secret123');
    click(/^Sign in$/);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows the server error for a wrong password', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 401, data: { message: 'Incorrect email or password.' } } });
    render(<LoginPage />);
    type(/^Email$/, 'asha@example.com');
    type(/^Password$/, 'nope1234');
    click(/^Sign in$/);
    expect((await screen.findByRole('alert')).textContent).toContain('Incorrect email or password.');
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('forgot password: emails a code, then resets and signs in', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url === '/auth/password/forgot') return { data: { sent: true, expiresInSeconds: 600, resendInSeconds: 60 } };
      if (url === '/auth/password/reset') return session(false);
      return { data: {} };
    });
    render(<LoginPage />);
    click(/Forgot password/);
    type(/^Email$/, 'asha@example.com');
    click(/^Send code$/);

    expect(await screen.findByText('Enter the code')).toBeTruthy();
    expect(screen.getByText(/resend in \d+s/)).toBeTruthy();
    type(/6-digit code/, '12a3456');
    type(/New password/, 'short');
    click(/Reset password and sign in/);
    expect(api.post).not.toHaveBeenCalledWith('/auth/password/reset', expect.anything());

    type(/New password/, 'newpass99');
    click(/Reset password and sign in/);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/password/reset', { email: 'asha@example.com', code: '123456', password: 'newpass99' }),
    );
    expect(await screen.findByText('Complete your profile')).toBeTruthy();
  });
});

describe('/signup — email + password with an emailed code', () => {
  it('validates, sends the code, verifies and signs in', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url === '/auth/register') return { data: { email: 'asha@example.com', expiresInSeconds: 600, resendInSeconds: 60 } };
      if (url === '/auth/register/verify') return session(false);
      return { data: {} };
    });
    render(<SignupPage />);
    click(/^Create account$/);
    expect(screen.getByText('Full name is required.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();

    expect(screen.queryByText(/mobile/i)).toBeNull();
    type(/Full name/, 'Asha Rao');
    type(/^Email$/, 'Asha@Example.com');
    type(/^Password/, 'secret123');
    click(/^Create account$/);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/register', {
        name: 'Asha Rao',
        email: 'Asha@Example.com',
        password: 'secret123',
      }),
    );
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(screen.getByText('asha@example.com')).toBeTruthy();

    // Back keeps what was typed.
    click(/Change details/);
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe('Asha Rao');
    click(/^Create account$/);
    await screen.findByText('Check your email');

    type(/6-digit code/, '654321');
    click(/Verify and create account/);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/register/verify', { email: 'asha@example.com', code: '654321' }));
    expect(await screen.findByText('Complete your profile')).toBeTruthy();
  });

  it('shows a conflict from the server', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 409, data: { message: 'An account with this email already exists.' } } });
    render(<SignupPage />);
    type(/Full name/, 'Asha Rao');
    type(/^Email$/, 'asha@example.com');
    type(/^Password/, 'secret123');
    click(/^Create account$/);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/register', { name: 'Asha Rao', email: 'asha@example.com', password: 'secret123' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
  });
});
