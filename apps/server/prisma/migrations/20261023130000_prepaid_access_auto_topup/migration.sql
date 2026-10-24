-- CreateEnum
CREATE TYPE "AutoTopUpMandateStatus" AS ENUM ('NONE', 'PENDING', 'ACTIVE', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AutoTopUpAttemptStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'AUTO_TOPUP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'AUTO_TOPUP_ENABLED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTO_TOPUP_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTO_TOPUP_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE 'PREPAID_ACCESS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_PURCHASE_BLOCK_CHANGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CREDITS_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'AUTO_TOPUP_SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'AUTO_TOPUP_SUCCEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'AUTO_TOPUP_FAILED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "creditPurchaseBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prepaidSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BillingConfig" ADD COLUMN     "autoTopUpCooldownMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "autoTopUpMaxRetries" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "autoTopUpRetryDelayHours" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "creditExpiryReminderDays" INTEGER[] DEFAULT ARRAY[30, 7, 1]::INTEGER[],
ADD COLUMN     "prepaidFeatures" TEXT[] DEFAULT ARRAY['HOSTED_UI', 'WEBRTC_SDK', 'REST_API', 'REACT_COMPONENTS', 'SCREEN_SHARING', 'WEBHOOKS', 'ANALYTICS', 'CUSTOM_BRANDING', 'TRANSLATION']::TEXT[];

-- CreateTable
CREATE TABLE "AutoTopUpSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "thresholdCredits" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "monthlyLimitPaise" INTEGER NOT NULL,
    "consentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "providerCustomerId" TEXT,
    "providerTokenId" TEXT,
    "mandateStatus" "AutoTopUpMandateStatus" NOT NULL DEFAULT 'NONE',
    "mandateMaxAmountPaise" INTEGER,
    "mandateExpiresAt" TIMESTAMP(3),
    "mandateMethod" TEXT,
    "mandateOrderId" TEXT,
    "attentionReason" TEXT,
    "attentionAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "lastTriggeredAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoTopUpSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoTopUpAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "paymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "AutoTopUpAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "amountPaise" INTEGER NOT NULL,
    "taxPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "creditPricingVersionId" TEXT NOT NULL,
    "creditPricePaise" INTEGER NOT NULL,
    "triggerBalance" INTEGER NOT NULL,
    "monthKey" TEXT NOT NULL,
    "retryOfId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "providerPaymentId" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoTopUpAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutoTopUpSetting_userId_key" ON "AutoTopUpSetting"("userId");

-- CreateIndex
CREATE INDEX "AutoTopUpSetting_enabled_mandateStatus_idx" ON "AutoTopUpSetting"("enabled", "mandateStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AutoTopUpAttempt_paymentId_key" ON "AutoTopUpAttempt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoTopUpAttempt_idempotencyKey_key" ON "AutoTopUpAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutoTopUpAttempt_userId_status_idx" ON "AutoTopUpAttempt"("userId", "status");

-- CreateIndex
CREATE INDEX "AutoTopUpAttempt_userId_monthKey_idx" ON "AutoTopUpAttempt"("userId", "monthKey");

-- CreateIndex
CREATE INDEX "AutoTopUpAttempt_status_nextRetryAt_idx" ON "AutoTopUpAttempt"("status", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "AutoTopUpSetting" ADD CONSTRAINT "AutoTopUpSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoTopUpAttempt" ADD CONSTRAINT "AutoTopUpAttempt_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "AutoTopUpSetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one in-flight auto top-up per account (concurrency guard).
CREATE UNIQUE INDEX "AutoTopUpAttempt_one_active_per_user"
  ON "AutoTopUpAttempt" ("userId")
  WHERE "status" IN ('PENDING', 'PROCESSING');

-- Prepaid access: accounts that already paid us (any verified payment)
-- keep paid features. Idempotent; never overwrites an existing value.
UPDATE "User" u
SET "prepaidSince" = p.first_paid
FROM (
  SELECT "userId", MIN(COALESCE("paidAt", "createdAt")) AS first_paid
  FROM "Payment"
  WHERE "paymentStatus" = 'PAID'
    AND "purpose" IN ('TOPUP', 'SUBSCRIPTION_PURCHASE', 'SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_UPGRADE', 'CUSTOM_PLAN')
  GROUP BY "userId"
) p
WHERE u."id" = p."userId" AND u."prepaidSince" IS NULL;
