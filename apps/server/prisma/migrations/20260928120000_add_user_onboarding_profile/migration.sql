-- CreateEnum
CREATE TYPE "ExpectedUsageRange" AS ENUM ('UNDER_1K', 'FROM_1K_TO_10K', 'FROM_10K_TO_100K', 'OVER_100K', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "PrimaryUseCase" AS ENUM ('VIDEO_MEETINGS', 'CUSTOMER_SUPPORT', 'TELEHEALTH', 'EDUCATION', 'RECRUITMENT', 'SALES', 'INTERNAL_COMMUNICATION', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "companyWebsite" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "expectedUsageRange" "ExpectedUsageRange",
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "primaryUseCase" "PrimaryUseCase",
ADD COLUMN     "profileCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Existing users default to profileCompleted = false: none of them can have
-- the new required business fields (companyName, jobTitle, country) yet, so
-- each sees the onboarding step exactly once on their next login, with the
-- name and phone already on file pre-filled.
