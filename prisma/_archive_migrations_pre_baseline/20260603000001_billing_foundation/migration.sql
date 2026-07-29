-- =========================================================================
-- Billing Foundation: redesign Subscription + BillingAuditLog
-- Plans:    trial | basic | pro | internal
-- Statuses: trialing | active | expired | cancelled
-- =========================================================================

-- ─── Subscription: migrate plan values ───────────────────────────────────────
UPDATE "Subscription" SET "plan" = 'trial'    WHERE "plan" = 'free';
UPDATE "Subscription" SET "plan" = 'basic'    WHERE "plan" = 'starter';
UPDATE "Subscription" SET "plan" = 'internal' WHERE "plan" = 'enterprise';
-- 'pro' stays 'pro'

-- ─── Subscription: migrate status values ─────────────────────────────────────
UPDATE "Subscription" SET "status" = 'trialing'  WHERE "status" = 'trial';
UPDATE "Subscription" SET "status" = 'cancelled' WHERE "status" IN ('canceled', 'past_due');

-- ─── Subscription: drop obsolete columns ─────────────────────────────────────
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "trialStartsAt";
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "canceledAt";

-- ─── Subscription: update column defaults ────────────────────────────────────
ALTER TABLE "Subscription" ALTER COLUMN "plan"   SET DEFAULT 'trial';
ALTER TABLE "Subscription" ALTER COLUMN "status" SET DEFAULT 'trialing';

-- ─── Subscription: seed trialEndsAt for rows that have none ──────────────────
UPDATE "Subscription"
  SET "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '14 days'
WHERE "status" = 'trialing' AND "trialEndsAt" IS NULL;

-- ─── BillingAuditLog: drop FK + old columns ──────────────────────────────────
ALTER TABLE "BillingAuditLog" DROP CONSTRAINT IF EXISTS "BillingAuditLog_subscriptionId_fkey";
ALTER TABLE "BillingAuditLog" DROP COLUMN IF EXISTS "subscriptionId";
ALTER TABLE "BillingAuditLog" DROP COLUMN IF EXISTS "actorEmail";
ALTER TABLE "BillingAuditLog" DROP COLUMN IF EXISTS "action";
ALTER TABLE "BillingAuditLog" DROP COLUMN IF EXISTS "previousState";
ALTER TABLE "BillingAuditLog" DROP COLUMN IF EXISTS "newState";

-- ─── BillingAuditLog: add new columns ────────────────────────────────────────
ALTER TABLE "BillingAuditLog"
  ADD COLUMN IF NOT EXISTS "changedByUserId" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "changedByEmail"  TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "oldPlan"         TEXT,
  ADD COLUMN IF NOT EXISTS "newPlan"         TEXT,
  ADD COLUMN IF NOT EXISTS "oldStatus"       TEXT,
  ADD COLUMN IF NOT EXISTS "newStatus"       TEXT,
  ADD COLUMN IF NOT EXISTS "notes"           TEXT;

-- Remove migration-only defaults so new rows must supply these values
ALTER TABLE "BillingAuditLog" ALTER COLUMN "changedByUserId" DROP DEFAULT;
ALTER TABLE "BillingAuditLog" ALTER COLUMN "changedByEmail"  DROP DEFAULT;
