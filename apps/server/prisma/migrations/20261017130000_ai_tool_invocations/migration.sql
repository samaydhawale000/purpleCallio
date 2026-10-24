-- AI Voice Agents (stage 7): one row per tool call. Stores no arguments or
-- responses. Additive and idempotent.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AiToolInvocationStatus" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT', 'REJECTED', 'UNCONFIRMED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AiToolInvocation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "toolId" TEXT,
    "toolName" TEXT NOT NULL,
    "status" "AiToolInvocationStatus" NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiToolInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiToolInvocation_sessionId_createdAt_idx" ON "AiToolInvocation"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiToolInvocation_toolId_createdAt_idx" ON "AiToolInvocation"("toolId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AiToolInvocation" ADD CONSTRAINT "AiToolInvocation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiCallSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
