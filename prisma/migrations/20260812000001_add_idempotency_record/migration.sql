-- Phase C: durable, cross-instance duplicate-write protection.
--
-- Idempotency state lived only in each Node process, so two duplicate requests
-- landing on different Vercel instances could both execute. This table moves the
-- claim into PostgreSQL, where the unique constraint below is the thing that
-- actually serialises them: both requests INSERT, exactly one is admitted.
--
-- This migration is ADDITIVE ONLY. It creates one new table and its indexes.
-- It does not alter, rename, re-type or drop any existing table, column,
-- constraint or index, and it writes no data. Nothing in it can affect existing
-- rows, so it is safe to apply to a live database.
--
-- No foreign key to "Organization" is declared, by design: this is short-lived
-- operational state on the hottest write path, and an FK would add a constraint
-- check to every claim while coupling key expiry to the organization lifecycle.
-- Tenant isolation comes from "organizationId" being part of the unique tuple
-- and of every query's WHERE clause. "BillingAuditLog" already has no FK either.
--
-- Statements are guarded with IF NOT EXISTS so re-application is a no-op.

-- CreateTable
CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Drives expiry sweeps and claim-lease checks.
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
-- The atomic-claim constraint. Index name follows Prisma's
-- `Table_col1_col2_key` convention so `migrate diff` stays clean against
-- schema.prisma.
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_userId_route_key_key" ON "IdempotencyRecord"("organizationId", "userId", "route", "key");
