import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/features' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../app/lib/api', () => ({ api }));

import FeaturesPage from '../app/features/page';
import AiVoiceAgentsPage from '../app/features/ai-voice-agents/page';

describe('features overview', () => {
  it('lists video, audio and AI voice agents, each linking to its detail page', () => {
    render(<FeaturesPage />);
    for (const slug of ['video-calling', 'audio-calling', 'ai-voice-agents']) {
      expect(screen.getByTestId(`feature-card-${slug}`).getAttribute('href')).toBe(`/features/${slug}`);
    }
  });
});

describe('AI voice agents page', () => {
  it('shows use cases and the live AI credit rate from pricing', async () => {
    api.get.mockResolvedValue({
      data: {
        plans: [],
        features: [],
        topUps: [],
        creditRates: {
          audioCreditsPerMinute: 1,
          videoCreditsPerMinute: 4,
          screenShareCreditsPerMinute: 1,
          aiCreditsPerMinute: 15,
          taxPercent: 18,
        },
      },
    });
    render(<AiVoiceAgentsPage />);
    expect(screen.getByText('Appointment booking')).toBeTruthy();
    expect(screen.getByText('First-line customer support')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('15 credits per minute')).toBeTruthy());
  });
});
