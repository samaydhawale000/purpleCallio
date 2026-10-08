-- AlterTable
ALTER TABLE "BillingConfig" ADD COLUMN     "autoRenewDefault" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoRenewGraceHours" INTEGER NOT NULL DEFAULT 72;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "providerSubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoRenewChangedAt" TIMESTAMP(3),
ADD COLUMN     "autoRenewOffReason" TEXT,
ADD COLUMN     "providerSubscriptionId" TEXT,
ADD COLUMN     "providerSubscriptionStatus" TEXT,
ADD COLUMN     "renewalAmountPaise" INTEGER,
ADD COLUMN     "renewalPlanVersionId" TEXT;

-- CreateTable
CREATE TABLE "ProviderPlan" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPlanId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "billingInterval" "BillingInterval" NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPlan_providerPlanId_key" ON "ProviderPlan"("providerPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPlan_provider_amountPaise_currency_billingInterval__key" ON "ProviderPlan"("provider", "amountPaise", "currency", "billingInterval", "intervalCount");

-- CreateIndex
CREATE INDEX "Payment_providerSubscriptionId_idx" ON "Payment"("providerSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubscriptionId_key" ON "Subscription"("providerSubscriptionId");

