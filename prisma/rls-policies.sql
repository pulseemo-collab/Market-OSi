-- =============================================================================
-- Row Level Security (RLS) Policies for Market-OSi
-- =============================================================================
--
-- EXECUTION: Run this file manually in the Supabase SQL Editor.
-- DO NOT run it automatically via Prisma migrations — applying policies
-- requires careful timing relative to existing data and connection pooling.
--
-- ARCHITECTURE NOTE — How this app connects to the database:
--
--   Prisma uses DATABASE_URL (the Supabase "pooler" or direct connection).
--   This connection runs as the postgres service-role user, which BYPASSES
--   all RLS policies by default (service role = superuser-equivalent).
--
--   What this means in practice:
--
--   ┌──────────────────────────────────────────────────────────────────┐
--   │  PRISMA (server-side, service role)                             │
--   │    → RLS does NOT filter these queries                          │
--   │    → Security is enforced by requirePermission() + organizationId│
--   │      filtering in every API route handler                       │
--   ├──────────────────────────────────────────────────────────────────┤
--   │  SUPABASE JS CLIENT (anon / authenticated JWT, if used directly) │
--   │    → RLS DOES filter these queries                              │
--   │    → Policies in this file apply here                           │
--   └──────────────────────────────────────────────────────────────────┘
--
-- CURRENT STATE: The app does not use the Supabase JS client for data queries;
-- all data goes through Prisma. Enabling RLS now is a forward-looking step
-- that prepares the database for:
--   1. Future direct Supabase client queries (e.g., realtime subscriptions)
--   2. Supabase Studio / dashboard access restrictions
--   3. External tools / integrations that connect via anon/user role
--
-- WHAT THESE POLICIES PROTECT:
--   • Prevents cross-organization data leaks if the Supabase anon key is
--     ever used directly (e.g., realtime, storage, edge functions)
--   • Restricts Supabase Dashboard row browsing to data within the
--     authenticated user's organization
--   • Acts as a defence-in-depth layer behind the application-level checks
--
-- WHAT THESE POLICIES DO NOT PROTECT (current state):
--   • Prisma queries — these run as service role and bypass RLS entirely
--   • API route security — still fully owned by requirePermission()
--
-- CUSTOM CLAIMS NEEDED (future work):
--   To make policies meaningful for authenticated users, you must embed the
--   user's organizationId in the Supabase Auth JWT. This requires:
--   1. A Postgres function (get_my_organization_id) that reads UserRole
--   2. A Supabase Auth Hook (Custom Access Token Hook) that calls it
--      and injects the claim into the JWT before it is issued
--   See the RLS_SECURITY.md file for the full implementation plan.
--
-- =============================================================================


-- =============================================================================
-- STEP 1: Enable RLS on all tenant-scoped tables
-- =============================================================================
-- Enabling RLS does not block anything on its own — rows remain visible to
-- the service role (Prisma). It starts enforcing policies only for
-- non-superuser roles (anon, authenticated).

ALTER TABLE "Organization"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductBarcode"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supply"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplyItem"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sale"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole"         ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- STEP 2: Service-role bypass (Prisma connection)
-- =============================================================================
-- Explicitly document that service_role bypasses RLS.
-- These are no-op policies — Postgres already grants service_role full access —
-- but they make the intent clear when reading the policy list in Supabase Studio.

-- (No explicit policy needed; service_role is exempt from RLS by Supabase default.)
-- To verify: SELECT current_setting('role') in a Prisma raw query should show
-- "postgres" or a role that has BYPASSRLS. Do not remove that grant.


-- =============================================================================
-- STEP 3: Deny-all fallback for the `anon` role
-- =============================================================================
-- If no policy matches, Postgres denies the row. These explicit DENY policies
-- make the intent self-documenting. Remove or replace them when you add
-- authenticated-user policies below.
--
-- Uncomment these if you want to be explicit. By default, RLS with no matching
-- policy already produces an empty result set for anon/authenticated.

-- CREATE POLICY "anon_deny_all_organization" ON "Organization"
--   AS RESTRICTIVE FOR ALL TO anon USING (false);

-- CREATE POLICY "anon_deny_all_product" ON "Product"
--   AS RESTRICTIVE FOR ALL TO anon USING (false);

-- (etc. — not required; default-deny is RLS default behaviour)


-- =============================================================================
-- STEP 4: Organization-scoped policies for the `authenticated` role
-- =============================================================================
-- These policies use a custom JWT claim `app.organization_id` that will be
-- injected by the Supabase Auth Custom Access Token Hook (see RLS_SECURITY.md).
--
-- Until the hook is implemented, the claim will be absent from JWTs and the
-- policies will evaluate to false — effectively deny-all for authenticated
-- users who bypass Prisma. This is intentional and safe because:
--   • All real queries go through Prisma (service role, no RLS)
--   • No authenticated-role direct queries exist today
--
-- When the Custom Access Token Hook is live, uncomment these policies.
-- ----------------------------------------------------------------------------

-- Helper: extract the organization ID from the JWT.
-- Returns NULL if the claim is absent (policy evaluates to false = deny).
--
-- CREATE OR REPLACE FUNCTION auth.organization_id() RETURNS int
--   LANGUAGE sql STABLE
-- AS $$
--   SELECT NULLIF(
--     (current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id'),
--     ''
--   )::int
-- $$;


-- -- Organization: a user can only see their own organization row
-- CREATE POLICY "org_tenant_isolation" ON "Organization"
--   FOR ALL TO authenticated
--   USING (id = auth.organization_id());

-- -- Product: scoped to user's organization
-- CREATE POLICY "product_tenant_isolation" ON "Product"
--   FOR ALL TO authenticated
--   USING ("organizationId" = auth.organization_id());

-- -- ProductBarcode: no organizationId directly — access via parent Product
-- -- A user can read barcodes only for products in their organization.
-- -- NOTE: This requires a JOIN; Postgres RLS supports this via EXISTS.
-- CREATE POLICY "product_barcode_tenant_isolation" ON "ProductBarcode"
--   FOR ALL TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1 FROM "Product" p
--       WHERE p.id = "ProductBarcode"."productId"
--         AND p."organizationId" = auth.organization_id()
--     )
--   );

-- -- Supplier: scoped to user's organization
-- CREATE POLICY "supplier_tenant_isolation" ON "Supplier"
--   FOR ALL TO authenticated
--   USING ("organizationId" = auth.organization_id());

-- -- Supply: scoped to user's organization
-- CREATE POLICY "supply_tenant_isolation" ON "Supply"
--   FOR ALL TO authenticated
--   USING ("organizationId" = auth.organization_id());

-- -- SupplyItem: no organizationId directly — access via parent Supply
-- CREATE POLICY "supply_item_tenant_isolation" ON "SupplyItem"
--   FOR ALL TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1 FROM "Supply" s
--       WHERE s.id = "SupplyItem"."supplyId"
--         AND s."organizationId" = auth.organization_id()
--     )
--   );

-- -- Sale: scoped to user's organization
-- CREATE POLICY "sale_tenant_isolation" ON "Sale"
--   FOR ALL TO authenticated
--   USING ("organizationId" = auth.organization_id());

-- -- SaleItem: no organizationId directly — access via parent Sale
-- CREATE POLICY "sale_item_tenant_isolation" ON "SaleItem"
--   FOR ALL TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1 FROM "Sale" s
--       WHERE s.id = "SaleItem"."saleId"
--         AND s."organizationId" = auth.organization_id()
--     )
--   );

-- -- UserRole: a user can only see UserRole rows for their organization
-- CREATE POLICY "user_role_tenant_isolation" ON "UserRole"
--   FOR ALL TO authenticated
--   USING ("organizationId" = auth.organization_id());


-- =============================================================================
-- STEP 5: Verification queries (run after applying policies)
-- =============================================================================
-- Check which tables have RLS enabled:
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
--
-- List all policies:
--
-- SELECT schemaname, tablename, policyname, roles, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
