-- AI Voice Agents (stage 6): AI calls are billed in credits. Additive and idempotent.

-- AlterTable
ALTER TABLE "BillingConfig" ADD COLUMN IF NOT EXISTS "aiCreditsPerMinute" INTEGER NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "AiCallSession" ADD COLUMN IF NOT EXISTS "creditsShortfall" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiCallSession_usageRecordedAt_idx" ON "AiCallSession"("usageRecordedAt");
