export type BillingTab =
  | 'overview'
  | 'plans'
  | 'topups'
  | 'features'
  | 'credit-rates'
  | 'credit-pricing'
  | 'translation'
  | 'subscriptions'
  | 'payments'
  | 'custom-plans'
  | 'settings';

export const BILLING_TABS: { key: BillingTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'credit-rates', label: 'Credit Rates' },
  { key: 'credit-pricing', label: 'Credit Pricing' },
  { key: 'translation', label: 'Live Translate' },
  { key: 'subscriptions', label: 'Legacy records' },
  { key: 'payments', label: 'Payments' },
  { key: 'settings', label: 'Settings' },
];

/** Sidebar sub-navigation under Admin → Billing. */
export const BILLING_NAV: { label: string; tab: BillingTab }[] = [
  { label: 'Credit Pricing', tab: 'credit-pricing' },
  { label: 'Legacy billing records', tab: 'subscriptions' },
  { label: 'Payments', tab: 'payments' },
  { label: 'Credits', tab: 'credit-rates' },
  { label: 'Live Translate', tab: 'translation' },
  { label: 'Billing Settings', tab: 'settings' },
];
