-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'DISCOUNT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DISCOUNT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'DISCOUNT_DISABLED';

-- AlterTable
ALTER TABLE "UsageInvoice" ADD COLUMN     "discountPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" INTEGER,
ADD COLUMN     "discountReason" TEXT;

-- CreateTable
CREATE TABLE "CustomerDiscount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "percentage" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerDiscount_companyId_active_idx" ON "CustomerDiscount"("companyId", "active");

-- AddForeignKey
ALTER TABLE "CustomerDiscount" ADD CONSTRAINT "CustomerDiscount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
