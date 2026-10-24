# Prepaid billing

## Architecture reused

- `CreditWallet`, per-grant `CreditBucket`, and `CreditTransaction` remain the wallet and immutable movement ledger. `CreditService` serializes balance changes, consumes earliest-expiring lots first, and uses idempotency keys.
- `Payment`, `PaymentAttempt`, signature-verified Razorpay webhooks, and `BillingFulfillmentService` remain the payment path. New credit grants happen only after authoritative provider confirmation.
- Existing media, AI voice, and translation metering keep their configured credit rates. A change to rupee pricing does not change consumption rates.
- Existing subscription records, historical invoices, payments, webhook handling, and entitlements are retained for compatibility. New plan, renewal, and custom-offer checkout is rejected.

## Monetary credit purchases

The administrator creates a draft `CreditPricingVersion`, previews it, and explicitly publishes it. Published versions are immutable and may be scheduled. No credit price is seeded because the repository contains no single approved rate to preserve; an administrator must publish the approved rate before amount-based credit checkout is available.

The admin draft form exposes only currency (currently INR), price per credit, and purchased-credit validity (365 days by default). Prices use integer paise and allow up to two decimal places when entered in rupees; for example, ₹0.20 is stored as 20 paise per credit. Purchase limits remain server-side checkout policy (new drafts use the existing ₹1,000 minimum and no maximum by default), and Auto Top-Up is unavailable. Legacy optional limit keys sent by older clients are ignored during draft validation.

Checkout accepts a monetary amount. The server validates account eligibility and the active pricing version's amount/quantity limits, computes `floor(amountMinor / creditPriceMinor)`, and shows the value allocated to whole credits plus any remainder that is not carried forward. The existing discount and tax calculation remains unchanged and appears separately in the payable total. The payment snapshot retains the pricing version, rate, credits, quote expiry, and lot expiry. The browser cannot choose authoritative prices or credits.

Once a published price exists, fixed package checkout is disabled. Until then, existing fixed top-up packages remain a compatibility fallback; they are not used to infer or publish a per-credit price.

## Expiry, promotions, and access

New purchased lots use the published validity period (initially configured as 365 days) and UTC calendar-day expiry. Each purchase remains a separate bucket. Existing buckets and historical transactions are not rewritten. Promotional grants use a distinct promotion bucket and require an administrator, reason, idempotency key, expiry, audit entry, and customer notification.

An account may purchase if it is active, has completed its profile, and is not blocked by an administrator. Free accounts receive no recurring monthly credits. Promotional grants do not unlock paid prepaid access. First fulfilled credit purchase sets `prepaidSince` and unlocks the configured prepaid feature set.

## Subscription and Auto Top-Up status

Subscription plan purchase, renewal, upgrade, custom-offer checkout, and new subscription auto-renew setup are disabled. Historical subscription rows and provider webhooks are preserved. This code does not cancel provider mandates or alter existing paid terms. Before deployment, inventory active subscriptions and mandates and follow an approved customer migration/consent policy.

**Auto Top-Up is not implemented or available.** The schema includes future settings/attempt records and credit-pricing policy bounds, but there are no customer endpoints, authorized threshold-triggered provider charge, retry/reconciliation workflow, or customer configuration UI. The active `PaymentProvider` deliberately exposes customer-completed checkout and provider-scheduled subscription mandates only; it has no server-initiated charge operation. Razorpay saved-card tokens are not a merchant authorization for an off-session wallet charge: their normal reuse flow requires customer interaction. Razorpay Subscriptions are fixed plan-and-interval mandates, so the existing subscription auto-renew integration cannot safely be repurposed for a balance-threshold purchase. The marketing page and terms state that Auto Top-Up is unavailable.

To enable this feature, first obtain and verify a Razorpay product/API that explicitly permits variable, merchant-initiated threshold debits for the target market, including mandate registration, customer consent, pre-debit/AFA compliance, cancellation, and signed payment-status webhooks. Then add that capability to `PaymentProvider`, build the customer authorization and settings APIs, atomically claim threshold attempts from wallet debit events, and fulfill confirmed payments idempotently through `BillingFulfillmentService`. Do not use a saved-card token or a scheduled subscription mandate as a substitute.

## Schema and migrations

The database is PostgreSQL/Prisma (not MongoDB). Additive migrations are:

- `20261023120000_credit_pricing_versions`: immutable versioned price and purchase policy.
- `20261023130000_prepaid_access_auto_topup`: prepaid access/eligibility fields and future Auto Top-Up records.

Apply migrations through the normal deployment process after a database backup. Review migration SQL and the target database before applying. No production database, customer account, or Razorpay account was accessed during this code change.

## Relevant endpoints

- Customer: `GET /billing/credit-pricing/current`, `GET /billing/credit-pricing`, `GET /billing/credits`, existing credit history, quote, checkout, payment verification, and payment status endpoints.
- Admin: `GET /admin/billing/credit-pricing`, draft create/update, preview, confirmed publish/schedule, cancel, and `POST /admin/billing/promotional-credits`.
- Existing plan routes remain for historical data and account management where applicable, but new plan/renewal checkout is rejected.

## Validation run

- Prisma schema validation passed.
- Server Nest build passed.
- Web TypeScript check passed.
- Pricing utility and billing-config unit specs passed (15 tests).
- Focused web AI billing specs passed (9 tests).
- The billing integration command completed with both integration suites skipped because its database-backed prerequisites are unavailable in this environment. No migration was applied and no payment was made.
- ESLint could not run: this repository has no ESLint 9 `eslint.config.*` file.

Before launch, publish the approved credit rate, verify production environment/migration readiness, and perform provider test-mode checkout and webhook reconciliation. Auto Top-Up and production payment verification remain unverified.
