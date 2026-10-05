-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SUPPORT_TICKET_CREATED', 'SUPPORT_TICKET_REPLY', 'SUPPORT_TICKET_STATUS_CHANGED', 'USAGE_LIMIT_APPROACHING', 'USAGE_LIMIT_REACHED', 'INVOICE_GENERATED', 'INVOICE_PAYMENT_SUCCESS', 'INVOICE_PAYMENT_FAILED', 'API_KEY_CREATED', 'API_KEY_REVOKED', 'PROJECT_CREATED');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL DEFAULT 'CUSTOMER',
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_audience_createdAt_idx" ON "Notification"("userId", "audience", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_audience_read_idx" ON "Notification"("userId", "audience", "read");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
