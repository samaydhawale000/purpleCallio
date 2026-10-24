# Prepaid billing

## Architecture reused

- `CreditWallet`, per-grant `CreditBucket`, and `CreditTransaction` remain the wallet and immutable movement ledger. `CreditService` serializes balance changes, consumes earliest-expiring lots first, and uses idempotency keys.
- `Payment`, `PaymentAttempt`, signature-verified Razorpay webhooks, and `BillingFulfillmentService` remain the payment path. New credit grants happen only after authoritative provider confirmation.
- Existing media, AI voice, and translation metering keep their configured credit rates. A change to rupee pricing does not change consumption rates.
- Existing subscription records, historical invoices, payments, webhook handling, and entitlements are retained for compatibility. New plan, renewal, and custom-offer checkout is rejected.

## Monetary credit purchases

The administrator creates a draft `CreditPricingVersion`, previews it, and explicitly publishes it. Published versions are immutable and may be scheduled. No credit price is seeded because the repository contains no single approved rate to preserve; an administrator must publish the approved rate before amount-based credit checkout is available.

The admin draft form exposes currency (currently INR), price per credit, purchased-credit validity (365 days by default), and Auto Top-Up policy bounds. Prices use integer paise and allow up to two decimal places when entered in rupees; for example, ₹0.20 is stored as 20 paise per credit. Purchase limits and Auto Top-Up limits remain server-side checkout policy. Legacy optional limit keys sent by older clients are ignored during draft validation.

Checkout accepts a monetary amount. The server validates account eligibility and the active pricing version's amount/quantity limits, computes `floor(amountMinor / creditPriceMinor)`, and shows the value allocated to whole credits plus any remainder that is not carried forward. The existing discount and tax calculation remains unchanged and appears separately in the payable total. The payment snapshot retains the pricing version, rate, credits, quote expiry, and lot expiry. The browser cannot choose authoritative prices or credits.

Once a published price exists, fixed package checkout is disabled. Until then, existing fixed top-up packages remain a compatibility fallback; they are not used to infer or publish a per-credit price.

## Expiry, promotions, and access

New purchased lots use the published validity period (initially configured as 365 days) and UTC calendar-day expiry. Each purchase remains a separate bucket. Existing buckets and historical transactions are not rewritten. Promotional grants use a distinct promotion bucket and require an administrator, reason, idempotency key, expiry, audit entry, and customer notification.

An account may purchase if it is active, has completed its profile, and is not blocked by an administrator. Free accounts receive no recurring monthly credits. Promotional grants do not unlock paid prepaid access. First fulfilled credit purchase sets `prepaidSince` and unlocks the configured prepaid feature set.

## Subscription and Auto Top-Up status

Subscription plan purchase, renewal, upgrade, custom-offer checkout, and new subscription auto-renew setup are disabled. Historical subscription rows and provider webhooks are preserved. This code does not cancel provider mandates or alter existing paid terms. Before deployment, inventory active subscriptions and mandates and follow an approved customer migration/consent policy.

**Auto Top-Up is supported for eligible accounts.** A customer saves a credit threshold, top-up amount and monthly maximum, explicitly authorizes a Razorpay eMandate, and enables the setting only after the signed mandate flow confirms it. The server claims one threshold-triggered attempt at a time, reserves confirmed and in-flight monthly spend, creates a provider charge, and grants credits only after authoritative payment confirmation. Failed attempts are recorded with bounded retries and surfaced as customer attention states.

The Razorpay integration requires provider credentials, `RAZORPAY_CHARGE_AT_WILL_ENABLED=true`, and an account-approved `RAZORPAY_EMANDATE_AUTH_TYPE`. Production charging remains separately gated by `RAZORPAY_CHARGE_AT_WILL_LIVE_ENABLED=true` after verified test-mode validation. Do not substitute a saved-card token or a scheduled subscription mandate for this customer-authorized flow.

## Schema and migrations

The database is PostgreSQL/Prisma (not MongoDB). Additive migrations are:

- `20261023120000_credit_pricing_versions`: immutable versioned price and purchase policy.
- `20261023130000_prepaid_access_auto_topup`: prepaid access/eligibility fields and Auto Top-Up settings and attempt records.

Apply migrations through the normal deployment process after a database backup. Review migration SQL and the target database before applying. No production database, customer account, or Razorpay account was accessed during this code change.

## Relevant endpoints

- Customer: `GET /billing/credit-pricing/current`, `GET /billing/credit-pricing`, `GET /billing/credits`, existing credit history, quote, checkout, payment verification, payment status, and `/billing/auto-topup` configuration, mandate and attempt endpoints.
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
