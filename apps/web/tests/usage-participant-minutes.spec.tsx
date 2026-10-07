import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const { router, api } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/usage',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../app/lib/api', () => ({ api }));
vi.mock('../app/hooks/useRequireAuth', () => ({
  useRequireAuth: () => ({ isAuthed: true, isReady: true }),
}));

import UsagePage from '../app/dashboard/usage/page';
import { useAuthStore } from '../app/store/auth.store';

const t0 = '2026-09-01T10:00:00.000Z';
const t10 = '2026-09-01T10:10:00.000Z';

// A 10-minute call with 2 participants, both cameras on: the backend rates
// this as 20 video participant-minutes.
const call = {
  id: 'cu-1',
  callId: 'call-abcdef123456789',
  audioMinutes: 0,
  videoMinutes: 20,
  screenShareMinutes: 0,
  participants: 2,
  creditsCharged: 40,
  startedAt: t0,
  endedAt: t10,
  createdAt: t10,
  durationSeconds: { callSeconds: 600, audioSeconds: 0, videoSeconds: 600, screenShareSeconds: 0 },
};

const segment = {
  id: 'seg-1',
  startedAt: t0,
  endedAt: t10,
  participantCount: 2,
  audio: false,
  video: true,
  screenShare: false,
  audioMinutes: 0,
  videoMinutes: 20,
  screenShareMinutes: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: 'access', refreshToken: 'r', hasHydrated: true, user: { userId: 'u1' } } as never);
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/billing/current-usage')) {
      return {
        data: {
          cycle: { start: t0, end: t10 },
          usage: { audioMinutes: 0, videoMinutes: 20, screenShareMinutes: 0, participants: 2, callsCreated: 1, callsCompleted: 1 },
          credits: { audio: 0, video: 40, screenShare: 0, total: 40, charged: 40 },
          creditRates: { audioCreditsPerMinute: 1, videoCreditsPerMinute: 2, screenShareCreditsPerMinute: 1 },
          wallet: { balance: 960, reserved: 0, available: 960, granted: 1000, used: 40, usedPercent: 4, buckets: [] },
          subscription: { planName: 'Free', planType: 'FREE' },
        },
      };
    }
    if (url.startsWith('/dashboard/usage/chart')) return { data: [] };
    if (url.startsWith('/billing/call-usage')) {
      return { data: { data: [call], total: 1, page: 1, pageSize: 10, pageCount: 1 } };
    }
    if (url.includes('/segments')) {
      return {
        data: {
          callId: call.callId,
          segments: [segment],
          totals: { audioMins: 0, videoMins: 20, screenShareMins: 0, credits: { audioCredits: 0, videoCredits: 40, screenShareCredits: 0, totalCredits: 40 } },
        },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

describe('Usage page — call analytics in participant-minutes', () => {
  it('shows a 10-minute, 2-participant video call as 20.00 participant-min, not 10 min', async () => {
    render(<UsagePage />);

    const videoCell = await screen.findByTestId('call-video');
    expect(videoCell.textContent).toBe('20.00 participant-min');
    expect(videoCell.textContent).not.toContain('10 min');
    expect(screen.getByTestId('call-audio').textContent).toBe('0.00 participant-min');
    expect(screen.getByTestId('call-screen').textContent).toBe('0.00 participant-min');
    expect(screen.getByText(/Usage is shown in participant-minutes/)).toBeTruthy();
    // Money is gone: credits per call and credit rates per participant-minute.
    expect(screen.getByTestId('call-credits').textContent).toBe('40');
    expect(screen.getByText('1 video participant-minute = 2 credits')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/₹|free tier|free allowance|spending limit/i);
  });

  it('expanded row still shows wall-clock duration, participant count and the rated participant-minutes', async () => {
    render(<UsagePage />);

    fireEvent.click(await screen.findByText(/call-abcdef1/));

    const detail = await screen.findByTestId('call-usage-detail');
    expect(detail.textContent).toContain('10 min wall-clock');
    expect(detail.textContent).toContain('Participants: 2');
    expect(within(detail).getByText('20.00 participant-min')).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId('segment-participant-minutes')).toBeTruthy());
    expect(screen.getByTestId('segment-participant-minutes').textContent).toBe('Video 20.00 participant-min');
    expect(screen.getByText(/10 min wall-clock · 2 participants/)).toBeTruthy();
    expect(screen.getByTestId('segment-total-credits').textContent).toBe('40 credits');
  });
});
