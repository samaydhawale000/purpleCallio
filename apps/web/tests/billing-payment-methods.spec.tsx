import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../app/lib/api', () => ({ api }));

import PaymentMethodCard from '../app/dashboard/billing/PaymentMethodCard';

beforeEach(() => vi.clearAllMocks());

describe('Payment methods card', () => {
  it('lists saved cards without any add-card, default or auto-charge flow', () => {
    render(
      <PaymentMethodCard
        paymentMethods={[{ id: 'tok_1', brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030, legacy: true }]}
        onChanged={() => {}}
        showToast={() => {}}
      />,
    );
    const card = screen.getByTestId('payment-methods');
    expect(card.textContent).toContain('Saved cards are never charged automatically.');
    expect(card.textContent).toContain('VISA •••• 4242');
    expect(card.textContent).toContain('Saved under previous billing — not charged automatically');
    expect(card.textContent).not.toMatch(/add card|add a card|make default|auto billing|₹1/i);
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull();
  });

  it('removes a card after confirmation', async () => {
    api.delete.mockResolvedValue({ data: { ok: true } });
    const onChanged = vi.fn();
    const showToast = vi.fn();
    render(
      <PaymentMethodCard
        paymentMethods={[{ id: 'tok_1', brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030, legacy: false }]}
        onChanged={onChanged}
        showToast={showToast}
      />,
    );
    fireEvent.click(screen.getByText('Remove'));
    fireEvent.click(screen.getByText('Remove card'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/billing/payment-method/tok_1'));
    expect(onChanged).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('success', 'Card removed.');
  });
});
