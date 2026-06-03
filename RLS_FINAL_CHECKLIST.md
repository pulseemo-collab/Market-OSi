# RLS Final Activation Checklist — Market-OSi

> **STATUS: PHASE 0 FAILED — PATCH REQUIRED BEFORE CONTINUING**
> Phase 0-A revealed that only 3 of 9 required tables have RLS enabled.
> Run `prisma/rls-phase0-patch.sql` in Supabase SQL Editor, re-run Phase 0-A,
> then continue. Do not proceed to Phase 1 until all 9 tables show `rls_enabled = true`.
>
> Follow phases in strict order. Do not skip or reorder steps.
> Each phase has a go/no-go gate before the next phase begins.

---

## Gap Identified During Audit

The original `prisma/rls-policies.sql` covers 9 tables. One table was added
after that file was written and was not included:

| Table | Added in migration | organizationId | In original policies |
|---|---|---|---|
| `Notification` | `20260602000003_add_notifications` | Yes | **Missing** |

`prisma/rls-activation-final.sql` closes this gap. It enables RLS on
`Notification` and creates a total of **10 policies** (9 original + 1 new).

Tables intentionally excluded from RLS:

| Table | Reason |
|---|---|
| `AuditLog` | Service-role only; no direct client access |
| `Subscription` | Billing data; platform-owner access only via Prisma |
| `BillingAuditLog` | Platform-level audit; no tenant isolation needed |

---

## Architecture Reference

```
Browser → Next.js API Route → requirePermission() → Prisma → postgres (BYPASSRLS) → DB
                                                                 ↑
                                               RLS policies do NOT apply here

Browser → Supabase JS Client (realtime / direct) → authenticated role → RLS policies apply
```

| Security layer | Enforced by | Current status |
|---|---|---|
| API routes | `requirePermission()` + `organizationId` filter in every Prisma query | **Active** |
| Database (direct/realtime) | RLS policies (this checklist) | **Inactive — pending activation** |

---

## Critical Warnings

> **W1 — Do not enable policies before JWT claims are confirmed.**
> The policies use `auth.organization_id()` which reads `app_organization_id` from
> the JWT. If that claim is absent, all authenticated-role queries return zero rows.
> This is a silent data blackout — no error, just empty results.

> **W2 — Prisma connections are not affected by RLS.**
> All Next.js API routes connect as the postgres service role via `DATABASE_URL`.
> That role has `BYPASSRLS` and ignores all policies. Do not replace Prisma calls
> with `supabase.from(...)` in API routes without a full security review.

> **W3 — `npm run build` must pass before and after each phase.**
> RLS is a database-only change. Prisma types are unaffected. Build must stay green.

> **W4 — Policies are not idempotent.**
> `CREATE POLICY` will error if a policy with the same name already exists.
> If you need to re-run `rls-activation-final.sql`, execute the rollback block
> from Phase 6 first to drop existing policies.

---

## Phase 0 — Pre-flight Checks

**Goal:** Verify the database is in the expected baseline state before doing anything.
All queries are read-only.

---

### 0-A — Confirm RLS is enabled on the 9 original tables

Run in **Supabase Dashboard → SQL Editor**:

```sql
SELECT
  tablename,
  rowsecurity   AS rls_enabled,
  forcerowsecurity AS rls_forced
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'Organization', 'Product', 'ProductBarcode',
    'Supplier', 'Supply', 'SupplyItem',
    'Sale', 'SaleItem', 'UserRole'
  )
ORDER BY tablename;
```

**Expected — all 9 rows with `rls_enabled = true`:**

| tablename | rls_enabled | rls_forced |
|---|---|---|
| Organization | true | false |
| Product | true | false |
| ProductBarcode | true | false |
| Sale | true | false |
| SaleItem | true | false |
| Supplier | true | false |
| Supply | true | false |
| SupplyItem | true | false |
| UserRole | true | false |

If any row shows `rls_enabled = false`, run `prisma/rls-policies.sql` STEP 1
first (the `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` block).

**Gate:** All 9 rows must show `rls_enabled = true` before continuing.

---

### 0-B — Confirm Notification does NOT yet have RLS enabled

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'Notification';
```

**Expected:** `rowsecurity = false` (it will be enabled in Phase 4).

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

Investigate any existing policies before proceeding. They may conflict with
the names in `rls-activation-final.sql`.

**Gate:** No unexpected policies exist.

---

### 0-D — Confirm all tenant tables have organizationId

```sql
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'organizationId'
ORDER BY table_name;
```

**Expected tables:** `AuditLog`, `BillingAuditLog`, `Notification`, `Organization`
(as `id`), `Product`, `Sale`, `Subscription`, `Supplier`, `Supply`, `UserRole`.

Tables intentionally without a direct `organizationId`
(`ProductBarcode`, `SaleItem`, `SupplyItem`) use EXISTS subqueries in
their policies — this is covered by `rls-activation-final.sql`.

**Gate:** `Notification` must appear in this list.

---

### 0-E — Confirm auth.organization_id() does not yet exist

```sql
SELECT routine_name, routine_schema
FROM information_schema.routines
WHERE routine_schema = 'auth'
  AND routine_name   = 'organization_id';
```

**Expected:** `0 rows` (will be created in Phase 4).

---

### 0-F — Confirm custom_access_token_hook does not yet exist

```sql
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'custom_access_token_hook';
```

**Expected:** `0 rows` if Phase 1 has not been run yet.
If it returns a row, skip Phase 1 function creation and go to 1-B.

---

### 0-G — Confirm Prisma service role bypasses RLS

```sql
SELECT current_user, current_setting('role');
```

**Expected:** `postgres` (or a role name that has `BYPASSRLS`). Prisma connects
as this role via `DATABASE_URL` — it is unaffected by all RLS policies.

---

### 0-H — Baseline build check

Run locally:

```
npm run build
```

**Expected:** Build completes with zero errors.
**Status as of 2026-06-03:** Build passes (verified — 23 static pages, 0 errors).

**Gate:** Build must pass before starting Phase 1.

---

## Phase 1 — Custom Access Token Hook

**Goal:** Deploy the Postgres function that injects org/role claims into every JWT.

> Do not enable any RLS policies until Phase 2 confirms the claims are present.

---

### 1-A — Run the hook function SQL

Copy the entire contents of `prisma/rls-access-token-hook.sql` and run it in
**Supabase Dashboard → SQL Editor**.

The file creates and grants:

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims    jsonb;
  org_id    int;
  user_role text;
BEGIN
  SELECT "organizationId", "roli"
  INTO   org_id, user_role
  FROM   "UserRole"
  WHERE  "userId" = (event->>'user_id')
  LIMIT  1;

  claims := event->'claims';

  IF org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_organization_id}', to_jsonb(org_id));
  END IF;

  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_role}', to_jsonb(user_role));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC, anon, authenticated;
```

---

### 1-B — Verify the function was created

```sql
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'custom_access_token_hook';
```

**Expected:**

| routine_name | routine_type | security_type |
|---|---|---|
| custom_access_token_hook | FUNCTION | DEFINER |

---

### 1-C — Verify grants

```sql
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name   = 'custom_access_token_hook'
ORDER BY grantee;
```

**Expected:** Only `supabase_auth_admin` with `EXECUTE`. No other grantees.

---

### 1-D — Register the hook in Supabase Dashboard

> This step cannot be done via SQL.

1. Open **Supabase Dashboard → Authentication → Hooks**.
2. Enable **Custom Access Token Hook**.
3. Set function to: `public.custom_access_token_hook`
4. Click **Save**.

**Gate:** Function exists, grants are correct, Dashboard hook is registered.

---

## Phase 2 — JWT Claim Verification

**Goal:** Confirm `app_organization_id` and `app_role` appear in real user JWTs.

> **This is the most critical gate.** Do not proceed to Phase 3 or 4 until
> both claims are confirmed present. Missing claims = silent data blackout.

---

### 2-A — Verify UserRole data is populated

Run before signing in any test user:

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

Every user who signs in must have a row in `UserRole` with a non-null
`organizationId`. Users without a `UserRole` row will receive JWTs without
the claims — their org queries will return zero rows after policies are active.

---

### 2-B — Get a fresh JWT

Sign out and sign back in to the Market-OSi application. The hook only fires
for newly issued tokens. Existing sessions retain their old JWT until refresh.

---

### 2-C — Decode the JWT and verify claims

1. Open browser DevTools → Application → Local Storage.
2. Find the key matching `sb-*-auth-token`.
3. Copy the `access_token` value.
4. Paste it into **jwt.io** (Debugger tab).

Look for these keys in the payload section:

```json
{
  "app_organization_id": 1,
  "app_role": "owner"
}
```

**Both keys must be present.** Values depend on the signed-in user's `UserRole`.

If either key is missing:
- Confirm the Dashboard hook is registered (Step 1-D).
- Confirm the `UserRole` row exists for this user (Step 2-A).
- Re-run `prisma/rls-access-token-hook.sql` to refresh the function.

---

### 2-D — Verify claim reading from SQL context

This verifies the exact mechanism that RLS policies will use. Run inside a
request that carries the user's JWT (e.g., via PostgREST or a test edge function):

```sql
SELECT
  current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id' AS org_id_claim,
  current_setting('request.jwt.claims', true)::jsonb ->> 'app_role'            AS role_claim;
```

**Expected (example for org 1, role owner):**

| org_id_claim | role_claim |
|---|---|
| 1 | owner |

> Note: Running this query directly in SQL Editor returns NULL for both columns —
> SQL Editor runs as the postgres role and has no JWT context. That is expected.
> This query is meaningful only in a PostgREST / Supabase client request context.

---

### 2-E — Cross-check claim vs database

For each test user, confirm the `app_organization_id` in the JWT matches the
`organizationId` in `UserRole`:

```sql
SELECT
  ur."userId",
  ur."email",
  ur."organizationId",
  o."name" AS org_name
FROM "UserRole" ur
JOIN "Organization" o ON o.id = ur."organizationId"
WHERE ur."email" = '<test-user-email>';
```

The `organizationId` returned here must equal the `app_organization_id` in
that user's decoded JWT.

**Gate:** Both `app_organization_id` and `app_role` confirmed in JWT payload.
Cross-check passes for all test users. Only then proceed to Phase 3.

---

## Phase 3 — Policy Readiness Review

**Goal:** Final read-only checks confirming the database is ready for policies.

---

### 3-A — Re-confirm RLS enabled on all 9 original tables

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'Organization', 'Product', 'ProductBarcode',
    'Supplier', 'Supply', 'SupplyItem',
    'Sale', 'SaleItem', 'UserRole'
  )
ORDER BY tablename;
```

All 9 rows must have `rowsecurity = true`.

---

### 3-B — Confirm Notification RLS is still off (will be enabled in Phase 4)

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'Notification';
```

**Expected:** `rowsecurity = false`

---

### 3-C — Re-confirm no policies exist

```sql
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
```

**Expected:** `0`

---

### 3-D — Confirm auth.organization_id() still does not exist

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'auth'
  AND routine_name   = 'organization_id';
```

**Expected:** `0 rows` (created in Phase 4)

---

### 3-E — Build check before activation

```
npm run build
```

Must pass before running any policy SQL.

**Gate:** All checks in Phase 3 pass. Build is green. Only then proceed to Phase 4.

---

## Phase 4 — Policy Activation

> **Hard gate:** Phase 2 must be fully complete (JWT claims confirmed) before
> running a single SQL statement in this phase.

---

### 4-A — Run rls-activation-final.sql

Copy the entire contents of `prisma/rls-activation-final.sql` and run it in
**Supabase Dashboard → SQL Editor**.

What the file executes:
1. `ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;`
2. `CREATE OR REPLACE FUNCTION auth.organization_id() RETURNS int ...`
3. 10 `CREATE POLICY` statements (9 original + Notification)

Full file contents for reference:

```sql
-- STEP 1: Enable RLS on Notification
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;

-- STEP 2: JWT helper function
CREATE OR REPLACE FUNCTION auth.organization_id() RETURNS int
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id'),
    ''
  )::int
$$;

-- STEP 3: Tenant-isolation policies
CREATE POLICY "org_tenant_isolation" ON "Organization"
  FOR ALL TO authenticated USING (id = auth.organization_id());

CREATE POLICY "product_tenant_isolation" ON "Product"
  FOR ALL TO authenticated USING ("organizationId" = auth.organization_id());

CREATE POLICY "product_barcode_tenant_isolation" ON "ProductBarcode"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Product" p
      WHERE p.id = "ProductBarcode"."productId"
        AND p."organizationId" = auth.organization_id()
    )
  );

CREATE POLICY "supplier_tenant_isolation" ON "Supplier"
  FOR ALL TO authenticated USING ("organizationId" = auth.organization_id());

CREATE POLICY "supply_tenant_isolation" ON "Supply"
  FOR ALL TO authenticated USING ("organizationId" = auth.organization_id());

CREATE POLICY "supply_item_tenant_isolation" ON "SupplyItem"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Supply" s
      WHERE s.id = "SupplyItem"."supplyId"
        AND s."organizationId" = auth.organization_id()
    )
  );

CREATE POLICY "sale_tenant_isolation" ON "Sale"
  FOR ALL TO authenticated USING ("organizationId" = auth.organization_id());

CREATE POLICY "sale_item_tenant_isolation" ON "SaleItem"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Sale" s
      WHERE s.id = "SaleItem"."saleId"
        AND s."organizationId" = auth.organization_id()
    )
  );

CREATE POLICY "user_role_tenant_isolation" ON "UserRole"
  FOR ALL TO authenticated USING ("organizationId" = auth.organization_id());

CREATE POLICY "notification_tenant_isolation" ON "Notification"
  FOR ALL TO authenticated USING ("organizationId" = auth.organization_id());
```

---

### 4-B — Verify auth.organization_id() was created

```sql
SELECT routine_name, routine_schema, routine_type
FROM information_schema.routines
WHERE routine_schema = 'auth'
  AND routine_name   = 'organization_id';
```

**Expected:**

| routine_name | routine_schema | routine_type |
|---|---|---|
| organization_id | auth | FUNCTION |

---

### 4-C — Verify Notification RLS is now enabled

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'Notification';
```

**Expected:** `rowsecurity = true`

---

### 4-D — Verify all 10 policies were created

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

**Expected: 10 rows**

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

**Gate:** Exactly 10 policies present, all with `roles = authenticated`.

---

## Phase 5 — Post-Activation Testing

---

### 5-A — Build check

```
npm run build
```

Must pass. Policies are database-only; Prisma types are not affected.

---

### 5-B — Smoke-test all Prisma-backed API routes

Test these routes in the running application. All must return data as before
because Prisma (service role) bypasses RLS:

| Route | Test action |
|---|---|
| `/api/products` | Load products list page |
| `/api/sales` | Load sales history page |
| `/api/suppliers` | Load suppliers page |
| `/api/supplies` | Load furnizime page |
| `/api/dashboard` | Load dashboard page |
| `/api/notifications` | Load notifications |
| `/api/reorder-suggestions` | Load low-stock suggestions |

**Expected:** All pages load with data identical to pre-activation behavior.

---

### 5-C — Verify Prisma still bypasses RLS

```sql
-- Run inside a Supabase SQL Editor session.
-- SQL Editor uses the postgres / service role which bypasses RLS.
SELECT COUNT(*) FROM "Product";
SELECT COUNT(*) FROM "Notification";
```

Row counts should match what you see in the app. If counts are lower, the
service role is not bypassing RLS — investigate immediately.

---

### 5-D — Test direct Supabase client isolation (if applicable)

If you have or plan to add direct `@supabase/supabase-js` queries or realtime
subscriptions, perform cross-organization isolation testing:

1. Sign in as a user from Organization A.
2. Query the table directly via Supabase client.
3. Confirm only Organization A rows are returned.
4. Sign in as a user from Organization B.
5. Repeat — confirm Organization A rows are invisible.

If any cross-org leakage occurs, execute the rollback (Phase 6) immediately.

---

### 5-E — Final policy inventory

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  array_to_string(roles, ', ') AS roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
```

Archive this output as your activation confirmation record.

---

## Phase 6 — Rollback Plan

> Use if a critical issue is found after Phase 4 activation.
> All rollback steps are safe and non-destructive to data.

---

### 6-A — Drop all 10 tenant-isolation policies

Run in Supabase SQL Editor:

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

### 6-B — Drop the JWT helper function

```sql
DROP FUNCTION IF EXISTS auth.organization_id();
```

Verify:

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'auth' AND routine_name = 'organization_id';
-- Expected: 0 rows
```

---

### 6-C — Disable RLS on Notification (reverse the Phase 4 addition)

```sql
ALTER TABLE "Notification" DISABLE ROW LEVEL SECURITY;
```

The original 9 tables had RLS enabled before this checklist; decide whether
to disable them too. To fully revert to the pre-activation state:

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

### 6-D — Remove the Custom Access Token Hook

1. Open **Supabase Dashboard → Authentication → Hooks**.
2. Disable the **Custom Access Token Hook**.
3. Optionally drop the function:

```sql
DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);
```

---

### 6-E — Post-rollback verification

```sql
-- Confirm RLS is off for all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- All rows: rowsecurity = false

-- Confirm no policies remain
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
-- Expected: 0

-- Confirm helper function is gone
SELECT COUNT(*) FROM information_schema.routines
WHERE routine_schema = 'auth' AND routine_name = 'organization_id';
-- Expected: 0
```

Then run `npm run build` — must still pass.

---

## Verification SQL Summary

Collect these five queries as a post-activation snapshot:

```sql
-- 1. RLS status on all public tables
SELECT tablename, rowsecurity, forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 2. All active policies
SELECT tablename, policyname, array_to_string(roles, ', ') AS roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3. auth.organization_id() function
SELECT routine_name, routine_schema, security_type
FROM information_schema.routines
WHERE routine_schema = 'auth' AND routine_name = 'organization_id';

-- 4. custom_access_token_hook function
SELECT routine_name, routine_schema, security_type
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'custom_access_token_hook';

-- 5. Hook grants
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'custom_access_token_hook';
```

---

## File Reference

| File | Purpose |
|---|---|
| `prisma/rls-policies.sql` | Original RLS enable + commented-out policies (9 tables) |
| `prisma/rls-phase0-patch.sql` | **Phase 0 patch — ENABLE RLS on 6 missing tables (run first)** |
| `prisma/rls-access-token-hook.sql` | Custom Access Token Hook function (run in Phase 1) |
| `prisma/rls-activation-final.sql` | **Final activation SQL — ready to run in Phase 4** |
| `prisma/schema.prisma` | Prisma schema with `organizationId` on all tenant tables |
| `RLS_FINAL_CHECKLIST.md` | This file |
| `RLS_ACTIVATION_CHECKLIST.md` | Original checklist (pre-gap-analysis reference) |
| `RLS_SECURITY.md` | Architecture overview and threat model |
| `src/lib/auth-helpers.ts` | `requirePermission()`, `getAuthUserAndRole()` |
| `src/lib/roles.ts` | Permission matrix and role definitions |

---

## Activation Progress Tracker

Mark each gate as you complete it:

- [ ] **Phase 0** — All pre-flight queries pass (RLS on 9 tables, 0 policies, Notification not yet enabled)
- [ ] **Phase 1** — `custom_access_token_hook` deployed and Dashboard hook registered
- [ ] **Phase 2** — `app_organization_id` and `app_role` confirmed in JWT payload for all test users
- [ ] **Phase 3** — Policy readiness review complete, build green
- [ ] **Phase 4** — `rls-activation-final.sql` executed, 10 policies confirmed
- [ ] **Phase 5** — All API routes smoke-tested, build passes, Prisma bypass confirmed
