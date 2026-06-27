-- Add columns that exist in schema but were never migrated, blocking subscription.create()
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "nextPlan" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "closeAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
