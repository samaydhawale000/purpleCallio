/**
 * Typed client for the prepaid billing API. Every price, credit amount,
 * feature and rate shown anywhere in the app comes from these endpoints —
 * never hard-code pricing in components.
 *
 *   Public:   GET /billing/plans (plans + features + top-ups + credit rates)
 *   Customer: /billing/overview, /billing/plans/available, /billing/checkout…
 *   Admin:    /admin/billing/*
 */
import { api } from "./api";
import { formatMinutes } from "./duration";

// ── Shared types ───────────────────────────────────────────
export type PlanType = "FREE" | "PAID" | "CUSTOM";
export type PlanStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type BillingInterval = "MONTH" | "YEAR" | "CUSTOM";
export type PlanCtaAction = "SIGNUP" | "CHECKOUT" | "CONTACT_SALES";
export type SubscriptionStatus =
  | "DRAFT"
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "PAST_DUE"
  | "EXPIRED"
  | "CANCELED"
  | "SUSPENDED";
export type PaymentStatus =
  | "PENDING"
  | "PAID"
  | "FAILED"
  | "REFUNDED"
  | "CANCELLED"
  | "EXPIRED";
export type PaymentPurpose =
  | "SUBSCRIPTION_PURCHASE"
  | "SUBSCRIPTION_RENEWAL"
  | "SUBSCRIPTION_UPGRADE"
  | "TOPUP"
  | "AUTO_TOPUP"
  | "CUSTOM_PLAN"
  | "LEGACY";
export type CreditTransactionType =
  | "SUBSCRIPTION_ALLOCATION"
  | "USAGE_DEBIT"
  | "TOPUP_PURCHASE"
  | "ADMIN_ADJUSTMENT"
  | "REFUND"
  | "EXPIRATION"
  | "PROMOTION"
  | "MIGRATION";
export type CustomPlanRequestStatus =
  | "NEW"
  | "CONTACTED"
  | "NEGOTIATING"
  | "PROPOSAL_SENT"
  | "ACCEPTED"
  | "REJECTED"
  | "CLOSED";

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
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  displayOrder: number;
  isPopular: boolean;
}

export interface CreditRates {
  audioCreditsPerMinute: number;
  videoCreditsPerMinute: number;
  screenShareCreditsPerMinute: number;
  /** Credits per minute of an AI voice agent call (absent on older servers). */
  aiCreditsPerMinute?: number;
  taxPercent: number;
  topUpExpiryPolicy: "NEVER" | "DAYS" | "SUBSCRIPTION_END";
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
    mediaCredits: {
      audio: number | null;
      video: number | null;
      screenShare: number | null;
    };
  } | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanId: string | null;
  activatedAt: string | null;
  expiredAt: string | null;
  canceledAt: string | null;
  migrationSource: string | null;
  /** Renews automatically on a card / UPI Autopay mandate. */
  autoRenew: boolean;
  /** Provider mandate state (created | authenticated | active | pending | halted | cancelled …). */
  autoRenewStatus: string | null;
  /** What the next automatic renewal will charge (incl. GST). */
  renewalAmountPaise: number | null;
  /** Why the system switched auto-renew off (renewal_failed, renewal_terms_changed, …). */
  autoRenewOffReason: string | null;
}

/** Customer-facing grouping of a credit lot (server-provided). */
export type CreditSourceKind = "purchased" | "promotional" | "plan" | "other";

export interface CreditBucketView {
  id: string;
  source: "SUBSCRIPTION" | "TOPUP" | "PROMOTION" | "ADMIN" | "MIGRATION";
  /** Server grouping of this lot (purchased / promotional / plan / other). */
  sourceKind?: CreditSourceKind;
  initialAmount: number;
  remaining: number;
  expiresAt: string | null;
  createdAt: string;
}

/** Remaining credits per source group, computed by the server. */
export interface CreditsBySource {
  purchased: number;
  promotional: number;
  plan: number;
  other: number;
}

/** Prepaid feature access: unlocked by the first fulfilled credit purchase. */
export interface PrepaidStatus {
  since: string | null;
  featuresUnlocked: boolean;
}

/** Whether this account may buy credits right now (server decides). */
export interface PurchaseEligibility {
  eligible: boolean;
  code?: string;
  reason?: string;
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
  /** Present on servers with prepaid wallets (`GET /billing/credits`). */
  bySource?: CreditsBySource;
  prepaid?: PrepaidStatus;
  purchase?: PurchaseEligibility;
}

export interface SubscriptionOverview {
  subscription: Subscription;
  plan: {
    id: string;
    slug: string;
    name: string;
    type: PlanType;
    status: PlanStatus;
    currentVersionId: string | null;
  } | null;
  /** Renewal price/credits (plan's current version). Null on Free. */
  renewal: {
    planId: string;
    pricePaise: number;
    includedCredits: number;
    termsChanged: boolean;
  } | null;
  scheduledPlan: {
    id: string;
    name: string;
    type: PlanType;
    pricePaise: number;
  } | null;
  /** A paid plan that ended recently while the customer is back on Free. */
  lastEndedPaidSubscription: Subscription | null;
  pendingCheckout: {
    id: string;
    planName: string | null;
    createdAt: string;
  } | null;
  /** Null on the Free plan. */
  autoRenew: AutoRenewState | null;
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
  credits: {
    audio: number;
    video: number;
    screenShare: number;
    total: number;
    charged: number;
  };
  creditRates: {
    audioCreditsPerMinute: number;
    videoCreditsPerMinute: number;
    screenShareCreditsPerMinute: number;
    aiCreditsPerMinute?: number;
  };
  /** AI voice calls billed this period (billed separately from `usage`). */
  ai?: { sessions: number; minutes: number; credits: number };
  wallet: WalletSummary;
  subscription: Subscription;
}

export interface CustomPlanOffer {
  id: string;
  status: "SENT" | "ACCEPTED" | "WITHDRAWN" | "EXPIRED";
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

export type PlanRelation = "current" | "upgrade" | "downgrade" | "contact";

export interface AvailablePlans {
  current: Subscription;
  plans: (Plan & { isCurrent: boolean; relation: PlanRelation })[];
}

export interface AutoRenewState {
  autoRenew: boolean;
  status: string | null;
  renewalAmountPaise: number | null;
  nextChargeAt: string | null;
  offReason: string | null;
}

export type CheckoutRequest = (
  | { kind: "plan"; planId: string }
  | { kind: "renewal" }
  | { kind: "topup"; topUpPackageId: string }
  | { kind: "creditAmount"; amountPaise: number; currency?: string }
  | { kind: "offer"; offerId: string }
) & {
  /** Plan/offer purchases: set up auto-renew (defaults to the admin setting, on). */
  autoRenew?: boolean;
};

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
  quoteExpiresAt: string;
  lineItems: { label: string; amountPaise: number; credits?: number }[];
  /** Auto-renew option for this checkout (plan/offer purchases only). */
  autoRenew: { available: boolean; on: boolean; amountPaise: number | null };
  summary: {
    type?: "plan" | "topup";
    planName?: string;
    planType?: PlanType;
    intervalLabel?: string;
    includedCredits?: number;
    features?: string[];
    renewsFrom?: string | null;
    pricingVersion?: number;
    creditPricePaise?: number;
    amountPaise?: number;
    creditAllocationPaise?: number;
    unallocatedRemainderPaise?: number;
    expiryAt?: string;
    name?: string;
    credits?: number;
  };
}

export interface CheckoutSession {
  paymentId: string;
  /** `order` = one-time payment; `subscription` = first charge of an auto-renew mandate. */
  mode: "order" | "subscription";
  provider: string;
  providerOrderId: string | null;
  providerSubscriptionId: string | null;
  /** Publishable key for Checkout (null in mock/dev mode). */
  publicKey: string | null;
  amountPaise: number;
  currency: string;
  description: string;
  mock: boolean;
  prefill: {
    name: string | null;
    email: string | null;
    contact: string | null;
  };
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
  subscription: {
    id: string;
    planName: string | null;
    status: SubscriptionStatus;
    currentPeriodEnd: string | null;
  } | null;
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
  /** Expiry of the credit lot this row created, when it created one. */
  expiresAt?: string | null;
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
export function formatMoney(paise: number, currency = "INR") {
  const value = (paise ?? 0) / 100;
  if (currency === "INR") {
    return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  }
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(
    value,
  );
}

/** Always two decimals (receipts, checkout totals). */
export function formatMoneyExact(paise: number, currency = "INR") {
  const value = (paise ?? 0) / 100;
  if (currency === "INR") {
    return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export const formatCredits = (n: number) => (n ?? 0).toLocaleString("en-IN");

export function intervalLabel(
  v: Pick<PlanVersion, "billingInterval" | "intervalCount"> | null | undefined,
) {
  if (!v) return "";
  if (v.billingInterval === "CUSTOM") return `${v.intervalCount} days`;
  const unit = v.billingInterval === "YEAR" ? "year" : "month";
  return v.intervalCount > 1 ? `${v.intervalCount} ${unit}s` : unit;
}

export function formatDate(iso: string | null | undefined) {
  return iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
}

export const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  SUBSCRIPTION_PURCHASE: "Plan purchase",
  SUBSCRIPTION_RENEWAL: "Plan renewal",
  SUBSCRIPTION_UPGRADE: "Plan upgrade",
  TOPUP: "Credit purchase",
  AUTO_TOPUP: "Auto top-up",
  CUSTOM_PLAN: "Custom plan",
  LEGACY: "Legacy payment",
};

export const CREDIT_TX_LABEL: Record<CreditTransactionType, string> = {
  SUBSCRIPTION_ALLOCATION: "Plan credits added",
  USAGE_DEBIT: "Usage",
  TOPUP_PURCHASE: "Purchase",
  ADMIN_ADJUSTMENT: "Adjustment",
  REFUND: "Refund",
  EXPIRATION: "Expired",
  PROMOTION: "Promotion",
  MIGRATION: "Transition credits",
};

// ── Public ─────────────────────────────────────────────────
export const getPublicPricing = () =>
  api.get<PublicPricing>("/billing/plans").then((r) => r.data);

// ── Customer ───────────────────────────────────────────────
export const getBillingOverview = () =>
  api.get<BillingOverview>("/billing/overview").then((r) => r.data);
export const getAvailablePlans = () =>
  api.get<AvailablePlans>("/billing/plans/available").then((r) => r.data);
export const getCreditSummary = () =>
  api.get<WalletSummary>("/billing/credits").then((r) => r.data);
export const getCreditHistory = (page = 1, type?: CreditTransactionType) =>
  api
    .get<
      Paginated<CreditTransactionRow>
    >("/billing/credits/history", { params: { page, ...(type ? { type } : {}) } })
    .then((r) => r.data);
export const getPayments = (page = 1) =>
  api
    .get<Paginated<PaymentRow>>("/billing/payments", { params: { page } })
    .then((r) => r.data);
export const getTopUps = () =>
  api.get<TopUpPackage[]>("/billing/topups").then((r) => r.data);
export interface PublishedCreditPricing {
  id: string;
  version: number;
  currency: string;
  creditPricePaise: number;
  minimumPurchasePaise: number;
  maximumPurchasePaise: number | null;
  minimumCredits: number;
  maximumCredits: number | null;
  purchasedValidityDays: number;
}
export const getPublishedCreditPricing = (currency = "INR") =>
  api
    .get<PublishedCreditPricing | null>("/billing/credit-pricing/current", {
      params: { currency },
    })
    .then((r) => r.data);
export const getPublishedCreditPrices = () =>
  api
    .get<PublishedCreditPricing[]>("/billing/credit-pricing")
    .then((r) => r.data);

export const quoteCheckout = (req: CheckoutRequest) =>
  api.post<CheckoutQuote>("/billing/checkout/quote", req).then((r) => r.data);
export const startCheckout = (req: CheckoutRequest) =>
  api.post<CheckoutSession>("/billing/checkout", req).then((r) => r.data);
export const verifyPayment = (
  paymentId: string,
  proof: {
    providerOrderId?: string | null;
    providerSubscriptionId?: string | null;
    providerPaymentId: string;
    signature: string;
  },
) =>
  api
    .post<PaymentOutcome>(`/billing/payments/${paymentId}/verify`, proof)
    .then((r) => r.data);
export const reportPaymentFailure = (
  paymentId: string,
  info: { providerPaymentId?: string; code?: string; description?: string },
) =>
  api
    .post<PaymentOutcome>(`/billing/payments/${paymentId}/failure`, info)
    .then((r) => r.data);
export const getPaymentOutcome = (paymentId: string) =>
  api.get<PaymentOutcome>(`/billing/payments/${paymentId}`).then((r) => r.data);

export const cancelSubscription = () =>
  api.post<Subscription>("/billing/subscription/cancel").then((r) => r.data);
export interface MandateSession {
  mode: "mandate";
  provider: string;
  providerSubscriptionId: string;
  publicKey: string | null;
  mock: boolean;
  description: string;
  renewalAmountPaise: number;
  currency: string;
  firstChargeAt: string | null;
  prefill: {
    name: string | null;
    email: string | null;
    contact: string | null;
  };
}
/** Turn auto-renew on (returns a mandate to authorize) or off. */
export const startAutoRenew = () =>
  api
    .post<MandateSession>("/billing/subscription/auto-renew", { enabled: true })
    .then((r) => r.data);
export const stopAutoRenew = () =>
  api
    .post<AutoRenewState>("/billing/subscription/auto-renew", {
      enabled: false,
    })
    .then((r) => r.data);
export const verifyAutoRenew = (proof: {
  providerSubscriptionId: string;
  providerPaymentId: string;
  signature: string;
}) =>
  api
    .post<AutoRenewState>("/billing/subscription/auto-renew/verify", proof)
    .then((r) => r.data);

export const resumeSubscription = () =>
  api.post<Subscription>("/billing/subscription/resume").then((r) => r.data);
export const scheduleDowngrade = (planId: string) =>
  api
    .post<Subscription>("/billing/subscription/downgrade", { planId })
    .then((r) => r.data);

export const requestCustomPlan = () =>
  api.post<CustomPlanState>("/billing/custom-plan/request").then((r) => r.data);
export const getCustomPlanState = () =>
  api.get<CustomPlanState>("/billing/custom-plan/request").then((r) => r.data);
export const getOffer = (id: string) =>
  api.get<CustomPlanOffer>(`/billing/offers/${id}`).then((r) => r.data);

export const getOffers = () =>
  api.get<CustomPlanOffer[]>("/billing/offers").then((r) => r.data);

// ── Saved payment methods (listing / removal only) ────
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
    .get<
      SavedPaymentMethod[] | { data?: SavedPaymentMethod[] }
    >("/billing/payment-methods")
    .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? [])));
export const removePaymentMethod = (id: string) =>
  api
    .delete(`/billing/payment-method/${encodeURIComponent(id)}`)
    .then((r) => r.data);

// ── Usage (credits consumed) ───────────────────────────────
export const getCurrentUsage = () =>
  api.get<CurrentUsage>("/billing/current-usage").then((r) => r.data);

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
  durationSeconds?: {
    callSeconds?: number;
    audioSeconds: number;
    videoSeconds: number;
    screenShareSeconds: number;
  };
}
export const getCallUsage = (page = 1) =>
  api
    .get<Paginated<CallUsageRow>>("/billing/call-usage", { params: { page } })
    .then((r) => r.data);

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
  api
    .get<
      Paginated<LegacyUsageInvoice>
    >("/billing/usage-invoices", { params: { page } })
    .then((r) => r.data);

/** Human label for a subscription status. */
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  DRAFT: "Draft",
  PENDING_PAYMENT: "Awaiting payment",
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  EXPIRED: "Expired",
  CANCELED: "Cancelled",
  SUSPENDED: "Suspended",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export const CREDIT_SOURCE_LABEL: Record<CreditBucketView["source"], string> = {
  SUBSCRIPTION: "Plan credits",
  TOPUP: "Purchased",
  PROMOTION: "Promotion",
  ADMIN: "Adjustment",
  MIGRATION: "Transition credits",
};

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;

/** Media used by a USAGE_DEBIT ledger row, from its metadata. */
export function usageBreakdown(
  meta: Record<string, unknown> | null | undefined,
) {
  const m = meta ?? {};
  return [
    {
      key: "audio",
      label: "Audio",
      minutes: num(m.audioMinutes),
      credits: num(m.audioCredits),
    },
    {
      key: "video",
      label: "Video",
      minutes: num(m.videoMinutes),
      credits: num(m.videoCredits),
    },
    {
      key: "screenShare",
      label: "Screen share",
      minutes: num(m.screenShareMinutes),
      credits: num(m.screenShareCredits),
    },
  ];
}

/** Ledger reference the server uses for AI voice call debits. */
export const AI_SESSION_REFERENCE = "AI_SESSION";

/** Minutes and credits of an AI voice call debit, or null for any other row. */
export function aiLedgerUsage(
  row: Pick<CreditTransactionRow, "metadata"> & {
    referenceType?: string | null;
    amount?: number;
  },
) {
  if (row.referenceType !== AI_SESSION_REFERENCE) return null;
  const m = row.metadata ?? {};
  const credits =
    row.amount !== undefined
      ? Math.abs(row.amount)
      : num(m.aiCredits) - num(m.shortfall);
  return { minutes: num(m.aiMinutes), credits };
}

/** "1.5" / "12" — AI minutes with at most two decimals. */
export function formatAiMinutes(minutes: number) {
  return minutes.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** One-line description for a credit ledger row. */
export function describeCreditTransaction(
  row: Pick<CreditTransactionRow, "type" | "metadata" | "referenceId"> & {
    referenceType?: string | null;
    amount?: number;
  },
) {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  switch (row.type) {
    case "USAGE_DEBIT": {
      const ai = aiLedgerUsage(row);
      if (ai)
        return `AI voice call: ${formatAiMinutes(ai.minutes)} min, ${formatCredits(ai.credits)} credits`;
      const callId = str(m.callId) ?? row.referenceId;
      const used = usageBreakdown(m).filter((p) => p.minutes > 0);
      const media = used.length
        ? used.map((p) => `${p.label} ${formatMinutes(p.minutes)}`).join(" · ")
        : "No metered media";
      return `${callId ? `Call ${callId.slice(0, 12)}` : "Call"} · ${media}`;
    }
    case "SUBSCRIPTION_ALLOCATION":
      return str(m.plan)
        ? `${m.plan} plan credits${m.renewal ? " (renewal)" : ""}`
        : "Plan credits";
    case "TOPUP_PURCHASE":
      if (isAutoTopUpLedgerRow(row)) return "Automatic top-up";
      return (
        str(m.name) ?? str(m.packageName) ?? str(m.description) ?? "Credit purchase"
      );
    case "ADMIN_ADJUSTMENT":
    case "PROMOTION":
    case "MIGRATION":
    case "REFUND":
      return str(m.reason) ?? CREDIT_TX_LABEL[row.type];
    case "EXPIRATION":
      return "Unused credits expired";
    default:
      return CREDIT_TX_LABEL[row.type] ?? row.type;
  }
}

/** Pull a readable message out of an axios error. */
export function billingErrorMessage(
  e: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response
    ?.data?.message;
  if (Array.isArray(msg)) return msg.join(", ");
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

export async function downloadReceipt(paymentId: string, filename: string) {
  const res = await api.get(`/billing/receipts/${paymentId}/pdf`, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(
    new Blob([res.data], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// ── Prepaid ledger (cursor or page pagination) ─────────────
/**
 * Ledger filters shown to customers. `AUTO_TOPUP` is a purchase made by
 * Auto Top-Up (server filter); the rest are ledger transaction types.
 */
export type LedgerFilter =
  | ""
  | "TOPUP_PURCHASE"
  | "AUTO_TOPUP"
  | "USAGE_DEBIT"
  | "PROMOTION"
  | "EXPIRATION"
  | "REFUND"
  | "ADMIN_ADJUSTMENT";

export const LEDGER_FILTERS: { value: LedgerFilter; label: string }[] = [
  { value: "", label: "All activity" },
  { value: "TOPUP_PURCHASE", label: "Purchases" },
  { value: "AUTO_TOPUP", label: "Auto top-ups" },
  { value: "USAGE_DEBIT", label: "Usage" },
  { value: "PROMOTION", label: "Promotions" },
  { value: "EXPIRATION", label: "Expiries" },
  { value: "REFUND", label: "Refunds" },
  { value: "ADMIN_ADJUSTMENT", label: "Adjustments" },
];

/** True for a purchase row that Auto Top-Up created. */
export function isAutoTopUpLedgerRow(
  row: Pick<CreditTransactionRow, "metadata"> & {
    type?: CreditTransactionType;
    referenceType?: string | null;
  },
) {
  const m = row.metadata ?? {};
  return (
    m.purpose === "AUTO_TOPUP" ||
    m.autoTopUp === true ||
    typeof m.autoTopUpAttemptId === "string" ||
    row.referenceType === "AutoTopUpAttempt"
  );
}

/** Pricing version a ledger row was bought at (number), when recorded. */
export function ledgerPricingVersion(row: Pick<CreditTransactionRow, "metadata">) {
  const v = row.metadata?.pricingVersion ?? row.metadata?.creditPricingVersion;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface LedgerPage {
  rows: CreditTransactionRow[];
  /** Cursor for the next page (cursor-paginated servers). */
  nextCursor: string | null;
  /** Next page number (page-paginated servers). */
  nextPage: number | null;
}

/**
 * One page of `/billing/credits/history`. Accepts both the cursor shape
 * (`{ items|data, nextCursor }`) and the older page shape
 * (`{ data, page, pageCount }`).
 */
export async function getCreditLedger(
  opts: { type?: LedgerFilter; cursor?: string | null; page?: number; limit?: number } = {},
): Promise<LedgerPage> {
  const params: Record<string, string | number> = { limit: opts.limit ?? 20 };
  if (opts.type) params.type = opts.type;
  if (opts.cursor) params.cursor = opts.cursor;
  else if (opts.page && opts.page > 1) params.page = opts.page;
  const { data } = await api.get<
    | (Partial<Paginated<CreditTransactionRow>> & {
        items?: CreditTransactionRow[];
        nextCursor?: string | null;
      })
    | null
  >("/billing/credits/history", { params });
  const rows = data?.items ?? data?.data ?? [];
  if (data && "nextCursor" in data) {
    return { rows, nextCursor: data.nextCursor ?? null, nextPage: null };
  }
  const page = data?.page ?? 1;
  const pageCount = data?.pageCount ?? 1;
  return { rows, nextCursor: null, nextPage: page < pageCount ? page + 1 : null };
}

// ── Auto Top-Up ────────────────────────────────────────────
export type AutoTopUpAttemptStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type AutoTopUpAttentionReason =
  | "payment_failed"
  | "mandate_inactive"
  | "authentication_required";

export interface AutoTopUpSetting {
  id?: string;
  enabled: boolean;
  thresholdCredits: number;
  amountPaise: number;
  monthlyLimitPaise: number;
  currency: string;
  /** NONE | PENDING | ACTIVE | REVOKED | EXPIRED | FAILED … (provider mandate state). */
  mandateStatus: string | null;
  consentAt?: string | null;
  consentVersion?: string | null;
  attentionReason?: AutoTopUpAttentionReason | string | null;
  disabledReason?: string | null;
  lastSucceededAt?: string | null;
  updatedAt?: string;
}

export interface AutoTopUpAttempt {
  id: string;
  status: AutoTopUpAttemptStatus;
  amountPaise: number;
  taxPaise: number;
  totalPaise: number;
  credits: number;
  currency: string;
  pricingVersion: number | null;
  triggerBalance: number | null;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  paymentId: string | null;
}

export interface AutoTopUpPricing {
  versionId: string;
  version: number;
  creditPricePaise: number;
  autoTopUpEnabled: boolean;
  minPaise: number;
  maxPaise: number | null;
  monthlyLimitMaxPaise: number | null;
  validityDays: number;
}

export interface AutoTopUpState {
  setting: AutoTopUpSetting | null;
  eligible: { ok: boolean; code?: string; reason?: string };
  pricing: AutoTopUpPricing | null;
  /** Server estimate for the saved setting. */
  preview: { credits: number; taxPaise: number; totalPaise: number } | null;
  month: { key: string; spentPaise: number; inFlightPaise: number; limitPaise: number };
  attempts: AutoTopUpAttempt[];
  /** Optional server-provided consent wording (falls back to the web copy). */
  consent?: { version: string; text?: string } | null;
}

export interface AutoTopUpSettingsInput {
  thresholdCredits: number;
  amountPaise: number;
  monthlyLimitPaise: number;
  currency?: string;
}

/** Checkout payload for authorizing the recurring mandate. */
export interface AutoTopUpMandateSession extends Omit<CheckoutSession, "mode" | "quote"> {
  mode?: string;
  customerId: string;
  recurring: true;
  quote?: CheckoutQuote;
}

export const AUTO_TOPUP_ATTEMPT_LABEL: Record<AutoTopUpAttemptStatus, string> = {
  PENDING: "Scheduled",
  PROCESSING: "Processing",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const AUTO_TOPUP_ATTENTION_TEXT: Record<string, string> = {
  payment_failed:
    "Your last automatic top-up payment was declined, so no credits were added.",
  mandate_inactive:
    "Your payment authorization is no longer active, so automatic top-ups can’t be charged.",
  authentication_required:
    "Your bank asked for additional authentication, so the automatic top-up couldn’t be charged.",
};

export const getAutoTopUp = () =>
  api.get<AutoTopUpState>("/billing/auto-topup").then((r) => r.data);
export const saveAutoTopUp = (input: AutoTopUpSettingsInput) =>
  api
    .post<{ setting: AutoTopUpSetting }>("/billing/auto-topup", input)
    .then((r) => r.data);
export const startAutoTopUpMandate = (consentVersion: string) =>
  api
    .post<AutoTopUpMandateSession>("/billing/auto-topup/mandate", {
      consent: true,
      consentVersion,
    })
    .then((r) => r.data);
export const verifyAutoTopUpMandate = (proof: {
  orderId: string;
  paymentId: string;
  signature: string;
}) =>
  api
    .post<{ setting: AutoTopUpSetting }>("/billing/auto-topup/mandate/verify", proof)
    .then((r) => r.data);
export const enableAutoTopUp = () =>
  api.post<{ setting: AutoTopUpSetting }>("/billing/auto-topup/enable").then((r) => r.data);
export const disableAutoTopUp = (revokeMandate = false) =>
  api
    .post<{ setting: AutoTopUpSetting }>("/billing/auto-topup/disable", { revokeMandate })
    .then((r) => r.data);
export const getAutoTopUpAttempts = (cursor?: string | null, limit = 20) =>
  api
    .get<{ items: AutoTopUpAttempt[]; nextCursor: string | null }>(
      "/billing/auto-topup/attempts",
      { params: { limit, ...(cursor ? { cursor } : {}) } },
    )
    .then((r) => r.data);

/** "1000.50" → 100050 minor units; null when not a valid amount (max 2 decimals). */
export function amountToMinor(raw: string): number | null {
  const value = String(raw ?? "").trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

/** Days from now until `iso` (negative when past); null without a date. */
export function daysUntil(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

/** Lots expiring within this many days are highlighted as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;
