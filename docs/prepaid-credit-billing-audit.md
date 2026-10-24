# Prepaid credit billing audit

Audit performed against the current repository before changing billing behavior.

## Existing architecture to reuse

| Concern | Current implementation |
| --- | --- |
| Wallet and balances | `CreditWallet` stores balance/reserved; `CreditBucket` tracks each grant separately; `CreditTransaction` is the immutable ledger. `CreditService` serializes mutations with a wallet row lock and idempotency keys. |
| Credit expiry | `BillingJobsService.expireCredits` processes due buckets; `CreditService.expireDue` expires only the remaining quantity. Plan allocations have period expiry. |
| Payments | `Payment`, `PaymentAttempt`, and uniquely keyed `PaymentWebhookEvent`; Razorpay callback and signature-verified webhook feed `BillingFulfillmentService`. Amount/currency are checked before atomic, exactly-once fulfillment. |
| Manual top-ups | Admin-managed `TopUpPackage` rows with fixed `pricePaise` and `credits`; customer checkout selects a package ID. Prices and credit amounts are snapshotted onto `Payment`. |
| Admin audit | Billing changes write `AuditLog` through `BillingAuditService`; admin routes use `AdminGuard`. |
| Customer usage | Existing media metering, AI calling, and translation use credit rates independent of top-up package prices. Calls in progress are not cut off at depletion. |

These are the right foundations for the requested system; a second wallet, payment flow, or ledger is unnecessary.

## Verified mismatches with the target

1. **No common monetary price per credit.** Top-up packages have independent fixed prices and quantities. The repository does not define an approved universal credit price that can be retained. A per-credit rate cannot safely be derived from one package or averaged across them.
2. **No versioned credit-price publication.** `BillingConfig` is a mutable singleton and does not hold a per-currency credit price, immutable draft/published versions, effective dates, or purchase bounds.
3. **Manual purchases are package-only.** `/billing/topups/checkout` accepts `topUpPackageId`; there is no monetary amount quote or backend formula for converting a purchase amount to credits.
4. **Top-up expiry is currently optional.** `BillingConfig.topUpExpiryPolicy` defaults to `NEVER`; fulfillment can also use `DAYS` or subscription end. New purchases do not therefore consistently expire after one year.
5. **Auto Top-Up is currently subscription auto-renew.** It renews a selected plan for a periodic amount using a Razorpay mandate. There is no balance threshold, monetary top-up amount, monthly spending cap, or top-up trigger workflow.
6. **Free credits recur.** The default Free plan includes 1,500 credits, and subscription rollover allocates current Free-plan credits monthly. Free-account top-up/Auto Top-Up eligibility is not an explicit policy gate.
7. **Subscription purchase remains active.** Plan, renewal, upgrade, custom-plan, and mandate setup routes/UI remain available. Razorpay subscription webhooks can fulfill recurring charges. Existing active customers may be subject to those terms.
8. **Promotions exist only as a ledger transaction type/source.** There is no dedicated audited admin grant workflow or configurable promotion policy/expiry.
9. **Consumption defaults differ from examples in the brief.** The BillingConfig defaults are audio 1, video 4, screen share 1, AI voice 15 credits/minute, translation voice 450, and translation captions 60 credits/minute. Do not replace them with the brief's example rates without product approval.

## Implemented migration

- Added immutable, per-currency pricing versions with draft, scheduled, published, superseded, and cancelled states. Pricing remains unpublished until an administrator enters the approved rate and confirms publication.
- Added amount-based credit checkout. The server applies the active rate, validates purchase bounds, floors to whole credits, and stores the pricing version, rate, quote expiry, and purchased-lot expiry on the payment. Existing verified payment fulfillment and wallet idempotency are reused.
- Added audited promotional credit grants with required reason, idempotency key, and expiring promotional buckets.
- Removed customer-facing plan purchase navigation and replaced the plans page with prepaid credit guidance. Subscription purchase, renewal, and offer checkout are rejected by the server. Free plan monthly credit allocation is disabled; existing buckets are not rewritten.
- Added server-side purchase eligibility: active accounts with a completed profile may buy unless an administrator blocks them. No production price is seeded.
- Auto Top-Up remains disabled. The current provider abstraction supports provider-managed recurring subscriptions, but has no customer-authorized threshold-triggered one-off charge operation. The pricing model stores policy bounds only; it does not imply that automatic charging is available.

## Rollout constraints

- Do not seed or publish a monetary credit rate until the administrator supplies the approved INR rate (and rates for any other supported currencies).
- No production database or Razorpay account was inspected. Before deployment, inventory active subscriptions and mandates and agree customer handling; do not silently cancel or migrate them. New checkout is blocked, but existing verified subscription webhooks remain supported for historical records.
- Free monthly allocations are disabled for future periods; existing credit buckets remain as-is. Account purchase eligibility is enforced by profile completion, active status, and the administrator's per-account block.
- Future purchase expiry uses a UTC calendar-day anniversary. Existing buckets and payments retain their original terms.
- New amount-based quotes should snapshot the published price version and retain existing provider verification, wallet locking, and idempotency guarantees.
- Keep the existing usage rates and real-time call behavior unchanged while replacing the purchase model.

## Recommended rollout order

1. Approve price per credit by currency, purchase limits, taxes/discount rules, quote lifetime, and rounding.
2. Approve subscription/customer migration and the Free-credit replacement policy; inventory active subscribers and mandates.
3. Add immutable draft/published pricing versions and audited publication; keep current package checkout active until a published rate is available.
4. Add amount-based quote/payment snapshots and exactly-once fulfillment using the existing `Payment`, `CreditService`, and Razorpay integration.
5. Add future-purchase expiry policy and scheduled expiry notifications without rewriting old credit buckets.
6. Promotional grants are implemented and audited. Auto Top-Up requires a provider-supported threshold debit authorization flow, monthly limit reservations, and payment-attention UX before it can be enabled.
7. Customer UI and server purchase paths are migrated. Confirm existing subscription/mandate inventory before deploying; no external mandates were cancelled by this code change.

## Verification notes

Validation in this working session: Prisma schema validation passed; Nest server build passed; web TypeScript check passed; focused server unit specs passed (15 tests); focused web billing specs passed (9 tests). `npm run test:billing` reported 2 suites / 63 tests skipped because its database-backed prerequisites are unavailable. ESLint could not run because this repository has no ESLint 9 `eslint.config.*`. No database migration was applied, and no production payment or account data was accessed. Auto Top-Up remains an unimplemented follow-up and has not been verified.
