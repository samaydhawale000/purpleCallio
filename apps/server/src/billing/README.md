# Prepaid billing

PurpleCallio billing is **prepaid**: a customer picks a plan, pays upfront, and the plan's included credits are added to a wallet. Calls consume credits. Nothing is invoiced after the fact and no background job ever charges a customer.

```
choose plan ─► checkout (server prices it) ─► provider payment ─► server verification
     ─► one DB transaction: Payment PAID + Subscription ACTIVE + credits granted
     ─► calls end ─► participant-minutes ─► credits debited (never below zero)
```

## Domain map

| Concern | Where |
|---|---|
| Plans & immutable plan versions, feature registry, default seed | `plans/plan.service.ts`, `plans/feature-registry.ts` |
| Wallet, expiring buckets, immutable ledger | `credits/credit.service.ts` |
| Subscription lifecycle (Free fallback, expiry, cancel, downgrade, activation, renewal) | `subscriptions/subscription.service.ts` |
| "Can this customer do X?" (`hasFeature`, call eligibility, per-media caps) | `subscriptions/entitlement.service.ts` |
| Checkout (quote, start, verify, failure, abandon) | `checkout/checkout.service.ts` |
| Turning a verified payment into entitlements, refunds | `checkout/fulfillment.service.ts` |
| Provider webhooks (idempotent by event id) | `checkout/billing-webhook.service.ts` |
| Payment provider abstraction / Razorpay | `../payment/providers/*` |
| Top-up packages | `topups/topup.service.ts` |
| Custom plans (support conversation + private offers) | `custom-plans/custom-plan.service.ts` |
| Credit rates, tax, thresholds, expiry policy (admin-editable) | `billing-config.service.ts` (`BillingConfig` row) |
| Usage → credits (metering stays in `usage-segment` / `rating-engine`) | `usage-billing.service.ts` |
| Housekeeping jobs (no money movement) | `billing-jobs.service.ts` |
| One-time pay-as-you-go → prepaid migration | `legacy-billing-migration.service.ts` |
| Audit trail | `billing-audit.service.ts` (writes `AuditLog` with old/new values) |

Single sources of truth: plan pricing/entitlements → `Plan`/`PlanVersion`; credit rates → `BillingConfig`; subscription state → `Subscription`; balance → `CreditWallet` + `CreditBucket` (+ `CreditTransaction` ledger); payment state → `Payment` + provider verification; support conversation → `SupportTicket`.

## Invariants (enforced in code, covered by `__tests__/billing.integration.spec.ts`)

- **Payment before activation.** A paid subscription is created `PENDING_PAYMENT` and only becomes `ACTIVE` inside `BillingFulfillmentService.fulfill`, after the provider confirms a capture whose amount/currency match the server-computed `Payment.amount`.
- **The browser never sets prices.** Checkout bodies carry only ids (`planId`, `topUpPackageId`, `offerId`); price, credits, discount and GST come from the database.
- **Exactly-once fulfillment.** Browser callback and webhook can arrive in any order, repeatedly, or concurrently: wallet row lock + `Payment` row lock + unique `providerOrderId`/`providerPaymentId` + ledger `idempotencyKey`s + `PaymentWebhookEvent(provider, eventId)`.
- **Credits never go negative.** Every credit mutation runs in a transaction holding `SELECT … FOR UPDATE` on the customer's wallet, and the decrement is conditional on `balance >= amount`. Wallet balance always equals Σ bucket remaining and Σ ledger amounts.
- **Purchased terms are snapshotted.** Editing price/credits/media caps/features creates a new `PlanVersion`; subscriptions keep their `planVersionId` and snapshot (`pricePaise`, `includedCredits`, `entitlementsSnapshot`, …).
- **Plans are archived, never deleted.** The only active Free plan cannot be deactivated.

## Policies (V1)

- **Free plan**: monthly credits; refreshed each month using the *current* Free plan version (so admin changes apply from the next month).
- **Renewal is manual.** A paid period that ends unpaid becomes `EXPIRED` (or `CANCELED` if the customer cancelled) and the account falls back to Free. Early renewal extends the period by one interval and grants the next period's credits immediately (expiring at the new end). Renewals are priced at the plan's *current* version (shown on the review screen).
- **Upgrade**: pay the new plan's full price; it starts now. The old plan's remaining credits stay usable until their own expiry. No proration.
- **Downgrade**: scheduled for period end (`scheduledPlanId`); entitlements unchanged until then. To Free = cancel at period end; to a cheaper paid plan = that plan becomes the renewal offer.
- **Cancellation**: at period end; no automatic refund.
- **Credit expiry**: plan credits expire at the end of their period; top-up expiry is `BillingConfig.topUpExpiryPolicy` (`NEVER` default, `DAYS`, `SUBSCRIPTION_END`). Expiring a bucket only removes that bucket's credits.
- **Running out mid-call**: active calls are never cut off. The end-of-call debit takes what's left (balance hits 0, never below) and records the uncovered remainder as `shortfall` on the ledger entry. New calls are blocked below `minimumCreditsToStartCall`.
- **Credit rounding**: each media type rounds up to whole credits per call (`toCredits`).
- **Refunds** (admin action or provider `refund.processed`): a *full* refund removes remaining top-up credits, or ends the refunded subscription immediately, removes the credits it funded, and moves the customer to Free. Partial refunds only record the money.
- **Customer discounts** (existing `CustomerDiscount`) apply to plan/renewal/top-up prices before GST.
- **Notifications**: low credits at `lowCreditThresholds` (default 80/90/100 %), plan activated/renewed/expiring/ended, payment success/failure, top-up, custom plan request/offer — all deduped by event.

## Legacy (pay-as-you-go) — what remains and why

| Item | Status |
|---|---|
| `UsageInvoice` + line items | Read-only history (`/billing/usage-invoices*`, PDF). Never created anymore. |
| `createPaymentIntent` / Razorpay recurring charge, ₹1 card-mandate setup, "default card" | **Removed.** No code path can charge a saved token. |
| Month-end close / auto-charge / dunning cron (1/3/7 days) | **Removed.** `BillingJobsService` only rolls periods, expires credits, sends reminders, abandons stale checkouts. |
| Saved cards (`User.razorpayTokenId`, Razorpay tokens) | Listed and removable by the customer; never charged. |
| `User.spendingLimitPaise` | Kept for history; not enforced. |
| `BillingRate` (paise per minute) | Internal cost basis for admin analytics (`/admin/billing/internal-rates`) and legacy invoice rendering. |
| `Subscription` dunning fields, `PAST_DUE` | Legacy rows only. |
| Old webhook orders (card setup / minute top-ups) | Acknowledged and ignored (no prepaid `Payment` row). |

## Migration of existing accounts

`LegacyBillingMigrationService` runs once in the background after boot (completion marker: `PlatformSetting` key `billing.prepaidMigration`; summary visible at `GET /admin/billing/migration`). Per account it maps the legacy cycle-anchor subscription to the Free plan (keeping the current period, resetting old `PAST_DUE` state), creates the wallet and allocates Free credits. Accounts with a paying relationship (saved card, paid usage invoice or active discount) additionally get a one-time **transition grant** equal to their recent average monthly usage in credits (valid 30 days), are flagged `migrationSource = legacy_payg_paying` for admin follow-up, and admins get a summary notification. Nobody is charged or put on a paid plan automatically. Unpaid legacy invoices stay on record; nothing retries them.

## Deploying

1. Back up the database.
2. Deploy the server: the container runs `prisma migrate deploy` (migration `20261007000000_prepaid_billing` — additive; renames `Payment.razorpay*Id` → `provider*Id`, preserving data) and then boots. Boot seeds default plans/features/top-ups/config **only into empty tables** and starts the one-time migration.
3. Review the seeded plans, prices, credit rates and tax in **Admin → Billing** before announcing — the defaults are starting values, not decisions.
4. In the Razorpay dashboard, point the webhook at `POST /api/billing/webhook` with events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `payment.dispute.created`. `RAZORPAY_WEBHOOK_SECRET` must match.
5. Deploy the web app.
6. Production check: buy the cheapest plan with a real card, confirm activation + credits + receipt, then refund it from Admin → Billing → Payments and confirm the reversal.

## Tests

```bash
npm test                       # unit tests (integration suite auto-skips)
BILLING_TEST_DATABASE_URL=postgresql://…/bluejoinet_test npm run test:billing
```

The integration suite **truncates** the database it points at — use a dedicated, migrated test database (`DATABASE_URL=… npx prisma migrate deploy`).
