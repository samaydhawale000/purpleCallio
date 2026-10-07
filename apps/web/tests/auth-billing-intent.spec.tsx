import { beforeEach, describe, expect, it } from 'vitest';
import { captureBillingIntent, consumeBillingIntent } from '../app/lib/billing-intent';
import { notificationHref, type AppNotification } from '../app/lib/notifications';

describe('billing intent across sign-up', () => {
  beforeEach(() => sessionStorage.clear());

  it('routes to the chosen plan after sign-in, once', () => {
    captureBillingIntent('?plan=growth');
    expect(consumeBillingIntent()).toBe('/dashboard/billing/plans?plan=growth');
    expect(consumeBillingIntent()).toBe('/dashboard');
  });

  it('routes a custom-plan intent to the custom-plan flow', () => {
    captureBillingIntent('?intent=custom');
    expect(consumeBillingIntent()).toBe('/dashboard/billing/plans?custom=1');
  });

  it('ignores malformed plan slugs', () => {
    captureBillingIntent('?plan=../../admin');
    expect(consumeBillingIntent()).toBe('/dashboard');
  });
});

describe('billing notification routing', () => {
  const n = (type: string, metadata: AppNotification['metadata'] = null): AppNotification => ({
    id: '1', type, title: '', message: '', read: false, metadata, createdAt: new Date().toISOString(),
  });

  it('sends customers to the right billing page', () => {
    expect(notificationHref(n('PAYMENT_SUCCESS', { paymentId: 'p' }), 'CUSTOMER')).toBe('/dashboard/billing/payments');
    expect(notificationHref(n('CREDITS_EXHAUSTED'), 'CUSTOMER')).toBe('/dashboard/billing/credits');
    expect(notificationHref(n('PLAN_EXPIRING'), 'CUSTOMER')).toBe('/dashboard/billing');
    expect(notificationHref(n('CUSTOM_PLAN_OFFER_RECEIVED', { offerId: 'o1' }), 'CUSTOMER')).toBe('/dashboard/billing/offers/o1');
    expect(notificationHref(n('CUSTOM_PLAN_REQUEST_CREATED', { ticketId: 't1' }), 'CUSTOMER')).toBe('/dashboard/support/t1');
  });

  it('sends admins to the custom plan request', () => {
    expect(notificationHref(n('CUSTOM_PLAN_REQUEST_CREATED', { requestId: 'r1', ticketId: 't1' }), 'ADMIN')).toBe(
      '/admin/billing/custom-plans/r1',
    );
  });
});
