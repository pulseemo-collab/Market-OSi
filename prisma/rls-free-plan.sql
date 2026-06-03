-- =============================================================================
-- RLS Free Plan Activation — Market-OSi
-- =============================================================================
--
-- STRATEGY: Option A — public.get_my_organization_id() + SECURITY DEFINER
--
-- This file replaces:
--   prisma/rls-activation-final.sql  (used auth.organization_id() — JWT claim,
--                                      requires Supabase Team/Enterprise plan)
--
-- This file does NOT replace:
--   prisma/rls-phase0-patch.sql      (must be run BEFORE this file)
--
-- PREREQUISITE:
--   Run prisma/rls-phase0-patch.sql first.
--   After that patch, these tables have RLS enabled:
--     Organization ✓  Supply ✓  SupplyItem ✓   ← already enabled before patch
--     Product ✓  ProductBarcode ✓  Supplier ✓   ← enabled by patch
--     Sale ✓  SaleItem ✓  UserRole ✓            ← enabled by patch
--   Notification is NOT yet enabled — this file handles it (STEP 1 below).
--
-- WHAT THIS FILE DOES:
--   STEP 1 — Enables RLS on Notification (the one remaining missing table).
--   STEP 2 — Creates public.get_my_organization_id() helper function.
--   STEP 3 — Creates 10 tenant-isolation policies.
--
-- WHAT THIS FILE DOES NOT DO:
--   Does NOT touch Organization, Supply, SupplyItem, Product, ProductBarcode,
--   Supplier, Sale, SaleItem, or UserRole ENABLE statements (already done).
--   Does NOT modify any data.
--   Does NOT affect Prisma (service role bypasses RLS by design).
--
-- HOW TO USE:
--   1. Run prisma/rls-phase0-patch.sql (if not already done).
--   2. Paste this entire file into Supabase Dashboard → SQL Editor → Run.
--   3. Immediately run the verification queries in RLS_FREE_PLAN_CHECKLIST.md.
--
-- IDEMPOTENCY:
--   STEP 1: ENABLE RLS on an already-enabled table is a no-op.
--   STEP 2: CREATE OR REPLACE FUNCTION is safe to re-run.
--   STEP 3: CREATE POLICY is NOT idempotent. If policies already exist with
--           the same names, the statements will error. Run the rollback block
--           from RLS_FREE_PLAN_CHECKLIST.md Phase Rollback-A first, then re-run.
--
-- =============================================================================


-- =============================================================================
-- STEP 1: Enable RLS on Notification
-- =============================================================================
-- Notification was added in migration 20260602000003_add_notifications.
-- It was not covered by rls-phase0-patch.sql (which only fixed the original
-- 9 tables). This is the final missing ENABLE statement.

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- STEP 2: get_my_organization_id() helper function
-- =============================================================================
--
-- PURPOSE:
--   Looks up the organizationId for the currently authenticated user by querying
--   UserRole directly. Returns NULL if the user has no UserRole record.
--
-- WHY SECURITY DEFINER:
--   UserRole has RLS enabled. If this function ran as the calling role
--   (authenticated), it would need to pass UserRole's own RLS policy to return
--   a row — but UserRole's policy also calls this function. That is a circular
--   dependency. SECURITY DEFINER runs the function as its owner (the postgres
--   role), which has BYPASSRLS. The lookup always succeeds, breaking the cycle.
--
-- WHY STABLE:
--   auth.uid() returns the same UUID for the entire query. PostgreSQL can
--   evaluate a STABLE function with constant arguments once per statement,
--   caching the result across all row evaluations in the same query. This means
--   the UserRole lookup happens at most once per query, not once per row.
--
-- WHAT HAPPENS WHEN NULL IS RETURNED:
--   All policy USING clauses take the form:
--     "organizationId" = public.get_my_organization_id()
--   If the function returns NULL:
--     "organizationId" = NULL  →  UNKNOWN  →  treated as FALSE
--   Every row is denied. This is the correct and safe default for users who
--   have no UserRole record in the database.

CREATE OR REPLACE FUNCTION public.get_my_organization_id()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT "organizationId"
  FROM   "UserRole"
  WHERE  "userId" = auth.uid()::text
  LIMIT  1
$$;

-- Only the authenticated role needs to call this function.
-- Revoking from PUBLIC prevents the anon role and other roles from invoking it.
REVOKE EXECUTE ON FUNCTION public.get_my_organization_id() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_organization_id() TO   authenticated;


-- =============================================================================
-- STEP 3: Tenant-isolation policies — authenticated role
-- =============================================================================
--
-- All policies use FOR ALL: they apply to SELECT, INSERT, UPDATE, and DELETE.
-- The USING clause filters which existing rows are visible / deletable / updatable.
-- No WITH CHECK clause is added here — INSERTs and UPDATEs are currently
-- performed exclusively through Prisma (service role, bypasses RLS).
-- Add WITH CHECK clauses only if you introduce direct authenticated-role writes.
--
-- Tables are ordered: direct-organizationId first, then parent-table EXISTS.
-- ----------------------------------------------------------------------------


-- Organization
-- A user can only see the organization row they belong to.
CREATE POLICY "org_tenant_isolation" ON "Organization"
  FOR ALL TO authenticated
  USING (id = public.get_my_organization_id());


-- Product
CREATE POLICY "product_tenant_isolation" ON "Product"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());


-- Supplier
CREATE POLICY "supplier_tenant_isolation" ON "Supplier"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());


-- Supply
CREATE POLICY "supply_tenant_isolation" ON "Supply"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());


-- Sale
CREATE POLICY "sale_tenant_isolation" ON "Sale"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());


-- UserRole
-- A user can only see UserRole rows for their own organization.
-- Note: SECURITY DEFINER on get_my_organization_id() means the inner lookup
-- bypasses this very policy — no circular dependency.
CREATE POLICY "user_role_tenant_isolation" ON "UserRole"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());


-- Notification
-- Added in migration 20260602000003; was missing from original rls-policies.sql.
CREATE POLICY "notification_tenant_isolation" ON "Notification"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());


-- ProductBarcode
-- No organizationId column. Scoped via parent Product.
CREATE POLICY "product_barcode_tenant_isolation" ON "ProductBarcode"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Product" p
      WHERE  p.id                = "ProductBarcode"."productId"
        AND  p."organizationId"  = public.get_my_organization_id()
    )
  );


-- SupplyItem
-- No organizationId column. Scoped via parent Supply.
CREATE POLICY "supply_item_tenant_isolation" ON "SupplyItem"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Supply" s
      WHERE  s.id                = "SupplyItem"."supplyId"
        AND  s."organizationId"  = public.get_my_organization_id()
    )
  );


-- SaleItem
-- No organizationId column. Scoped via parent Sale.
CREATE POLICY "sale_item_tenant_isolation" ON "SaleItem"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Sale" s
      WHERE  s.id                = "SaleItem"."saleId"
        AND  s."organizationId"  = public.get_my_organization_id()
    )
  );
