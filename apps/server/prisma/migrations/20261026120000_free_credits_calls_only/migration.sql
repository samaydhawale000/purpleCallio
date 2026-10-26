-- Free credits (signup, promotions) pay for audio, video and screen share only.
ALTER TYPE "CreditBucketSource" ADD VALUE 'SIGNUP';

ALTER TABLE "BillingConfig" ADD COLUMN "signupFreeCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "signupFreeCreditsValidityDays" INTEGER DEFAULT 30;

-- Live Translate is always paid: the free trial is retired.
ALTER TABLE "BillingConfig" DROP COLUMN "translationTrialMinutes";
