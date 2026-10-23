-- CreateEnum
CREATE TYPE "TranslationMode" AS ENUM ('OFF', 'CAPTIONS', 'VOICE');

-- CreateEnum
CREATE TYPE "TranslationSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "TranslationTermKind" AS ENUM ('DO_NOT_TRANSLATE', 'TRANSLATE_AS', 'PRONOUNCE_AS');

-- CreateEnum
CREATE TYPE "TranslationReportStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TRANSLATION_BUDGET_THRESHOLD';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSLATION_RATE_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSLATION_REPORT_READY';

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "callerLanguage" TEXT,
ADD COLUMN     "receiverLanguage" TEXT,
ADD COLUMN     "translationConfig" JSONB,
ADD COLUMN     "translationMode" "TranslationMode" NOT NULL DEFAULT 'OFF';

-- AlterTable
ALTER TABLE "BillingConfig" ADD COLUMN     "postCallReportCredits" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "translationCaptionsCreditsPerMinute" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "translationDefaultMaxMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "translationIndicVoiceCreditsPerMinute" INTEGER,
ADD COLUMN     "translationMarginWarnPercent" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "translationMaxBudgetCredits" INTEGER NOT NULL DEFAULT 10000000,
ADD COLUMN     "translationMinimumCredits" INTEGER,
ADD COLUMN     "translationProviderCostsPaise" JSONB NOT NULL DEFAULT '{"openai-translate":300,"sarvam-voice":150,"sarvam-captions":50,"mock":0}',
ADD COLUMN     "translationTrialMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "translationVoiceCreditsPerMinute" INTEGER NOT NULL DEFAULT 450;

-- CreateTable
CREATE TABLE "TranslationSettings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "replayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "postCallReportEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sentimentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transcriptRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "industry" TEXT,
    "defaultLexiconId" TEXT,
    "defaultMaxMinutes" INTEGER,
    "dailyBudgetCredits" INTEGER,
    "monthlyBudgetCredits" INTEGER,
    "alertThresholds" INTEGER[] DEFAULT ARRAY[50, 80, 100]::INTEGER[],
    "onLimit" TEXT NOT NULL DEFAULT 'captions_then_off',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationSession" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "mode" "TranslationMode" NOT NULL,
    "route" TEXT NOT NULL,
    "status" "TranslationSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "voiceRate" INTEGER NOT NULL,
    "captionsRate" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "captionsSeconds" INTEGER NOT NULL DEFAULT 0,
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "providerCostPaise" INTEGER NOT NULL DEFAULT 0,
    "trialSecondsUsed" INTEGER NOT NULL DEFAULT 0,
    "usageRecordedAt" TIMESTAMP(3),
    "phrases" INTEGER NOT NULL DEFAULT 0,
    "firstAudioMsP50" INTEGER,
    "firstAudioMsP95" INTEGER,
    "captionDelayMsP50" INTEGER,
    "captionDelayMsP95" INTEGER,
    "droppedFrames" INTEGER NOT NULL DEFAULT 0,
    "providerFailures" INTEGER NOT NULL DEFAULT 0,
    "fallbacks" INTEGER NOT NULL DEFAULT 0,
    "flags" INTEGER NOT NULL DEFAULT 0,
    "flagReasons" JSONB,
    "replays" INTEGER NOT NULL DEFAULT 0,
    "repeats" INTEGER NOT NULL DEFAULT 0,
    "lexiconHits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationPhrase" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "phraseId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "translated" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "translatedAudioAt" TIMESTAMP(3),
    "guardStatus" TEXT NOT NULL DEFAULT 'ok',
    "guardReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationPhrase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationReport" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "TranslationReportStatus" NOT NULL DEFAULT 'PENDING',
    "summary" JSONB,
    "signals" JSONB,
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationLexicon" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationLexicon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationLexiconTerm" (
    "id" TEXT NOT NULL,
    "lexiconId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "kind" "TranslationTermKind" NOT NULL DEFAULT 'DO_NOT_TRANSLATE',
    "translations" JSONB,
    "pronunciation" TEXT,
    "caseSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationLexiconTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationBudgetAlert" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranslationBudgetAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationRateOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voiceCreditsPerMinute" INTEGER,
    "captionsCreditsPerMinute" INTEGER,
    "postCallReportCredits" INTEGER,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationRateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranslationSettings_projectId_key" ON "TranslationSettings"("projectId");

-- CreateIndex
CREATE INDEX "TranslationSession_projectId_startedAt_idx" ON "TranslationSession"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "TranslationSession_ownerId_startedAt_idx" ON "TranslationSession"("ownerId", "startedAt");

-- CreateIndex
CREATE INDEX "TranslationSession_callId_idx" ON "TranslationSession"("callId");

-- CreateIndex
CREATE INDEX "TranslationSession_status_usageRecordedAt_idx" ON "TranslationSession"("status", "usageRecordedAt");

-- CreateIndex
CREATE INDEX "TranslationPhrase_expiresAt_idx" ON "TranslationPhrase"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationPhrase_callId_phraseId_key" ON "TranslationPhrase"("callId", "phraseId");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationReport_callId_key" ON "TranslationReport"("callId");

-- CreateIndex
CREATE INDEX "TranslationReport_expiresAt_idx" ON "TranslationReport"("expiresAt");

-- CreateIndex
CREATE INDEX "TranslationLexicon_projectId_idx" ON "TranslationLexicon"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationLexiconTerm_lexiconId_term_key" ON "TranslationLexiconTerm"("lexiconId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationBudgetAlert_projectId_period_threshold_key" ON "TranslationBudgetAlert"("projectId", "period", "threshold");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationRateOverride_userId_key" ON "TranslationRateOverride"("userId");

-- AddForeignKey
ALTER TABLE "TranslationSettings" ADD CONSTRAINT "TranslationSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationSession" ADD CONSTRAINT "TranslationSession_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationPhrase" ADD CONSTRAINT "TranslationPhrase_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationReport" ADD CONSTRAINT "TranslationReport_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationLexicon" ADD CONSTRAINT "TranslationLexicon_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationLexiconTerm" ADD CONSTRAINT "TranslationLexiconTerm_lexiconId_fkey" FOREIGN KEY ("lexiconId") REFERENCES "TranslationLexicon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationRateOverride" ADD CONSTRAINT "TranslationRateOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Register the TRANSLATION plan feature (admins add it to plans in the plan editor).
INSERT INTO "Feature" ("id", "key", "name", "description", "category", "displayOrder", "isActive", "isPublic", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'TRANSLATION', 'Live Translate',
       'Real-time two-way voice translation and captions for calls.', 'Calling',
       COALESCE((SELECT MAX("displayOrder") + 1 FROM "Feature"), 0), true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Feature" WHERE "key" = 'TRANSLATION');
