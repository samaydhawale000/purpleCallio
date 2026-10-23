-- AI Voice Agents (stage 8): stored transcripts. Only written when the agent's
-- storeTranscript toggle is on; content is redacted before insert and purged
-- after the agent's transcriptRetentionDays. Additive and idempotent.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AiConversationMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiConversationMessage_sessionId_createdAt_idx" ON "AiConversationMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiConversationMessage_createdAt_idx" ON "AiConversationMessage"("createdAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AiConversationMessage" ADD CONSTRAINT "AiConversationMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiCallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
