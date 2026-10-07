-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('SUBSCRIPTION_PURCHASE', 'SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_UPGRADE', 'TOPUP', 'CUSTOM_PLAN', 'LEGACY');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'PAID', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PlanCtaAction" AS ENUM ('SIGNUP', 'CHECKOUT', 'CONTACT_SALES');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('SUBSCRIPTION_ALLOCATION', 'USAGE_DEBIT', 'TOPUP_PURCHASE', 'ADMIN_ADJUSTMENT', 'REFUND', 'EXPIRATION', 'PROMOTION', 'MIGRATION');

-- CreateEnum
CREATE TYPE "CreditBucketSource" AS ENUM ('SUBSCRIPTION', 'TOPUP', 'PROMOTION', 'ADMIN', 'MIGRATION');

-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TopUpExpiryPolicy" AS ENUM ('NEVER', 'DAYS', 'SUBSCRIPTION_END');

-- CreateEnum
CREATE TYPE "CustomPlanRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'NEGOTIATING', 'PROPOSAL_SENT', 'ACCEPTED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CustomPlanOfferStatus" AS ENUM ('SENT', 'ACCEPTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SupportTicketType" AS ENUM ('GENERAL', 'CUSTOM_PLAN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PLAN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PLAN_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'PLAN_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'TOPUP_PACKAGE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'TOPUP_PACKAGE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'FEATURE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'BILLING_CONFIG_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDITS_ADJUSTED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_RENEWED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_DOWNGRADE_SCHEDULED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_REFUNDED';
ALTER TYPE "AuditAction" ADD VALUE 'TOPUP_PURCHASED';
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOM_PLAN_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOM_PLAN_REQUEST_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOM_PLAN_OFFER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOM_PLAN_OFFER_WITHDRAWN';
ALTER TYPE "AuditAction" ADD VALUE 'LEGACY_BILLING_MIGRATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BillingStatus" ADD VALUE 'DRAFT';
ALTER TYPE "BillingStatus" ADD VALUE 'PENDING_PAYMENT';
ALTER TYPE "BillingStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "BillingStatus" ADD VALUE 'SUSPENDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_SUCCESS';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'PLAN_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'PLAN_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'PLAN_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'CREDITS_LOW';
ALTER TYPE "NotificationType" ADD VALUE 'CREDITS_EXHAUSTED';
ALTER TYPE "NotificationType" ADD VALUE 'TOPUP_SUCCESS';
ALTER TYPE "NotificationType" ADD VALUE 'CUSTOM_PLAN_REQUEST_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'CUSTOM_PLAN_OFFER_RECEIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_subscriptionId_fkey";

-- Preserve legacy payment ids: rename the Razorpay-specific columns to the
-- provider-agnostic names instead of dropping them.
DROP INDEX "Payment_razorpayPaymentId_key";
ALTER TABLE "Payment" RENAME COLUMN "razorpayPaymentId" TO "providerPaymentId";
ALTER TABLE "Payment" RENAME COLUMN "razorpayOrderId" TO "providerOrderId";

-- AlterTable
ALTER TABLE "CallUsage" ADD COLUMN     "creditsCharged" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "credits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customOfferId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "discountPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" INTEGER,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "lineItems" JSONB,
ADD COLUMN     "planVersionId" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'razorpay',
ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "receiptNumber" INTEGER,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subtotalPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "topUpPackageId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "subscriptionId" DROP NOT NULL;

-- Backfill legacy payments: owner from their subscription, total as subtotal.
UPDATE "Payment" p SET "userId" = s."companyId", "subtotalPaise" = p."amount"
FROM "Subscription" s WHERE s."id" = p."subscriptionId";

-- Legacy order ids may repeat (e.g. a failed + a captured attempt on one
-- order); keep the newest row's order id so the unique index can be built.
UPDATE "Payment" p SET "providerOrderId" = NULL
WHERE p."providerOrderId" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "Payment" q
  WHERE q."providerOrderId" = p."providerOrderId"
    AND (q."createdAt" > p."createdAt" OR (q."createdAt" = p."createdAt" AND q."id" > p."id"))
);

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "billingInterval" "BillingInterval",
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "entitlementsSnapshot" JSONB,
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "includedCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "intervalCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "migrationSource" TEXT,
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "planName" TEXT,
ADD COLUMN     "planType" "PlanType",
ADD COLUMN     "planVersionId" TEXT,
ADD COLUMN     "previousSubscriptionId" TEXT,
ADD COLUMN     "pricePaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replacedBySubscriptionId" TEXT,
ADD COLUMN     "scheduledPlanId" TEXT;

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "type" "SupportTicketType" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "Usage" ADD COLUMN     "creditsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "method" TEXT,
    "errorCode" TEXT,
    "errorDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "badge" TEXT,
    "type" "PlanType" NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "assignedUserId" TEXT,
    "ctaLabel" TEXT,
    "ctaAction" "PlanCtaAction" NOT NULL DEFAULT 'CHECKOUT',
    "currentVersionId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTH',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "includedCredits" INTEGER NOT NULL DEFAULT 0,
    "includedAudioCredits" INTEGER,
    "includedVideoCredits" INTEGER,
    "includedScreenShareCredits" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "audioCreditsPerMinute" INTEGER NOT NULL DEFAULT 1,
    "videoCreditsPerMinute" INTEGER NOT NULL DEFAULT 4,
    "screenShareCreditsPerMinute" INTEGER NOT NULL DEFAULT 1,
    "taxPercent" INTEGER NOT NULL DEFAULT 18,
    "lowCreditThresholds" INTEGER[] DEFAULT ARRAY[80, 90, 100]::INTEGER[],
    "minimumCreditsToStartCall" INTEGER NOT NULL DEFAULT 1,
    "topUpExpiryPolicy" "TopUpExpiryPolicy" NOT NULL DEFAULT 'NEVER',
    "topUpExpiryDays" INTEGER,
    "renewalReminderDays" INTEGER NOT NULL DEFAULT 7,
    "pendingCheckoutTtlHours" INTEGER NOT NULL DEFAULT 24,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditBucket" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "CreditBucketSource" NOT NULL,
    "initialAmount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "subscriptionId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "bucketId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopUpPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "credits" INTEGER NOT NULL,
    "status" "TopUpStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomPlanRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "status" "CustomPlanRequestStatus" NOT NULL DEFAULT 'NEW',
    "assignedAdminId" TEXT,
    "notes" TEXT,
    "estimatedMonthlyCredits" INTEGER,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPlanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomPlanOffer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "status" "CustomPlanOfferStatus" NOT NULL DEFAULT 'SENT',
    "message" TEXT,
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPlanOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_providerPaymentId_key" ON "PaymentAttempt"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_paymentId_idx" ON "PaymentAttempt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_currentVersionId_key" ON "Plan"("currentVersionId");

-- CreateIndex
CREATE INDEX "Plan_status_isPublic_displayOrder_idx" ON "Plan"("status", "isPublic", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_planId_version_key" ON "PlanVersion"("planId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_key_key" ON "Feature"("key");

-- CreateIndex
CREATE UNIQUE INDEX "BillingConfig_key_key" ON "BillingConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CreditWallet_userId_key" ON "CreditWallet"("userId");

-- CreateIndex
CREATE INDEX "CreditBucket_walletId_remaining_idx" ON "CreditBucket"("walletId", "remaining");

-- CreateIndex
CREATE INDEX "CreditBucket_expiresAt_remaining_idx" ON "CreditBucket"("expiresAt", "remaining");

-- CreateIndex
CREATE INDEX "CreditBucket_subscriptionId_idx" ON "CreditBucket"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_idempotencyKey_key" ON "CreditTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_createdAt_idx" ON "CreditTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_type_createdAt_idx" ON "CreditTransaction"("userId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomPlanRequest_ticketId_key" ON "CustomPlanRequest"("ticketId");

-- CreateIndex
CREATE INDEX "CustomPlanRequest_userId_status_idx" ON "CustomPlanRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "CustomPlanRequest_status_requestedAt_idx" ON "CustomPlanRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "CustomPlanOffer_userId_status_idx" ON "CustomPlanOffer"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_paymentStatus_createdAt_idx" ON "Payment"("paymentStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Subscription_companyId_status_idx" ON "Subscription"("companyId", "status");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "PlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanVersion" ADD CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditBucket" ADD CONSTRAINT "CreditBucket_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditBucket" ADD CONSTRAINT "CreditBucket_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPlanRequest" ADD CONSTRAINT "CustomPlanRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPlanRequest" ADD CONSTRAINT "CustomPlanRequest_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPlanRequest" ADD CONSTRAINT "CustomPlanRequest_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPlanOffer" ADD CONSTRAINT "CustomPlanOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CustomPlanRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPlanOffer" ADD CONSTRAINT "CustomPlanOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPlanOffer" ADD CONSTRAINT "CustomPlanOffer_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPlanOffer" ADD CONSTRAINT "CustomPlanOffer_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Gap-free-per-success receipt numbers: drawn only when a payment is
-- verified (BillingFulfillmentService), never for pending/failed checkouts.
CREATE SEQUENCE "Payment_receipt_seq" START 1001;
