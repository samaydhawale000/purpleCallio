-- AI Voice Agents (stage 2). Additive and idempotent.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AiSessionStatus" AS ENUM ('CREATED', 'CONNECTING', 'ACTIVE', 'ENDED', 'FAILED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AiCallSession" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "providerSessionId" TEXT,
    "status" "AiSessionStatus" NOT NULL DEFAULT 'CREATED',
    "terminationReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "maxDurationSeconds" INTEGER NOT NULL,
    "participantId" TEXT NOT NULL,
    "participantName" TEXT,
    "metadata" JSONB,
    "toolsSnapshot" JSONB NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "providerCostPaise" INTEGER,
    "creditsCharged" INTEGER,
    "usageRecordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCallSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiCallSession_callId_key" ON "AiCallSession"("callId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiCallSession_tokenHash_key" ON "AiCallSession"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiCallSession_ownerId_status_idx" ON "AiCallSession"("ownerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiCallSession_agentId_createdAt_idx" ON "AiCallSession"("agentId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AiCallSession" ADD CONSTRAINT "AiCallSession_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AiCallSession" ADD CONSTRAINT "AiCallSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
