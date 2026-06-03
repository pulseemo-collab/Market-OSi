# RLS Free Plan Checklist — Market-OSi

> **STATUS: READY TO EXECUTE — NOT YET ACTIVATED**
> Follow phases in strict order. Do not skip or reorder steps.
> Each phase has a go/no-go gate before the next phase begins.

---

## What changed from the original design

The original plan used a **Supabase Custom Access Token Hook** (Team/Enterprise
plan only) to inject `app_organization_id` into every JWT. That plan is blocked.

This checklist uses **Option A: `public.get_my_organization_id()`**, a
`SECURITY DEFINER` Postgres function that queries `UserRole` directly using
`auth.uid()`. It is available on the Supabase Free plan and achieves identical
tenant isolation.

| Original (blocked) | Free plan replacement |
|---|---|
| JWT hook injects `app_organization_id` | No hook needed |
| `auth.organization_id()` reads JWT claim | `public.get_my_organization_id()` queries `UserRole` |
| Policy: `USING ("organizationId" = auth.organization_id())` | Policy: `USING ("organizationId" = public.get_my_organization_id())` |
| Requires Team/Enterprise plan | Works on Free plan |

**Upgrade path:** When/if upgrading to a paid plan, replace the function body
in one SQL statement. All 10 policies stay unchanged.

---

## Files now obsolete (keep for reference, do not execute)

| File | Reason |
|---|---|
| `prisma/rls-access-token-hook.sql` | Hook requires Team/Enterprise plan |
| `prisma/rls-activation-final.sql` | Uses `auth.organization_id()` (JWT claim) |
| `RLS_ACTIVATION_CHECKLIST.md` Phases 1–2 | JWT hook registration no longer needed |
| `RLS_FINAL_CHECKLIST.md` Phases 1–2 | Same — JWT verification phases obsolete |

---

## Architecture recap

```
Browser → Next.js API Route → requirePermission() → Prisma → postgres (BYPASSRLS) → DB
                                                                 ↑
                                               RLS policies never evaluated here

Browser → Supabase JS client (realtime / PostgREST / edge fn) → authenticated role
                                                                 ↓
                                               RLS policies evaluated here
                                               get_my_organization_id() → queries UserRole
                                               → filters rows to user's org only
```

| Security layer | Enforced by | Status |
|---|---|---|
| API routes | `requirePermission()` + `organizationId` in every Prisma query | **Active** |
| Database — direct client access | RLS policies (this checklist) | **Pending** |

---

## Critical warnings

> **W1 — `rls-phase0-patch.sql` must be run before `rls-free-plan.sql`.**
> The patch enables RLS on 6 tables that were missed earlier. `rls-free-plan.sql`
> assumes those 6 tables already have RLS enabled and does not repeat the
> ALTER TABLE statements for them.

> **W2 — Policies are not idempotent.**
> `CREATE POLICY` fails if a policy with the same name already exists on the
> table. If you need to re-run `rls-free-plan.sql`, execute Rollback Phase A
> first to drop existing policies, then re-run.

> **W3 — Prisma queries are not affected by RLS.**
> All Next.js API routes connect as the postgres service role via `DATABASE_URL`.
> That role has `BYPASSRLS`. All existing application behaviour is preserved
> before, during, and after activation.

> **W4 — `npm run build` must pass before and after each phase.**
> RLS is a database-only change with no impact on Prisma-generated TypeScript
> types. The build must remain green throughout.

---

## Phase 0 — Pre-flight

All queries are read-only. Run in **Supabase Dashboard → SQL Editor**.

---

### 0-A — Check RLS status on all 10 tenant tables

```sql
SELECT
  tablename,
  rowsecurity      AS rls_enabled,
  forcerowsecurity AS rls_forced
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'Organization', 'Product', 'ProductBarcode',
    'Supplier', 'Supply', 'SupplyItem',
    'Sale', 'SaleItem', 'UserRole',
    'Notification'
  )
ORDER BY tablename;
```

**Interpret the results:**

| Scenario | Action |
|---|---|
| All 10 show `rls_enabled = true` | Skip 0-B and 0-C, proceed to 0-D |
| Organization, Supply, SupplyItem = true; others = false | Run 0-B then 0-C |
| Any other combination | Run 0-C (it is idempotent and safe) |

---

### 0-B — Run rls-phase0-patch.sql (if needed)

Paste the entire contents of `prisma/rls-phase0-patch.sql` into SQL Editor
and run. This enables RLS on: Product, ProductBarcode, Supplier, Sale,
SaleItem, UserRole.

After running, re-run query 0-A. The 9 original tables must all show
`rls_enabled = true`. Notification will still show `false` — that is
correct; `rls-free-plan.sql` handles it.

**Gate:** After 0-B, these 9 tables must show `rls_enabled = true`:
Organization, Product, ProductBarcode, Supplier, Supply, SupplyItem,
Sale, SaleItem, UserRole.

---

### 0-C — Confirm no active policies exist

```sql
SELECT COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public';
```

**Expected:** `0`

If policies already exist, list them:

```sql
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

If any of the 10 policy names from `rls-free-plan.sql` already exist, run
Rollback Phase A to drop them before proceeding.

**Gate:** `policy_count = 0`.

---

### 0-D — Confirm get_my_organization_id() does not yet exist

```sql
SELECT routine_name, routine_schema
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'get_my_organization_id';
```

**Expected:** `0 rows`

If the function already exists from a previous attempt, it is safe to
overwrite — `rls-free-plan.sql` uses `CREATE OR REPLACE FUNCTION`.

---

### 0-E — Confirm UserRole data is populated

```sql
SELECT
  ur."userId",
  ur."email",
  ur."roli",
  ur."organizationId",
  o."name" AS org_name
FROM "UserRole" ur
JOIN "Organization" o ON o.id = ur."organizationId"
ORDER BY ur."organizationId", ur."email";
```

Every user who signs in must have a row here. Users without a `UserRole`
record will receive zero rows from all RLS-filtered queries (the function
returns NULL → deny all). This is the correct and safe behaviour, but
confirm no active users are missing records before activating.

---

### 0-F — Baseline build check

Run locally:

```
npm run build
```

**Expected:** Build completes with zero errors.

**Gate:** All Phase 0 checks pass, build is green. Proceed to Phase 1.

---

## Phase 1 — Deploy get_my_organization_id()

**Goal:** Create the helper function that all 10 RLS policies will use.
Run only STEP 1 and STEP 2 from `rls-free-plan.sql` (function + grants).
Do not run STEP 3 (policies) yet.

---

### 1-A — Run the function SQL

Paste **only STEP 1 and STEP 2** of `prisma/rls-free-plan.sql` into
SQL Editor and run. The block to run is:

```sql
-- STEP 1
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;

-- STEP 2
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

REVOKE EXECUTE ON FUNCTION public.get_my_organization_id() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_organization_id() TO   authenticated;
```

---

### 1-B — Verify function exists with correct attributes

```sql
SELECT
  routine_name,
  routine_schema,
  routine_type,
  security_type,
  data_type       AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'get_my_organization_id';
```

**Expected:**

| routine_name | routine_schema | routine_type | security_type | return_type |
|---|---|---|---|---|
| get_my_organization_id | public | FUNCTION | DEFINER | integer |

`security_type = DEFINER` is critical. If it shows `INVOKER`, the circular
dependency with UserRole's RLS will cause all policy evaluations to fail.

---

### 1-C — Verify grants

```sql
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name   = 'get_my_organization_id'
ORDER BY grantee;
```

**Expected:** Only `authenticated` with `EXECUTE`. No `anon`, no `PUBLIC`.

---

### 1-D — Verify Notification now has RLS enabled

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename  = 'Notification';
```

**Expected:** `rowsecurity = true`

---

### 1-E — Test the function with a simulated auth context

The function reads `auth.uid()` which is only set in a PostgREST request
context. You can simulate it in SQL Editor:

```sql
-- Replace <uuid> with a real userId from your UserRole table (query 0-E above).
SELECT set_config(
  'request.jwt.claims',
  '{"sub": "<uuid>"}',
  true   -- local to this transaction
);

SELECT public.get_my_organization_id() AS org_id;
```

**Expected:** The integer `organizationId` that matches the UserRole row
for the UUID you supplied.

Test with a second user from a different organization to confirm the function
returns a different integer.

Test with a UUID that does not exist in UserRole:

```sql
SELECT set_config(
  'request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-000000000000"}',
  true
);
SELECT public.get_my_organization_id() AS org_id;
```

**Expected:** `NULL` (the safe deny-all default for unknown users).

**Gate:** Function exists, `security_type = DEFINER`, `authenticated` has
EXECUTE, Notification RLS is on, all three test cases return correct values.

---

## Phase 2 — Policy activation

> **Hard gate:** Phase 1 must be fully complete before running any policy SQL.
> Specifically: the function must exist, have `SECURITY DEFINER`, and the
> test in 1-E must return the correct organizationId.

---

### 2-A — Run the policies from rls-free-plan.sql

Paste **only STEP 3** of `prisma/rls-free-plan.sql` into SQL Editor and run.
The 10 `CREATE POLICY` statements to execute are:

```sql
CREATE POLICY "org_tenant_isolation" ON "Organization"
  FOR ALL TO authenticated
  USING (id = public.get_my_organization_id());

CREATE POLICY "product_tenant_isolation" ON "Product"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());

CREATE POLICY "supplier_tenant_isolation" ON "Supplier"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());

CREATE POLICY "supply_tenant_isolation" ON "Supply"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());

CREATE POLICY "sale_tenant_isolation" ON "Sale"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());

CREATE POLICY "user_role_tenant_isolation" ON "UserRole"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());

CREATE POLICY "notification_tenant_isolation" ON "Notification"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());

CREATE POLICY "product_barcode_tenant_isolation" ON "ProductBarcode"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Product" p
      WHERE  p.id               = "ProductBarcode"."productId"
        AND  p."organizationId" = public.get_my_organization_id()
    )
  );

CREATE POLICY "supply_item_tenant_isolation" ON "SupplyItem"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Supply" s
      WHERE  s.id               = "SupplyItem"."supplyId"
        AND  s."organizationId" = public.get_my_organization_id()
    )
  );

CREATE POLICY "sale_item_tenant_isolation" ON "SaleItem"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Sale" s
      WHERE  s.id               = "SaleItem"."saleId"
        AND  s."organizationId" = public.get_my_organization_id()
    )
  );
```

---

### 2-B — Verify all 10 policies were created

```sql
SELECT
  tablename,
  policyname,
  array_to_string(roles, ', ') AS roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**Expected: exactly 10 rows**

| tablename | policyname | roles | cmd |
|---|---|---|---|
| Notification | notification_tenant_isolation | authenticated | ALL |
| Organization | org_tenant_isolation | authenticated | ALL |
| Product | product_tenant_isolation | authenticated | ALL |
| ProductBarcode | product_barcode_tenant_isolation | authenticated | ALL |
| Sale | sale_tenant_isolation | authenticated | ALL |
| SaleItem | sale_item_tenant_isolation | authenticated | ALL |
| Supplier | supplier_tenant_isolation | authenticated | ALL |
| Supply | supply_tenant_isolation | authenticated | ALL |
| SupplyItem | supply_item_tenant_isolation | authenticated | ALL |
| UserRole | user_role_tenant_isolation | authenticated | ALL |

**Gate:** Exactly 10 rows, all `roles = authenticated`, all `cmd = ALL`.

---

### 2-C — Confirm RLS is enabled on all 10 tables

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'Organization', 'Product', 'ProductBarcode',
    'Supplier', 'Supply', 'SupplyItem',
    'Sale', 'SaleItem', 'UserRole',
    'Notification'
  )
ORDER BY tablename;
```

**Expected:** All 10 rows show `rowsecurity = true`.

---

## Phase 3 — Post-activation testing

---

### 3-A — Build check

```
npm run build
```

Must pass. RLS policies are database-only; Prisma types are unaffected.

---

### 3-B — Smoke-test all Prisma-backed routes

Load each of these in the running application. All must return data as before
because Prisma uses the postgres service role which bypasses RLS:

| Route | Page |
|---|---|
| `/api/products` | Produktet |
| `/api/sales` | Shitjet |
| `/api/suppliers` | Furnitoret |
| `/api/supplies` | Furnizime |
| `/api/dashboard` | Dashboard |
| `/api/notifications` | Njoftime |
| `/api/reorder-suggestions` | Porositje të sugjeruara |
| `/api/audit-logs` | Regjistri |

**Expected:** All pages load with identical data to pre-activation behaviour.

---

### 3-C — Confirm Prisma service role bypasses RLS

Run in SQL Editor (which connects as the postgres role):

```sql
-- Should return the full count, not filtered by any policy.
SELECT COUNT(*) AS total_products    FROM "Product";
SELECT COUNT(*) AS total_sales       FROM "Sale";
SELECT COUNT(*) AS total_userroles   FROM "UserRole";
SELECT COUNT(*) AS total_notifs      FROM "Notification";
```

Counts should match what the application displays. If counts are lower, the
service role is somehow subject to RLS — investigate immediately before
continuing.

---

### 3-D — Test direct-client tenant isolation (if applicable)

If you have or plan to add direct `@supabase/supabase-js` queries, realtime
subscriptions, or edge functions, test cross-organization isolation:

1. Sign in as a user from Organization A.
2. Make a direct Supabase client query (e.g., via PostgREST / `supabase.from()`).
3. Confirm only Organization A rows are returned.
4. Sign in as a user from Organization B.
5. Repeat — confirm Organization A rows are invisible.

If any cross-org leakage is detected, execute Rollback Phase A immediately.

---

### 3-E — Final inventory snapshot

Archive this output as the activation confirmation record:

```sql
-- Full policy inventory
SELECT
  schemaname,
  tablename,
  policyname,
  array_to_string(roles, ', ') AS roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

-- Full RLS status
SELECT tablename, rowsecurity, forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Function attributes
SELECT
  routine_name,
  routine_schema,
  security_type,
  data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'get_my_organization_id';
```

---

## Rollback

> Use if a critical issue is found after Phase 2 policy activation.
> All rollback steps are safe and non-destructive to data.

---

### Rollback A — Drop all 10 tenant-isolation policies

```sql
DROP POLICY IF EXISTS "org_tenant_isolation"               ON "Organization";
DROP POLICY IF EXISTS "product_tenant_isolation"           ON "Product";
DROP POLICY IF EXISTS "product_barcode_tenant_isolation"   ON "ProductBarcode";
DROP POLICY IF EXISTS "supplier_tenant_isolation"          ON "Supplier";
DROP POLICY IF EXISTS "supply_tenant_isolation"            ON "Supply";
DROP POLICY IF EXISTS "supply_item_tenant_isolation"       ON "SupplyItem";
DROP POLICY IF EXISTS "sale_tenant_isolation"              ON "Sale";
DROP POLICY IF EXISTS "sale_item_tenant_isolation"         ON "SaleItem";
DROP POLICY IF EXISTS "user_role_tenant_isolation"         ON "UserRole";
DROP POLICY IF EXISTS "notification_tenant_isolation"      ON "Notification";
```

Verify:

```sql
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
-- Expected: 0
```

---

### Rollback B — Drop the helper function

```sql
DROP FUNCTION IF EXISTS public.get_my_organization_id();
```

Verify:

```sql
SELECT COUNT(*) FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'get_my_organization_id';
-- Expected: 0
```

---

### Rollback C — Disable RLS (full revert only)

> Only run this if you want to completely revert to the pre-checklist state.
> Disabling RLS is non-destructive to data.

```sql
ALTER TABLE "Organization"   DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"        DISABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductBarcode" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier"       DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Supply"         DISABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplyItem"     DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Sale"           DISABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem"       DISABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole"       DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification"   DISABLE ROW LEVEL SECURITY;
```

---

### Rollback D — Post-rollback verification

```sql
-- RLS off for all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- All rows: rowsecurity = false

-- No policies remain
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
-- Expected: 0

-- Function is gone
SELECT COUNT(*) FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'get_my_organization_id';
-- Expected: 0
```

Then run `npm run build` — must still pass.

---

## Upgrade path (if plan changes)

When/if upgrading to Supabase Team/Enterprise plan, the hook approach becomes
available again. To upgrade without touching any policies:

1. Run `prisma/rls-access-token-hook.sql` in SQL Editor.
2. Register the hook in Dashboard → Authentication → Hooks.
3. Verify JWT claims (`app_organization_id`, `app_role`) appear in tokens.
4. Replace the helper function body only:

```sql
-- Swap the function to read from the JWT instead of querying UserRole.
-- All 10 policies are unchanged — they still call get_my_organization_id().
CREATE OR REPLACE FUNCTION public.get_my_organization_id()
RETURNS int
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id',
    ''
  )::int
$$;
```

Note: the upgraded version does not need `SECURITY DEFINER` because it reads
from the JWT (no UserRole lookup, no circular dependency risk).

---

## Activation progress tracker

- [ ] **Phase 0-B** — `rls-phase0-patch.sql` applied; 9 original tables have `rls_enabled = true`
- [ ] **Phase 0-C** — Zero existing policies confirmed
- [ ] **Phase 0-F** — Baseline build passes
- [ ] **Phase 1-A** — STEP 1 + STEP 2 of `rls-free-plan.sql` executed (function + Notification ENABLE)
- [ ] **Phase 1-B** — Function exists, `security_type = DEFINER`, return type `integer`
- [ ] **Phase 1-C** — Only `authenticated` has EXECUTE on the function
- [ ] **Phase 1-E** — Function returns correct org ID for test users; returns NULL for unknown UUID
- [ ] **Phase 2-A** — STEP 3 of `rls-free-plan.sql` executed (10 policies)
- [ ] **Phase 2-B** — Exactly 10 policies confirmed, all `authenticated`, all `ALL`
- [ ] **Phase 3-A** — Build passes post-activation
- [ ] **Phase 3-B** — All Prisma-backed routes return correct data
- [ ] **Phase 3-C** — Prisma service-role row counts match application

---

## File reference

| File | Purpose | Status |
|---|---|---|
| `prisma/rls-phase0-patch.sql` | ENABLE RLS on 6 missing tables — run first | Ready |
| `prisma/rls-free-plan.sql` | **Free plan activation SQL — run second** | Ready |
| `RLS_FREE_PLAN_CHECKLIST.md` | This file | Active |
| `prisma/schema.prisma` | Prisma schema (10 tenant-scoped tables) | Reference |
| `src/lib/auth-helpers.ts` | `requirePermission()` — application security layer | Reference |
| `prisma/rls-access-token-hook.sql` | Original JWT hook function (obsolete on Free plan) | Archived |
| `prisma/rls-activation-final.sql` | Original activation SQL with JWT claims (obsolete) | Archived |
| `RLS_FINAL_CHECKLIST.md` | Original checklist — Phases 1–2 no longer apply | Archived |
