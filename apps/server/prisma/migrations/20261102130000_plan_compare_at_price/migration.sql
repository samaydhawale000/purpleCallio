-- Plan.compareAtPricePaise was added to the schema without a migration, so
-- databases built from migrations (production) never got the column.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "compareAtPricePaise" INTEGER;
