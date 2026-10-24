CREATE TYPE "CreditPricingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'SUPERSEDED', 'CANCELLED');
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_PRICING_DRAFT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_PRICING_DRAFT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_PRICING_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_PRICING_SCHEDULED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_PRICING_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'PROMOTIONAL_CREDITS_GRANTED';

ALTER TABLE "Payment"
  ADD COLUMN "creditPricingVersionId" TEXT,
  ADD COLUMN "creditPricePaise" INTEGER,
  ADD COLUMN "creditExpiryAt" TIMESTAMP(3),
  ADD COLUMN "quoteExpiresAt" TIMESTAMP(3);

ALTER TABLE "BillingConfig"
  ADD COLUMN "freeAccountsCanPurchaseCredits" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "freeAccountsCanUseAutoTopUp" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CreditPricingVersion" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "creditPricePaise" INTEGER NOT NULL,
  "minimumPurchasePaise" INTEGER NOT NULL DEFAULT 100000,
  "maximumPurchasePaise" INTEGER,
  "minimumCredits" INTEGER NOT NULL DEFAULT 1,
  "maximumCredits" INTEGER,
  "purchasedValidityDays" INTEGER NOT NULL DEFAULT 365,
  "autoTopUpEnabled" BOOLEAN NOT NULL DEFAULT false,
  "autoTopUpMinimumPaise" INTEGER NOT NULL DEFAULT 100000,
  "autoTopUpMaximumPaise" INTEGER,
  "monthlyAutoTopUpLimitPaise" INTEGER,
  "promotionalPolicy" JSONB,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "CreditPricingStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" TEXT NOT NULL,
  "publishedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditPricingVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditPricingVersion_currency_version_key" ON "CreditPricingVersion"("currency", "version");
CREATE INDEX "CreditPricingVersion_currency_status_effectiveAt_idx" ON "CreditPricingVersion"("currency", "status", "effectiveAt");
CREATE INDEX "CreditPricingVersion_createdAt_idx" ON "CreditPricingVersion"("createdAt");
