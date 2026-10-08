/**
 * Admin → Billing API client (`/admin/billing/*`). Shared customer-facing
 * types and formatters live in `./billing`; this file only adds admin
 * shapes and calls. Nothing here hard-codes a price, credit amount or
 * feature — all of it is configured through these endpoints.
 */
import { api } from './api';
import type {
  BillingInterval,
  CreditTransactionRow,
  CustomPlanOffer,
  CustomPlanRequestStatus,
  Paginated,
  PaymentPurpose,
  PaymentStatus,
  Plan,
  PlanCtaAction,
  PlanStatus,
  PlanType,
  PlanVersion,
  Subscription,
  SubscriptionOverview,
  SubscriptionStatus,
  TopUpPackage,
  WalletSummary,
} from './billing';

// ── Types ──────────────────────────────────────────────────
export interface UserRef {
  id: string;
  email: string;
  name: string | null;
  companyName?: string | null;
}

export interface AdminPlan extends Plan {
  assignedUser: UserRef | null;
  archivedAt: string | null;
  updatedAt: string;
  activeSubscribers: number;
}

export interface AdminPlanVersion extends PlanVersion {
  createdAt: string;
  createdById: string | null;
}

export interface AdminPlanDetail extends AdminPlan {
  versions: AdminPlanVersion[];
}

export interface PlanInput {
  slug?: string;
  name?: string;
  description?: string | null;
  badge?: string | null;
  type?: PlanType;
  status?: PlanStatus;
  displayOrder?: number;
  isPopular?: boolean;
  isPublic?: boolean;
  ctaLabel?: string | null;
  ctaAction?: PlanCtaAction;
  assignedUserId?: string | null;
  pricePaise?: number;
  currency?: string;
  billingInterval?: BillingInterval;
  intervalCount?: number;
  includedCredits?: number;
  includedAudioCredits?: number | null;
  includedVideoCredits?: number | null;
  includedScreenShareCredits?: number | null;
  features?: string[];
}

export interface AdminFeature {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  displayOrder: number;
  isActive: boolean;
  isPublic: boolean;
}

export type FeatureInput = Omit<AdminFeature, 'id'>;

export interface AdminTopUp extends TopUpPackage {
  purchases: number;
  updatedAt: string;
}

export type TopUpInput = Partial<
  Pick<TopUpPackage, 'name' | 'description' | 'pricePaise' | 'currency' | 'credits' | 'status' | 'displayOrder' | 'isPopular'>
>;

export type TopUpExpiryPolicy = 'NEVER' | 'DAYS' | 'SUBSCRIPTION_END';

export interface BillingConfig {
  id: string;
  audioCreditsPerMinute: number;
  videoCreditsPerMinute: number;
  screenShareCreditsPerMinute: number;
  taxPercent: number;
  lowCreditThresholds: number[];
  minimumCreditsToStartCall: number;
  topUpExpiryPolicy: TopUpExpiryPolicy;
  topUpExpiryDays: number | null;
  renewalReminderDays: number;
  pendingCheckoutTtlHours: number;
  /** Auto-renew checkbox pre-ticked at checkout. */
  autoRenewDefault: boolean;
  /** Hours an auto-renewing plan stays active past period end while the renewal charge is retried. */
  autoRenewGraceHours: number;
  updatedAt?: string;
}

export type BillingConfigUpdate = Partial<Omit<BillingConfig, 'id' | 'updatedAt'>>;

export interface AdminSubscriptionRow extends Subscription {
  customer: UserRef;
  createdAt: string;
  updatedAt: string;
}

/** Raw subscription rows returned by GET plans/:id/subscribers. */
export interface PlanSubscriberRow {
  id: string;
  status: SubscriptionStatus;
  planName: string | null;
  pricePaise: number;
  currency: string;
  includedCredits: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  planVersionId: string | null;
  company: UserRef;
}

export interface PaymentAttempt {
  id: string;
  providerPaymentId: string;
  status: string;
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  createdAt: string;
}

export interface AdminPaymentRow {
  id: string;
  userId: string | null;
  purpose: PaymentPurpose;
  paymentStatus: PaymentStatus;
  description: string | null;
  amount: number;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  currency: string;
  credits: number;
  paymentMethod: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  receiptNumber: number | null;
  receipt?: string | null;
  failureReason: string | null;
  refundedPaise: number;
  refundedAt?: string | null;
  paidAt: string | null;
  createdAt: string;
  user?: UserRef | null;
  attempts?: PaymentAttempt[];
}

export interface CustomerBilling extends SubscriptionOverview {
  customer: UserRef;
  wallet: WalletSummary;
  creditHistory: Paginated<CreditTransactionRow>;
  payments: AdminPaymentRow[];
  legacy: { hasSavedCard: boolean; spendingLimitPaise: number | null; usageInvoices: number };
}

export interface CreditAdjustmentInput {
  amount: number;
  reason: string;
  expiresAt?: string | null;
  promotion?: boolean;
}

export interface CustomPlanListRow {
  id: string;
  status: CustomPlanRequestStatus;
  requestedAt: string;
  updatedAt: string;
  customer: UserRef;
  assignedAdmin: UserRef | null;
  ticketId: string;
  ticketNumber: string;
  ticketStatus: string;
  hasUnread: boolean;
  offers: number;
}

export interface CustomPlanDetail {
  id: string;
  status: CustomPlanRequestStatus;
  notes: string | null;
  estimatedMonthlyCredits: number | null;
  requestedAt: string;
  closedAt: string | null;
  customer: UserRef & {
    phone: string | null;
    jobTitle: string | null;
    country: string | null;
    companyWebsite: string | null;
    expectedUsageRange: string | null;
    primaryUseCase: string | null;
    createdAt: string;
  };
  assignedAdmin: UserRef | null;
  ticket: { id: string; ticketNumber: string; status: string };
  subscription: Subscription;
  wallet: WalletSummary;
  usageLast30Days: { calls: number; audioMinutes: number; videoMinutes: number; screenShareMinutes: number; credits: number };
  payments: {
    id: string;
    purpose: PaymentPurpose;
    paymentStatus: PaymentStatus;
    amount: number;
    description: string | null;
    paidAt: string | null;
    createdAt: string;
    receiptNumber: number | null;
  }[];
  offers: CustomPlanOffer[];
}

export interface CustomPlanUpdate {
  status?: CustomPlanRequestStatus;
  assignedAdminId?: string | null;
  notes?: string | null;
  estimatedMonthlyCredits?: number | null;
}

export interface CustomOfferInput {
  name: string;
  description?: string | null;
  pricePaise: number;
  currency?: string;
  billingInterval?: BillingInterval;
  intervalCount?: number;
  includedCredits: number;
  includedAudioCredits?: number | null;
  includedVideoCredits?: number | null;
  includedScreenShareCredits?: number | null;
  features?: string[];
  message?: string | null;
  expiresAt?: string | null;
}

export interface RevenueSummary {
  totalPaise: number;
  prepaidNetPaise: number;
  refundedPaise: number;
  last30DaysPaise: number;
  legacyUsageInvoicePaise: number;
  payments: number;
  mrrPaise: number;
  arrPaise: number;
  activePaidSubscriptions: number;
  payingCustomers: number;
  recentPayments: AdminPaymentRow[];
}

export interface InternalRates {
  audioPaise: number;
  videoPaise: number;
  screenSharePaise: number;
  freeAudioMins?: number;
  freeVideoMins?: number;
  taxPercent?: number;
}

export interface AdminUsageSummary {
  since: string;
  usage: {
    audioMinutes: number;
    videoMinutes: number;
    screenShareMinutes: number;
    participants: number;
    internalCostPaise: number;
    callsCompleted: number;
    activeAccounts: number;
  };
  lineItems: {
    audioMinutes: number;
    videoMinutes: number;
    screenShareMinutes: number;
    participants: number;
    internalCostPaise: number;
    creditsCharged: number;
    calls: number;
  };
  creditsConsumed: number;
  internalRates: InternalRates;
  currency: string;
}

export interface SegmentAnalytics {
  since: string;
  segmentCount: number;
  totals: { audioMins: number; videoMins: number; screenShareMins: number; costPaise: number; calls: number };
}

export type MigrationSummary = Record<string, unknown> | null;

// ── Constants / labels ─────────────────────────────────────
export const PLAN_TYPES: PlanType[] = ['FREE', 'PAID', 'CUSTOM'];
export const PLAN_STATUSES: PlanStatus[] = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];
export const CTA_ACTIONS: PlanCtaAction[] = ['SIGNUP', 'CHECKOUT', 'CONTACT_SALES'];
export const BILLING_INTERVALS: BillingInterval[] = ['MONTH', 'YEAR', 'CUSTOM'];
export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'ACTIVE',
  'PENDING_PAYMENT',
  'PAST_DUE',
  'EXPIRED',
  'CANCELED',
  'SUSPENDED',
  'DRAFT',
];
export const PAYMENT_STATUSES: PaymentStatus[] = ['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED', 'EXPIRED'];
export const PAYMENT_PURPOSES: PaymentPurpose[] = [
  'SUBSCRIPTION_PURCHASE',
  'SUBSCRIPTION_RENEWAL',
  'SUBSCRIPTION_UPGRADE',
  'TOPUP',
  'CUSTOM_PLAN',
  'LEGACY',
];
export const CUSTOM_PLAN_STATUSES: CustomPlanRequestStatus[] = [
  'NEW',
  'CONTACTED',
  'NEGOTIATING',
  'PROPOSAL_SENT',
  'ACCEPTED',
  'REJECTED',
  'CLOSED',
];
export const CUSTOM_PLAN_STATUS_LABEL: Record<CustomPlanRequestStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  NEGOTIATING: 'Negotiating',
  PROPOSAL_SENT: 'Proposal sent',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
};
export const CTA_ACTION_LABEL: Record<PlanCtaAction, string> = {
  SIGNUP: 'Sign up',
  CHECKOUT: 'Checkout',
  CONTACT_SALES: 'Talk to our team',
};
export const INTERVAL_LABEL: Record<BillingInterval, string> = {
  MONTH: 'Monthly',
  YEAR: 'Yearly',
  CUSTOM: 'Custom (days)',
};

export function migrationSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source === 'legacy_payg_paying') return 'Legacy paying — review';
  if (source === 'legacy_payg') return 'Legacy PAYG';
  return source;
}

// ── Helpers ────────────────────────────────────────────────
/** "499.50" (₹) → 49950 paise. Returns NaN for anything that isn't a valid amount. */
export function rupeesToPaise(value: string | number): number {
  const s = String(value ?? '').trim();
  if (!s || !/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise == null) return '';
  const v = paise / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** "" → null, otherwise a non-negative integer (NaN when invalid). */
export function optionalInt(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

export function apiError(e: unknown, fallback = 'Something went wrong'): string {
  const err = e as { response?: { data?: { message?: unknown } }; message?: string };
  const msg = err?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  if (typeof msg === 'string' && msg) return msg;
  return err?.message || fallback;
}

export function isAuthError(e: unknown): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === 403;
}

const clean = (params: Record<string, string | number | boolean | undefined | null>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));

const B = '/admin/billing';
const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);

// ── Plans & features ───────────────────────────────────────
export const listAdminPlans = () => data(api.get<AdminPlan[]>(`${B}/plans`));
export const getAdminPlan = (id: string) => data(api.get<AdminPlanDetail>(`${B}/plans/${id}`));
export const createPlan = (input: PlanInput) => data(api.post<Plan>(`${B}/plans`, input));
export const updatePlan = (id: string, input: PlanInput) => data(api.patch<Plan>(`${B}/plans/${id}`, input));
export const archivePlan = (id: string) => data(api.post<Plan>(`${B}/plans/${id}/archive`));
export const duplicatePlan = (id: string) => data(api.post<Plan>(`${B}/plans/${id}/duplicate`));
export const listPlanSubscribers = (id: string, page = 1) =>
  data(api.get<Paginated<PlanSubscriberRow>>(`${B}/plans/${id}/subscribers`, { params: { page } }));

export const listAdminFeatures = () => data(api.get<AdminFeature[]>(`${B}/features`));
export const upsertFeature = (input: Partial<FeatureInput> & { key: string; name: string }) =>
  data(api.post<AdminFeature>(`${B}/features`, input));

// ── Top-ups ────────────────────────────────────────────────
export const listAdminTopUps = () => data(api.get<AdminTopUp[]>(`${B}/topups`));
export const createTopUp = (input: TopUpInput) => data(api.post<TopUpPackage>(`${B}/topups`, input));
export const updateTopUp = (id: string, input: TopUpInput) => data(api.patch<TopUpPackage>(`${B}/topups/${id}`, input));

// ── Config ─────────────────────────────────────────────────
export const getCreditRates = () => data(api.get<BillingConfig>(`${B}/credit-rates`));
export const updateCreditRates = (input: BillingConfigUpdate) => data(api.patch<BillingConfig>(`${B}/credit-rates`, input));
export const getBillingSettings = () => data(api.get<BillingConfig>(`${B}/settings`));
export const updateBillingSettings = (input: BillingConfigUpdate) => data(api.patch<BillingConfig>(`${B}/settings`, input));

// ── Subscriptions & payments ───────────────────────────────
export const listAdminSubscriptions = (p: { page?: number; status?: string; planId?: string; search?: string; legacy?: boolean }) =>
  data(
    api.get<Paginated<AdminSubscriptionRow>>(`${B}/subscriptions`, {
      params: clean({ ...p, legacy: p.legacy ? 'true' : undefined }),
    }),
  );
export const listAdminPayments = (p: { page?: number; status?: string; purpose?: string; search?: string; userId?: string }) =>
  data(api.get<Paginated<AdminPaymentRow>>(`${B}/payments`, { params: clean(p) }));
export const refundPayment = (id: string, reason: string) => data(api.post(`${B}/payments/${id}/refund`, { reason }));

// ── Customers ──────────────────────────────────────────────
export const getCustomerBilling = (id: string) => data(api.get<CustomerBilling>(`${B}/customers/${id}`));
export const adjustCustomerCredits = (id: string, input: CreditAdjustmentInput) =>
  data(api.post(`${B}/customers/${id}/credits`, input));

// ── Custom plans ───────────────────────────────────────────
export const listCustomPlans = (p: { page?: number; status?: string; search?: string }) =>
  data(api.get<Paginated<CustomPlanListRow>>(`${B}/custom-plans`, { params: clean(p) }));
export const getCustomPlan = (id: string) => data(api.get<CustomPlanDetail>(`${B}/custom-plans/${id}`));
export const updateCustomPlan = (id: string, input: CustomPlanUpdate) =>
  data(api.patch<CustomPlanDetail>(`${B}/custom-plans/${id}`, input));
export const createCustomOffer = (id: string, input: CustomOfferInput) =>
  data(api.post<CustomPlanDetail>(`${B}/custom-plans/${id}/offer`, input));
export const withdrawCustomOffer = (offerId: string) => data(api.post(`${B}/custom-plans/offers/${offerId}/withdraw`));

// ── Reporting ──────────────────────────────────────────────
export const getRevenue = () => data(api.get<RevenueSummary>(`${B}/revenue`));
export const getAdminUsageSummary = () => data(api.get<AdminUsageSummary>(`${B}/usage-summary`));
export const getSegmentAnalytics = () => data(api.get<SegmentAnalytics>(`${B}/segment-analytics`));
export const getInternalRates = () => data(api.get<InternalRates>(`${B}/internal-rates`));
export const updateInternalRates = (input: Partial<InternalRates>) => data(api.patch<InternalRates>(`${B}/internal-rates`, input));
export const getMigrationSummary = () => data(api.get<MigrationSummary>(`${B}/migration`));

/** Admin users, found by paging the customer list (no dedicated admin-list endpoint exists). */
export async function listAdminUsers(maxPages = 20): Promise<UserRef[]> {
  const admins: UserRef[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await api.get<Paginated<UserRef & { role?: string }>>('/admin/customers', { params: { page } });
    for (const u of res.data.data ?? []) {
      if (u.role === 'ADMIN') admins.push({ id: u.id, email: u.email, name: u.name, companyName: u.companyName ?? null });
    }
    if (page >= (res.data.pageCount ?? 1)) break;
  }
  return admins;
}
