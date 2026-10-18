-- AI Voice Agents (stage 1). Additive and idempotent.

-- AlterEnum
ALTER TYPE "CallSource" ADD VALUE IF NOT EXISTS 'AI_AGENT';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AiAgentStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AiToolMethod" AS ENUM ('POST', 'GET');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AiAgent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AiAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentVersionId" TEXT,
    "storeTranscript" BOOLEAN NOT NULL DEFAULT false,
    "transcriptRetentionDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AiAgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "welcomeMessage" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "voice" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT,
    "maxDurationSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAgentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AiAgentTool" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parametersSchema" JSONB NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "method" "AiToolMethod" NOT NULL DEFAULT 'POST',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "timeoutMs" INTEGER NOT NULL DEFAULT 8000,
    "signingSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgentTool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiAgent_projectId_deletedAt_idx" ON "AiAgent"("projectId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiAgentVersion_agentId_version_key" ON "AiAgentVersion"("agentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiAgentTool_agentId_name_key" ON "AiAgentTool"("agentId", "name");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AiAgentVersion" ADD CONSTRAINT "AiAgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AiAgentTool" ADD CONSTRAINT "AiAgentTool_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
