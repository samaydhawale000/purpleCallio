CREATE TYPE "CallSource" AS ENUM ('CUSTOMER', 'PLAYGROUND');
CREATE TYPE "PlaygroundAttemptType" AS ENUM ('CALL_CREATION', 'TURN_CREDENTIAL');

ALTER TABLE "Call"
  ADD COLUMN "source" "CallSource" NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "maxParticipants" INTEGER,
  ADD COLUMN "creatorIdentity" TEXT;
ALTER TABLE "Call" ADD COLUMN "creatorIpKey" TEXT;

CREATE TABLE "PlaygroundAttempt" (
  "id" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "ipKey" TEXT NOT NULL,
  "type" "PlaygroundAttemptType" NOT NULL DEFAULT 'CALL_CREATION',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaygroundAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlaygroundAttempt_identityKey_createdAt_idx" ON "PlaygroundAttempt"("identityKey", "createdAt");
CREATE INDEX "PlaygroundAttempt_ipKey_createdAt_idx" ON "PlaygroundAttempt"("ipKey", "createdAt");
CREATE INDEX "PlaygroundAttempt_createdAt_idx" ON "PlaygroundAttempt"("createdAt");
CREATE INDEX "PlaygroundAttempt_identityKey_ipKey_type_createdAt_idx" ON "PlaygroundAttempt"("identityKey", "ipKey", "type", "createdAt");
CREATE INDEX "Call_source_status_expiresAt_idx" ON "Call"("source", "status", "expiresAt");
CREATE INDEX "Call_source_status_createdAt_idx" ON "Call"("source", "status", "createdAt");
