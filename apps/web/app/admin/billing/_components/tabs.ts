export type BillingTab =
  | 'overview'
  | 'plans'
  | 'topups'
  | 'features'
  | 'credit-rates'
  | 'subscriptions'
  | 'payments'
  | 'custom-plans'
  | 'settings';

export const BILLING_TABS: { key: BillingTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'plans', label: 'Plans' },
  { key: 'topups', label: 'Top-ups' },
  { key: 'features', label: 'Features' },
  { key: 'credit-rates', label: 'Credit Rates' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'payments', label: 'Payments' },
  { key: 'custom-plans', label: 'Custom Plans' },
  { key: 'settings', label: 'Settings' },
];

/** Sidebar sub-navigation under Admin → Billing. */
export const BILLING_NAV: { label: string; tab: BillingTab }[] = [
  { label: 'Plans', tab: 'plans' },
  { label: 'Top-ups', tab: 'topups' },
  { label: 'Subscriptions', tab: 'subscriptions' },
  { label: 'Payments', tab: 'payments' },
  { label: 'Credits', tab: 'credit-rates' },
  { label: 'Custom Plans', tab: 'custom-plans' },
  { label: 'Billing Settings', tab: 'settings' },
];
