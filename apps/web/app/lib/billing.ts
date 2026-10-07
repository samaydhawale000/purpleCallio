/**
 * Typed client for the prepaid billing API. Every price, credit amount,
 * feature and rate shown anywhere in the app comes from these endpoints —
 * never hard-code pricing in components.
 *
 *   Public:   GET /billing/plans (plans + features + top-ups + credit rates)
 *   Customer: /billing/overview, /billing/plans/available, /billing/checkout…
 *   Admin:    /admin/billing/*
 */
import { api } from './api';

// ── Shared types ───────────────────────────────────────────
export type PlanType = 'FREE' | 'PAID' | 'CUSTOM';
export type PlanStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type BillingInterval = 'MONTH' | 'YEAR' | 'CUSTOM';
export type PlanCtaAction = 'SIGNUP' | 'CHECKOUT' | 'CONTACT_SALES';
export type SubscriptionStatus = 'DRAFT' | 'PENDING_PAYMENT' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED' | 'SUSPENDED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED';
export type PaymentPurpose =
  | 'SUBSCRIPTION_PURCHASE'
  | 'SUBSCRIPTION_RENEWAL'
  | 'SUBSCRIPTION_UPGRADE'
  | 'TOPUP'
  | 'CUSTOM_PLAN'
  | 'LEGACY';
export type CreditTransactionType =
  | 'SUBSCRIPTION_ALLOCATION'
  | 'USAGE_DEBIT'
  | 'TOPUP_PURCHASE'
  | 'ADMIN_ADJUSTMENT'
  | 'REFUND'
  | 'EXPIRATION'
  | 'PROMOTION'
  | 'MIGRATION';
export type CustomPlanRequestStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'NEGOTIATING'
  | 'PROPOSAL_SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CLOSED';

export interface PlanVersion {
  id: string;
  version: number;
  pricePaise: number;
  currency: string;
  billingInterval: BillingInterval;
  intervalCount: number;
  includedCredits: number;
  includedAudioCredits: number | null;
  includedVideoCredits: number | null;
  includedScreenShareCredits: number | null;
  features: string[];
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  badge: string | null;
  type: PlanType;
  status: PlanStatus;
  displayOrder: number;
  isPopular: boolean;
  isPublic: boolean;
  ctaLabel: string | null;
  ctaAction: PlanCtaAction;
  /** True for public "talk to us" plans: show "Custom pricing", no price. */
  customPricing: boolean;
  version: PlanVersion | null;
}

export interface Feature {
  key: string;
  name: string;
  description: string | null;
  category: string | null;
}

export interface TopUpPackage {
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
  currency: string;
  credits: number;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  displayOrder: number;
  isPopular: boolean;
}

export interface CreditRates {
  audioCreditsPerMinute: number;
  videoCreditsPerMinute: number;
  screenShareCreditsPerMinute: number;
  taxPercent: number;
  topUpExpiryPolicy: 'NEVER' | 'DAYS' | 'SUBSCRIPTION_END';
  topUpExpiryDays: number | null;
}

export interface PublicPricing {
  plans: Plan[];
  features: Feature[];
  topUps: TopUpPackage[];
  creditRates: CreditRates;
}

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  planId: string | null;
  planVersionId: string | null;
  planName: string | null;
  planType: PlanType | null;
  pricePaise: number;
  currency: string;
  includedCredits: number;
  billingInterval: BillingInterval | null;
  intervalCount: number;
  entitlements: {
    features: string[];
    mediaCredits: { audio: number | null; video: number | null; screenShare: number | null };
  } | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanId: string | null;
  activatedAt: string | null;
  expiredAt: string | null;
  canceledAt: string | null;
  migrationSource: string | null;
}

export interface CreditBucketView {
  id: string;
  source: 'SUBSCRIPTION' | 'TOPUP' | 'PROMOTION' | 'ADMIN' | 'MIGRATION';
  initialAmount: number;
  remaining: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface WalletSummary {
  balance: number;
  reserved: number;
  available: number;
  /** Credits counted for this period (granted this period + anything still held). */
  granted: number;
  used: number;
  usedPercent: number;
  buckets: CreditBucketView[];
}

export interface SubscriptionOverview {
  subscription: Subscription;
  plan: { id: string; slug: string; name: string; type: PlanType; status: PlanStatus; currentVersionId: string | null } | null;
  /** Renewal price/credits (plan's current version). Null on Free. */
  renewal: { planId: string; pricePaise: number; includedCredits: number; termsChanged: boolean } | null;
  scheduledPlan: { id: string; name: string; type: PlanType; pricePaise: number } | null;
  /** A paid plan that ended recently while the customer is back on Free. */
  lastEndedPaidSubscription: Subscription | null;
  pendingCheckout: { id: string; planName: string | null; createdAt: string } | null;
}

export interface CurrentUsage {
  cycle: { start: string; end: string };
  usage: {
    audioMinutes: number;
    videoMinutes: number;
    screenShareMinutes: number;
    participants: number;
    callsCreated: number;
    callsCompleted: number;
  };
  credits: { audio: number; video: number; screenShare: number; total: number; charged: number };
  creditRates: { audioCreditsPerMinute: number; videoCreditsPerMinute: number; screenShareCreditsPerMinute: number };
  wallet: WalletSummary;
  subscription: Subscription;
}

export interface CustomPlanOffer {
  id: string;
  status: 'SENT' | 'ACCEPTED' | 'WITHDRAWN' | 'EXPIRED';
  message: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  requestId: string | null;
  plan: Plan;
}

export interface CustomPlanState {
  request: {
    id: string;
    status: CustomPlanRequestStatus;
    requestedAt: string;
    ticketId: string;
    ticketNumber: string;
    open: boolean;
  } | null;
  offers: CustomPlanOffer[];
  created?: boolean;
}

export interface BillingOverview extends SubscriptionOverview {
  wallet: WalletSummary;
  usage: CurrentUsage;
  customPlan: CustomPlanState;
}

export type PlanRelation = 'current' | 'upgrade' | 'downgrade' | 'contact';

export interface AvailablePlans {
  current: Subscription;
  plans: (Plan & { isCurrent: boolean; relation: PlanRelation })[];
}

export type CheckoutRequest =
  | { kind: 'plan'; planId: string }
  | { kind: 'renewal' }
  | { kind: 'topup'; topUpPackageId: string }
  | { kind: 'offer'; offerId: string };

export interface CheckoutQuote {
  purpose: PaymentPurpose;
  description: string;
  credits: number;
  currency: string;
  subtotalPaise: number;
  discountPercent: number | null;
  discountPaise: number;
  discountReason: string | null;
  taxPercent: number;
  taxPaise: number;
  totalPaise: number;
  lineItems: { label: string; amountPaise: number; credits?: number }[];
  summary: {
    type?: 'plan' | 'topup';
    planName?: string;
    planType?: PlanType;
    intervalLabel?: string;
    includedCredits?: number;
    features?: string[];
    renewsFrom?: string | null;
    name?: string;
    credits?: number;
  };
}

export interface CheckoutSession {
  paymentId: string;
  provider: string;
  providerOrderId: string;
  /** Publishable key for Checkout (null in mock/dev mode). */
  publicKey: string | null;
  amountPaise: number;
  currency: string;
  description: string;
  mock: boolean;
  prefill: { name: string | null; email: string | null; contact: string | null };
  quote: CheckoutQuote;
}

export interface PaymentOutcome {
  paymentId: string;
  status: PaymentStatus;
  purpose: PaymentPurpose;
  description: string | null;
  amountPaise: number;
  currency: string;
  credits: number;
  failureReason: string | null;
  receiptNumber: number | null;
  subscription: { id: string; planName: string | null; status: SubscriptionStatus; currentPeriodEnd: string | null } | null;
}

export interface PaymentRow {
  id: string;
  purpose: PaymentPurpose;
  paymentStatus: PaymentStatus;
  description: string | null;
  amount: number;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  taxPercent: number;
  currency: string;
  credits: number;
  paymentMethod: string | null;
  receiptNumber: number | null;
  receipt: string | null;
  failureReason: string | null;
  refundedPaise: number;
  paidAt: string | null;
  createdAt: string;
}

export interface CreditTransactionRow {
  id: string;
  type: CreditTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// ── Formatting ─────────────────────────────────────────────
export function formatMoney(paise: number, currency = 'INR') {
  const value = (paise ?? 0) / 100;
  if (currency === 'INR') {
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  }
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value);
}

/** Always two decimals (receipts, checkout totals). */
export function formatMoneyExact(paise: number, currency = 'INR') {
  const value = (paise ?? 0) / 100;
  if (currency === 'INR') {
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
}

export const formatCredits = (n: number) => (n ?? 0).toLocaleString('en-IN');

export function intervalLabel(v: Pick<PlanVersion, 'billingInterval' | 'intervalCount'> | null | undefined) {
  if (!v) return '';
  if (v.billingInterval === 'CUSTOM') return `${v.intervalCount} days`;
  const unit = v.billingInterval === 'YEAR' ? 'year' : 'month';
  return v.intervalCount > 1 ? `${v.intervalCount} ${unit}s` : unit;
}

export function formatDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  SUBSCRIPTION_PURCHASE: 'Plan purchase',
  SUBSCRIPTION_RENEWAL: 'Plan renewal',
  SUBSCRIPTION_UPGRADE: 'Plan upgrade',
  TOPUP: 'Credit top-up',
  CUSTOM_PLAN: 'Custom plan',
  LEGACY: 'Legacy payment',
};

export const CREDIT_TX_LABEL: Record<CreditTransactionType, string> = {
  SUBSCRIPTION_ALLOCATION: 'Plan credits added',
  USAGE_DEBIT: 'Usage',
  TOPUP_PURCHASE: 'Top-up',
  ADMIN_ADJUSTMENT: 'Adjustment',
  REFUND: 'Refund',
  EXPIRATION: 'Expired',
  PROMOTION: 'Promotion',
  MIGRATION: 'Transition credits',
};

// ── Public ─────────────────────────────────────────────────
export const getPublicPricing = () => api.get<PublicPricing>('/billing/plans').then((r) => r.data);

// ── Customer ───────────────────────────────────────────────
export const getBillingOverview = () => api.get<BillingOverview>('/billing/overview').then((r) => r.data);
export const getAvailablePlans = () => api.get<AvailablePlans>('/billing/plans/available').then((r) => r.data);
export const getCreditSummary = () => api.get<WalletSummary>('/billing/credits').then((r) => r.data);
export const getCreditHistory = (page = 1, type?: CreditTransactionType) =>
  api
    .get<Paginated<CreditTransactionRow>>('/billing/credits/history', { params: { page, ...(type ? { type } : {}) } })
    .then((r) => r.data);
export const getPayments = (page = 1) =>
  api.get<Paginated<PaymentRow>>('/billing/payments', { params: { page } }).then((r) => r.data);
export const getTopUps = () => api.get<TopUpPackage[]>('/billing/topups').then((r) => r.data);

export const quoteCheckout = (req: CheckoutRequest) =>
  api.post<CheckoutQuote>('/billing/checkout/quote', req).then((r) => r.data);
export const startCheckout = (req: CheckoutRequest) =>
  api.post<CheckoutSession>('/billing/checkout', req).then((r) => r.data);
export const verifyPayment = (
  paymentId: string,
  proof: { providerOrderId: string; providerPaymentId: string; signature: string },
) => api.post<PaymentOutcome>(`/billing/payments/${paymentId}/verify`, proof).then((r) => r.data);
export const reportPaymentFailure = (
  paymentId: string,
  info: { providerPaymentId?: string; code?: string; description?: string },
) => api.post<PaymentOutcome>(`/billing/payments/${paymentId}/failure`, info).then((r) => r.data);
export const getPaymentOutcome = (paymentId: string) =>
  api.get<PaymentOutcome>(`/billing/payments/${paymentId}`).then((r) => r.data);

export const cancelSubscription = () => api.post<Subscription>('/billing/subscription/cancel').then((r) => r.data);
export const resumeSubscription = () => api.post<Subscription>('/billing/subscription/resume').then((r) => r.data);
export const scheduleDowngrade = (planId: string) =>
  api.post<Subscription>('/billing/subscription/downgrade', { planId }).then((r) => r.data);

export const requestCustomPlan = () => api.post<CustomPlanState>('/billing/custom-plan/request').then((r) => r.data);
export const getCustomPlanState = () => api.get<CustomPlanState>('/billing/custom-plan/request').then((r) => r.data);
export const getOffer = (id: string) => api.get<CustomPlanOffer>(`/billing/offers/${id}`).then((r) => r.data);

export const getOffers = () => api.get<CustomPlanOffer[]>('/billing/offers').then((r) => r.data);

// ── Saved payment methods (never charged automatically) ────
export interface SavedPaymentMethod {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | string | null;
  expYear: number | string | null;
  /** Saved under the previous billing model. */
  legacy: boolean;
}
export const getPaymentMethods = () =>
  api
    .get<SavedPaymentMethod[] | { data?: SavedPaymentMethod[] }>('/billing/payment-methods')
    .then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? []));
export const removePaymentMethod = (id: string) =>
  api.delete(`/billing/payment-method/${encodeURIComponent(id)}`).then((r) => r.data);

// ── Usage (credits consumed) ───────────────────────────────
export const getCurrentUsage = () => api.get<CurrentUsage>('/billing/current-usage').then((r) => r.data);

export interface CallUsageRow {
  id: string;
  callId: string;
  audioMinutes: number;
  videoMinutes: number;
  screenShareMinutes: number;
  participants: number;
  creditsCharged: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  durationSeconds?: { callSeconds?: number; audioSeconds: number; videoSeconds: number; screenShareSeconds: number };
}
export const getCallUsage = (page = 1) =>
  api.get<Paginated<CallUsageRow>>('/billing/call-usage', { params: { page } }).then((r) => r.data);

// ── Legacy usage invoices (previous billing model, read-only) ──
export interface LegacyUsageInvoice {
  id: string;
  invoiceNumber: string | null;
  cycleStart: string;
  cycleEnd: string;
  totalPaise: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
}
export const getLegacyUsageInvoices = (page = 1) =>
  api.get<Paginated<LegacyUsageInvoice>>('/billing/usage-invoices', { params: { page } }).then((r) => r.data);

/** Human label for a subscription status. */
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  DRAFT: 'Draft',
  PENDING_PAYMENT: 'Awaiting payment',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  EXPIRED: 'Expired',
  CANCELED: 'Cancelled',
  SUSPENDED: 'Suspended',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const CREDIT_SOURCE_LABEL: Record<CreditBucketView['source'], string> = {
  SUBSCRIPTION: 'Plan credits',
  TOPUP: 'Top-up',
  PROMOTION: 'Promotion',
  ADMIN: 'Adjustment',
  MIGRATION: 'Transition credits',
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** Media used by a USAGE_DEBIT ledger row, from its metadata. */
export function usageBreakdown(meta: Record<string, unknown> | null | undefined) {
  const m = meta ?? {};
  return [
    { key: 'audio', label: 'Audio', minutes: num(m.audioMinutes), credits: num(m.audioCredits) },
    { key: 'video', label: 'Video', minutes: num(m.videoMinutes), credits: num(m.videoCredits) },
    { key: 'screenShare', label: 'Screen share', minutes: num(m.screenShareMinutes), credits: num(m.screenShareCredits) },
  ];
}

/** One-line description for a credit ledger row. */
export function describeCreditTransaction(row: Pick<CreditTransactionRow, 'type' | 'metadata' | 'referenceId'>) {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  switch (row.type) {
    case 'USAGE_DEBIT': {
      const callId = str(m.callId) ?? row.referenceId;
      const used = usageBreakdown(m).filter((p) => p.minutes > 0);
      const media = used.length
        ? used.map((p) => `${p.label} ${p.minutes.toFixed(2)} participant-min`).join(' · ')
        : 'No metered media';
      return `${callId ? `Call ${callId.slice(0, 12)}` : 'Call'} · ${media}`;
    }
    case 'SUBSCRIPTION_ALLOCATION':
      return str(m.plan) ? `${m.plan} plan credits${m.renewal ? ' (renewal)' : ''}` : 'Plan credits';
    case 'TOPUP_PURCHASE':
      return str(m.name) ?? str(m.packageName) ?? 'Credit top-up';
    case 'ADMIN_ADJUSTMENT':
    case 'PROMOTION':
    case 'MIGRATION':
    case 'REFUND':
      return str(m.reason) ?? CREDIT_TX_LABEL[row.type];
    case 'EXPIRATION':
      return 'Unused credits expired';
    default:
      return CREDIT_TX_LABEL[row.type] ?? row.type;
  }
}

/** Pull a readable message out of an axios error. */
export function billingErrorMessage(e: unknown, fallback = 'Something went wrong. Please try again.') {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

export async function downloadReceipt(paymentId: string, filename: string) {
  const res = await api.get(`/billing/receipts/${paymentId}/pdf`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
