-- =============================================================================
-- RLS Phase 0 Patch — Market-OSi
-- =============================================================================
--
-- PURPOSE:
--   Enable ROW LEVEL SECURITY on the 6 tables that were missed when
--   prisma/rls-policies.sql STEP 1 was partially executed.
--
-- WHAT THIS FILE DOES:
--   Only runs ALTER TABLE ... ENABLE ROW LEVEL SECURITY.
--   Does NOT create any policies.
--   Does NOT modify any data.
--   Does NOT touch Organization, Supply, or SupplyItem (already enabled).
--
-- SAFETY:
--   ENABLE ROW LEVEL SECURITY with no active policies = default-deny for the
--   anon and authenticated roles, but the postgres / service role (Prisma)
--   is unaffected. All existing application behaviour is preserved.
--
-- HOW TO USE:
--   Dashboard → SQL Editor → paste → Run.
--   Then re-run Phase 0-A verification query to confirm all 9 tables show
--   rowsecurity = true.
--
-- IDEMPOTENCY:
--   Running ENABLE ROW LEVEL SECURITY on a table that already has it enabled
--   is a no-op. This file is safe to re-run.
--
-- =============================================================================

-- These 6 tables were created via Prisma SQL migrations or direct SQL Editor
-- runs and did not receive ENABLE ROW LEVEL SECURITY at creation time.
-- Organization, Supply, and SupplyItem are intentionally excluded:
-- they already have RLS enabled.

ALTER TABLE "Product"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductBarcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sale"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole"       ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- VERIFICATION — run immediately after the patch
-- =============================================================================
-- All 9 tenant tables must show rowsecurity = true.
--
-- SELECT
--   tablename,
--   rowsecurity   AS rls_enabled,
--   forcerowsecurity AS rls_forced
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'Organization', 'Product', 'ProductBarcode',
--     'Supplier', 'Supply', 'SupplyItem',
--     'Sale', 'SaleItem', 'UserRole'
--   )
-- ORDER BY tablename;
--
-- Expected: all 9 rows with rls_enabled = true.
-- =============================================================================
