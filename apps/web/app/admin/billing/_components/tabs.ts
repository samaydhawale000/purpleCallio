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
