-- =============================================================================
-- RLS Final Activation SQL — Market-OSi
-- =============================================================================
--
-- WHEN TO RUN THIS FILE:
--   Only after completing Phases 0-2 of RLS_FINAL_CHECKLIST.md.
--   Specifically: only after JWT claims (app_organization_id, app_role)
--   are confirmed present in real user tokens.
--
-- WHAT THIS FILE DOES:
--   1. Enables RLS on Notification (gap in original rls-policies.sql — missing table)
--   2. Creates auth.organization_id() JWT helper function
--   3. Creates 10 tenant-isolation policies (9 original + Notification)
--
-- WHAT THIS FILE DOES NOT DO:
--   - Does NOT re-run ALTER TABLE ENABLE ROW LEVEL SECURITY on the original 9
--     tables (already done by rls-policies.sql STEP 1).
--   - Does NOT modify data.
--   - Does NOT alter any Prisma connection or service-role settings.
--
-- HOW TO USE:
--   Dashboard → SQL Editor → paste entire file → Run.
--   Then immediately run the verification queries in RLS_FINAL_CHECKLIST.md
--   Phase 4 Post-run Verification.
--
-- IDEMPOTENCY:
--   - CREATE OR REPLACE FUNCTION: safe to re-run.
--   - CREATE POLICY: NOT idempotent. Running twice will error on duplicate name.
--     If you need to re-run, first execute the rollback block from Phase 6.
--
-- =============================================================================


-- =============================================================================
-- STEP 1: Enable RLS on Notification
-- =============================================================================
-- The 9 original tables (Organization, Product, ProductBarcode, Supplier,
-- Supply, SupplyItem, Sale, SaleItem, UserRole) already have RLS enabled
-- from prisma/rls-policies.sql STEP 1.
-- Notification was added in migration 20260602000003 but was not included
-- in the original rls-policies.sql — this closes that gap.

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- STEP 2: JWT helper function
-- =============================================================================
-- Reads app_organization_id from the Supabase Auth JWT claims.
-- Returns NULL when the claim is absent.
-- All policies below use this function; NULL → USING evaluates to false → row denied.

CREATE OR REPLACE FUNCTION auth.organization_id() RETURNS int
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id'),
    ''
  )::int
$$;


-- =============================================================================
-- STEP 3: Tenant-isolation policies for the `authenticated` role
-- =============================================================================
-- Each policy scopes row visibility to the organization embedded in the JWT.
-- Prisma (service_role / postgres) bypasses these policies by design.
-- Only direct Supabase client / PostgREST / realtime connections are affected.

-- Organization: user can only see their own organization row
CREATE POLICY "org_tenant_isolation" ON "Organization"
  FOR ALL TO authenticated
  USING (id = auth.organization_id());

-- Product: scoped to user's organization
CREATE POLICY "product_tenant_isolation" ON "Product"
  FOR ALL TO authenticated
  USING ("organizationId" = auth.organization_id());

-- ProductBarcode: no organizationId directly — scoped via parent Product
CREATE POLICY "product_barcode_tenant_isolation" ON "ProductBarcode"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Product" p
      WHERE p.id = "ProductBarcode"."productId"
        AND p."organizationId" = auth.organization_id()
    )
  );

-- Supplier: scoped to user's organization
CREATE POLICY "supplier_tenant_isolation" ON "Supplier"
  FOR ALL TO authenticated
  USING ("organizationId" = auth.organization_id());

-- Supply: scoped to user's organization
CREATE POLICY "supply_tenant_isolation" ON "Supply"
  FOR ALL TO authenticated
  USING ("organizationId" = auth.organization_id());

-- SupplyItem: no organizationId directly — scoped via parent Supply
CREATE POLICY "supply_item_tenant_isolation" ON "SupplyItem"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Supply" s
      WHERE s.id = "SupplyItem"."supplyId"
        AND s."organizationId" = auth.organization_id()
    )
  );

-- Sale: scoped to user's organization
CREATE POLICY "sale_tenant_isolation" ON "Sale"
  FOR ALL TO authenticated
  USING ("organizationId" = auth.organization_id());

-- SaleItem: no organizationId directly — scoped via parent Sale
CREATE POLICY "sale_item_tenant_isolation" ON "SaleItem"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Sale" s
      WHERE s.id = "SaleItem"."saleId"
        AND s."organizationId" = auth.organization_id()
    )
  );

-- UserRole: user can only see UserRole rows for their organization
CREATE POLICY "user_role_tenant_isolation" ON "UserRole"
  FOR ALL TO authenticated
  USING ("organizationId" = auth.organization_id());

-- Notification: scoped to user's organization
-- Added here because Notification was not in the original rls-policies.sql.
CREATE POLICY "notification_tenant_isolation" ON "Notification"
  FOR ALL TO authenticated
  USING ("organizationId" = auth.organization_id());
