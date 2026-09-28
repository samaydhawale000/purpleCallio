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
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, initial, animate, exit, transition, ...rest }: any) => <div {...rest}>{children}</div>,
  },
}));

vi.mock('../app/lib/api', () => ({ api }));

import LoginPage from '../app/login/page';
import SignupPage from '../app/signup/page';
import { useAuthStore } from '../app/store/auth.store';

// ── Google Identity Services stub ───────────────────────────────────────
let googleCallback: ((r: { credential: string }) => void) | null = null;

function installGoogleStub() {
  googleCallback = null;
  (window as any).google = {
    accounts: {
      id: {
        initialize: ({ callback }: any) => { googleCallback = callback; },
        renderButton: (el: HTMLElement) => {
          el.innerHTML = '<button type="button">Continue with Google</button>';
        },
      },
    },
  };
}

async function signInWithGoogle() {
  await waitFor(() => expect(googleCallback).not.toBeNull());
  await act(async () => {
    googleCallback!({ credential: 'google-id-token' });
  });
}

const newUser = {
  id: 'u1',
  email: 'samay@acme.com',
  name: 'Samay Dhawale',
  avatarUrl: null,
  phone: null,
  companyName: null,
  jobTitle: null,
  country: null,
  companyWebsite: null,
  expectedUsageRange: null,
  primaryUseCase: null,
  profileCompleted: false,
};

function mockGoogleLogin(user: any, onboardingRequired: boolean) {
  api.post.mockImplementation(async (url: string) => {
    if (url === '/auth/google') {
      return { data: { user, accessToken: 'access', refreshToken: 'refresh', onboardingRequired } };
    }
    return { data: {} };
  });
  api.get.mockImplementation(async (url: string) => {
    if (url === '/auth/me') {
      const { id, ...rest } = user;
      return { data: { userId: id, ...rest, onboardingRequired } };
    }
    return { data: {} };
  });
}

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;

const click = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const next = () => click(/^next/i);
const submit = () => click(/^continue/i);

function fillAbout({ phone = true } = {}) {
  fireEvent.change(field(/^Country(?! calling)/), { target: { value: 'IN' } });
  if (phone) fireEvent.change(field(/^Phone number/), { target: { value: '98765 43210' } });
}

function fillCompany() {
  fireEvent.change(field(/Company \/ Organization/), { target: { value: 'Acme Inc' } });
  fireEvent.change(field(/Job title \/ Role/), { target: { value: 'Engineering Lead' } });
}

/** Fills and advances through the About + Company steps to the Usage step. */
function goToUsageStep({ phone = true } = {}) {
  fillAbout({ phone });
  next();
  fillCompany();
  next();
  expect(screen.getByText('Step 3 of 3')).toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-client-id';
  localStorage.clear();
  useAuthStore.setState({ token: null, refreshToken: null, user: null, hasHydrated: true });
  installGoogleStub();
});

describe('/login — Google sign-in then profile completion', () => {
  it('does not redirect after Google login when onboarding is required and shows the profile form on the same page', async () => {
    mockGoogleLogin(newUser, true);
    render(<LoginPage />);
    expect(screen.getByText('Welcome back')).toBeTruthy();

    await signInWithGoogle();

    expect(await screen.findByText('Complete your profile')).toBeTruthy();
    expect(screen.queryByText('Welcome back')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/dashboard');
    expect(useAuthStore.getState().token).toBe('access');
  });

  it('sends a returning user with a completed profile straight to the dashboard', async () => {
    mockGoogleLogin({ ...newUser, companyName: 'Acme', jobTitle: 'CTO', country: 'IN', phone: '+919876543210', profileCompleted: true }, false);
    render(<LoginPage />);

    await signInWithGoogle();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Complete your profile')).toBeNull();
  });

  it('never skips onboarding when the login response has no onboardingRequired flag (e.g. an outdated API)', async () => {
    const { profileCompleted, ...legacyUser } = newUser;
    api.post.mockResolvedValue({ data: { user: legacyUser, accessToken: 'access', refreshToken: 'refresh' } });
    api.get.mockResolvedValue({ data: { userId: 'u1', email: 'samay@acme.com' } });
    render(<LoginPage />);

    await signInWithGoogle();

    expect(await screen.findByText(/couldn't load your account/i)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalledWith('/dashboard');
    expect(router.replace).not.toHaveBeenCalledWith('/dashboard');
  });

  it('pre-fills the Google email as read-only and the Google name as editable', async () => {
    mockGoogleLogin(newUser, true);
    render(<LoginPage />);
    await signInWithGoogle();
    await screen.findByText('Complete your profile');

    const email = field(/Work email/) as HTMLInputElement;
    expect(email.value).toBe('samay@acme.com');
    expect(email.readOnly || email.disabled).toBe(true);

    const name = field(/Full name/) as HTMLInputElement;
    expect(name.value).toBe('Samay Dhawale');
    expect(name.readOnly).toBe(false);
    fireEvent.change(name, { target: { value: 'Samay D' } });
    expect(name.value).toBe('Samay D');
  });

  it('shows an existing phone as already on file instead of asking again', async () => {
    mockGoogleLogin({ ...newUser, phone: '+919876543210' }, true);
    render(<LoginPage />);
    await signInWithGoogle();
    await screen.findByText('Complete your profile');

    expect(screen.getByTestId('phone-on-file').textContent).toContain('+91 9876543210');
    expect(screen.queryByLabelText(/^Phone number/)).toBeNull();

    goToUsageStep({ phone: false });
    api.patch.mockResolvedValue({ data: { user: { ...newUser, phone: '+919876543210', profileCompleted: true }, onboardingRequired: false } });
    submit();

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1].phone).toBe('+919876543210');
  });

  it('splits the profile into steps and validates each step before moving on', async () => {
    mockGoogleLogin({ ...newUser, name: null }, true);
    render(<LoginPage />);
    await signInWithGoogle();
    await screen.findByText('Complete your profile');
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    // Company fields are not on the first step.
    expect(screen.queryByLabelText(/Company \/ Organization/)).toBeNull();

    next();
    expect(screen.getByText('Full name is required.')).toBeTruthy();
    expect(screen.getByText('Phone number is required.')).toBeTruthy();
    expect(screen.getByText('Select your country.')).toBeTruthy();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();

    fireEvent.change(field(/Full name/), { target: { value: 'Samay' } });
    fillAbout();
    next();
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();

    next();
    expect(screen.getByText('Company / organization is required.')).toBeTruthy();
    expect(screen.getByText('Job title / role is required.')).toBeTruthy();
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('keeps values when going back a step', async () => {
    mockGoogleLogin(newUser, true);
    render(<LoginPage />);
    await signInWithGoogle();
    await screen.findByText('Complete your profile');

    fillAbout();
    next();
    fillCompany();
    click(/back/i);

    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect((field(/^Phone number/) as HTMLInputElement).value).toBe('98765 43210');
    next();
    expect((field(/Company \/ Organization/) as HTMLInputElement).value).toBe('Acme Inc');
  });

  it('follows the selected country for the phone calling code', async () => {
    mockGoogleLogin(newUser, true);
    render(<LoginPage />);
    await signInWithGoogle();
    await screen.findByText('Complete your profile');

    fireEvent.change(field(/^Country(?! calling)/), { target: { value: 'US' } });
    expect((screen.getByLabelText('Country calling code') as HTMLSelectElement).value).toBe('US');
  });

  it('rejects an invalid phone and website before submitting', async () => {
    mockGoogleLogin(newUser, true);
    render(<LoginPage />);
    await signInWithGoogle();
    await screen.findByText('Complete your profile');

    fillAbout();
    fireEvent.change(field(/^Phone number/), { target: { value: '09876543210' } });
    next();
    expect(screen.getByText('Enter the number without the leading 0.')).toBeTruthy();

    fireEvent.change(field(/^Phone number/), { target: { value: '98765 43210' } });
    next();
    fillCompany();
    fireEvent.change(field(/Company website/), { target: { value: 'not a url' } });
    next();
    expect(screen.getByText(/Enter a valid website URL/)).toBeTruthy();
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('shows a saving state, blocks duplicate submits, then redirects to the dashboard', async () => {
    mockGoogleLogin(newUser, true);
    render(<LoginPage />);
    await signInWithGoogle();
    await screen.findByText('Complete your profile');

    let resolvePatch: (v: any) => void = () => {};
    api.patch.mockReturnValue(new Promise((r) => { resolvePatch = r; }));

    goToUsageStep();
    fireEvent.change(field(/Expected monthly usage/), { target: { value: 'FROM_1K_TO_10K' } });
    fireEvent.change(field(/Primary use case/), { target: { value: 'TELEHEALTH' } });
    submit();

    const button = await screen.findByRole('button', { name: /saving/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((field(/Primary use case/).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.submit(button.closest('form')!);
    expect(api.patch).toHaveBeenCalledTimes(1);

    expect(api.patch).toHaveBeenCalledWith('/auth/profile', {
      name: 'Samay Dhawale',
      phone: '+919876543210',
      companyName: 'Acme Inc',
      jobTitle: 'Engineering Lead',
      country: 'IN',
      companyWebsite: null,
      expectedUsageRange: 'FROM_1K_TO_10K',
      primaryUseCase: 'TELEHEALTH',
    });

    await act(async () => {
      resolvePatch({ data: { user: { ...newUser, profileCompleted: true, companyName: 'Acme Inc' }, onboardingRequired: false } });
    });

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(useAuthStore.getState().user?.profileCompleted).toBe(true);
  });

  it('keeps entered values and shows an error when saving fails, without re-authenticating', async () => {
    mockGoogleLogin(newUser, true);
    render(<LoginPage />);
    await signInWithGoogle();
    await screen.findByText('Complete your profile');

    api.patch.mockRejectedValue({ response: { status: 500 } });
    goToUsageStep();
    fireEvent.change(field(/Primary use case/), { target: { value: 'SALES' } });
    submit();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("We couldn't save your profile. Please try again.");
    expect((field(/Primary use case/) as HTMLSelectElement).value).toBe('SALES');
    click(/back/i);
    expect((field(/Company \/ Organization/) as HTMLInputElement).value).toBe('Acme Inc');
    expect((field(/Job title \/ Role/) as HTMLInputElement).value).toBe('Engineering Lead');
    click(/back/i);
    expect((field(/^Phone number/) as HTMLInputElement).value).toBe('98765 43210');
    expect(screen.queryByText('Welcome back')).toBeNull();
    expect(useAuthStore.getState().token).toBe('access');
    expect(router.replace).not.toHaveBeenCalledWith('/dashboard');
  });

  it('resumes onboarding for a restored session whose profile is incomplete', async () => {
    mockGoogleLogin(newUser, true);
    // A session persisted before this change has no profileCompleted flag.
    useAuthStore.setState({ token: 'access', refreshToken: 'refresh', user: { userId: 'u1', email: 'samay@acme.com' } });
    render(<LoginPage />);

    expect(await screen.findByText('Complete your profile')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/auth/me');
  });

  it('keeps the mobile single-column layout (branding panel hidden below lg)', () => {
    const { container } = render(<LoginPage />);
    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid.className).toContain('lg:grid-cols-2');
    const branding = grid.children[0] as HTMLElement;
    expect(branding.className).toContain('hidden');
    expect(branding.className).toContain('lg:flex');
  });
});

describe('/signup — shares the same onboarding flow', () => {
  it('shows the profile completion step after Google sign-up', async () => {
    mockGoogleLogin(newUser, true);
    render(<SignupPage />);
    expect(screen.getByText('Create your account')).toBeTruthy();

    await signInWithGoogle();

    expect(await screen.findByText('Complete your profile')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });
});
