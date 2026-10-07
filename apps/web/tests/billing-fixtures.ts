// Shared API fixtures for billing page tests (not a spec file).
export const t0 = '2026-10-01T00:00:00.000Z';
export const t1 = '2026-10-31T00:00:00.000Z';

export const subscription = {
  id: 'sub-1',
  status: 'ACTIVE',
  planId: 'plan-growth',
  planVersionId: 'pv-1',
  planName: 'Growth',
  planType: 'PAID',
  pricePaise: 249900,
  currency: 'INR',
  includedCredits: 12000,
  billingInterval: 'MONTH',
  intervalCount: 1,
  entitlements: null,
  currentPeriodStart: t0,
  currentPeriodEnd: t1,
  cancelAtPeriodEnd: false,
  scheduledPlanId: null,
  activatedAt: t0,
  expiredAt: null,
  canceledAt: null,
  migrationSource: null,
};

export const wallet = {
  balance: 9000,
  reserved: 0,
  available: 9000,
  granted: 12000,
  used: 3000,
  usedPercent: 25,
  buckets: [{ id: 'b1', source: 'SUBSCRIPTION', initialAmount: 12000, remaining: 9000, expiresAt: t1, createdAt: t0 }],
};

export function overview(overrides: Record<string, unknown> = {}) {
  return {
    subscription,
    plan: { id: 'plan-growth', slug: 'growth', name: 'Growth', type: 'PAID', status: 'ACTIVE', currentVersionId: 'pv-1' },
    renewal: { planId: 'plan-growth', pricePaise: 249900, includedCredits: 12000, termsChanged: false },
    scheduledPlan: null,
    lastEndedPaidSubscription: null,
    pendingCheckout: null,
    wallet,
    usage: {
      cycle: { start: t0, end: t1 },
      usage: { audioMinutes: 100, videoMinutes: 1200, screenShareMinutes: 50, participants: 10, callsCreated: 5, callsCompleted: 5 },
      credits: { audio: 100, video: 2400, screenShare: 50, total: 2550, charged: 2550 },
      creditRates: { audioCreditsPerMinute: 1, videoCreditsPerMinute: 2, screenShareCreditsPerMinute: 1 },
      wallet,
      subscription,
    },
    customPlan: { request: null, offers: [] },
    ...overrides,
  };
}

export const usageDebit = {
  id: 'tx-1',
  type: 'USAGE_DEBIT',
  amount: -40,
  balanceBefore: 9040,
  balanceAfter: 9000,
  referenceType: 'Call',
  referenceId: 'call-abcdef1234567',
  metadata: { callId: 'call-abcdef1234567', audioMinutes: 0, videoMinutes: 20, screenShareMinutes: 0, videoCredits: 40 },
  createdAt: t0,
};

export const page = <T,>(data: T[]) => ({ data, total: data.length, page: 1, pageSize: 10, pageCount: 1 });
