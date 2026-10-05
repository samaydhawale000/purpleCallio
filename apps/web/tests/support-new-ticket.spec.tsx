import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { router, api, search } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  search: { value: '' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard/support/new',
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock('../app/lib/api', () => ({ api }));

import NewTicketPage from '../app/dashboard/support/new/page';

const subject = () => screen.getByPlaceholderText(/Webhook call.ended/) as HTMLInputElement;
const message = () => screen.getByLabelText('Message') as HTMLTextAreaElement;
const doc = () => screen.getByLabelText(/Related documentation/) as HTMLSelectElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

beforeEach(() => {
  vi.clearAllMocks();
  search.value = '';
});

describe('/dashboard/support/new', () => {
  it('blocks empty subject and message without calling the API', async () => {
    render(<NewTicketPage />);
    fireEvent.change(subject(), { target: { value: '   ' } });
    submit();

    expect(await screen.findByText('Subject is required.')).toBeTruthy();
    expect(screen.getByText('Message is required.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('preselects the documentation page from ?doc=', () => {
    search.value = 'doc=webhooks';
    render(<NewTicketPage />);
    expect(doc().value).toBe('webhooks');
  });

  it('ignores an unknown ?doc= value', () => {
    search.value = 'doc=not-a-page';
    render(<NewTicketPage />);
    expect(doc().value).toBe('');
  });

  it('creates the ticket and redirects to its conversation', async () => {
    search.value = 'doc=react';
    api.post.mockResolvedValue({ data: { id: 't1' } });
    render(<NewTicketPage />);

    fireEvent.change(subject(), { target: { value: ' Join fails ' } });
    fireEvent.change(message(), { target: { value: 'ICE failed' } });
    submit();

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/support/tickets', {
        subject: 'Join fails',
        message: 'ICE failed',
        documentationId: 'react',
      }),
    );
    expect(router.push).toHaveBeenCalledWith('/dashboard/support/t1?created=1');
  });
});
