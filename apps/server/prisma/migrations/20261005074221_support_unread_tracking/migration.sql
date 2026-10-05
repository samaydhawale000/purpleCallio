-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "adminLastReadAt" TIMESTAMP(3),
ADD COLUMN     "customerLastReadAt" TIMESTAMP(3),
ADD COLUMN     "lastAdminMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastCustomerMessageAt" TIMESTAMP(3);

-- Backfill from existing messages. Read markers stay NULL (unknown), so
-- tickets with replies from the other side show as unread until opened.
UPDATE "SupportTicket" t SET
  "lastCustomerMessageAt" = (SELECT MAX(m."createdAt") FROM "SupportMessage" m WHERE m."ticketId" = t."id" AND m."senderType" = 'CUSTOMER'),
  "lastAdminMessageAt"    = (SELECT MAX(m."createdAt") FROM "SupportMessage" m WHERE m."ticketId" = t."id" AND m."senderType" = 'ADMIN');
