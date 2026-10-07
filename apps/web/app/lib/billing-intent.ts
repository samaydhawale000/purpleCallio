/**
 * Carries a pricing-page choice across sign-up: /signup?plan=<slug> or
 * /signup?intent=custom is remembered for this browser session and the user
 * lands on that plan (or the custom-plan conversation) after signing in,
 * instead of the generic dashboard.
 */
const KEY = 'purplecallio:billing-intent';
const SLUG_RE = /^[a-z0-9-]{1,64}$/;

export function captureBillingIntent(search: string) {
  try {
    const params = new URLSearchParams(search);
    const plan = params.get('plan');
    const intent = params.get('intent');
    if (intent === 'custom') sessionStorage.setItem(KEY, 'custom');
    else if (plan && SLUG_RE.test(plan)) sessionStorage.setItem(KEY, `plan:${plan}`);
  } catch {
    /* storage unavailable — fall back to the dashboard */
  }
}

/** Where to go after authentication; clears the stored intent. */
export function consumeBillingIntent(fallback = '/dashboard'): string {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (value === 'custom') return '/dashboard/billing/plans?custom=1';
    if (value?.startsWith('plan:')) {
      const slug = value.slice(5);
      if (SLUG_RE.test(slug)) return `/dashboard/billing/plans?plan=${encodeURIComponent(slug)}`;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}
