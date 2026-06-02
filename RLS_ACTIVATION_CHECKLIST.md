# RLS Activation Checklist — Market-OSi

> **STATUS: NOT YET ACTIVATED**
> Work through this checklist in order. Do not skip phases.
> RLS tenant-isolation policies must not be enabled until Phase 2 is complete.

---

## Critical Warnings

> **WARNING 1 — Do not enable tenant policies before JWT claims are confirmed.**
> The `authenticated`-role policies in `prisma/rls-policies.sql` depend on
> `app_organization_id` being present in every JWT. If you enable those policies
> before the Custom Access Token Hook is live and tested, every Supabase client
> query will return zero rows — a silent data blackout.

> **WARNING 2 — Prisma (server-side) must never use the Supabase client for data queries.**
> All Next.js API routes connect through `DATABASE_URL` as the `postgres` /
> service role. That role has `BYPASSRLS` and is unaffected by RLS policies.
> Do not swap Prisma calls for `supabase.from(...)` queries in API routes without
> a full security review — those would fall under RLS and may silently filter or
> block data.

> **WARNING 3 — Supabase client reads must be tested separately.**
> If you add realtime subscriptions, edge functions, or any direct
> `@supabase/supabase-js` queries, test them in a staging environment with
> real JWT claims before deploying. They are subject to RLS; Prisma queries
> are not.

> **WARNING 4 — `npm run build` must pass before and after each phase.**
> Enabling or disabling RLS policies is a database-only change and does not
> affect the Prisma-generated TypeScript types. The build must remain green
> throughout. Run `npm run build` to confirm after each phase.

---

## Architecture recap

```
Browser → Next.js API Route → requirePermission() → Prisma → postgres (BYPASSRLS) → DB
                                     ↑
                           organizationId filtering here — RLS not involved

Browser → Supabase JS Client (realtime, direct) → authenticated role → RLS policies apply
```

| Layer | Enforced by | Status |
|---|---|---|
| Application (API routes) | `requirePermission()` + `organizationId` in every Prisma query | **Active** |
| Database (Supabase direct / realtime) | RLS policies (this checklist) | **Inactive — policies commented out** |

---

## Phase 0 — Pre-flight checks

These are read-only. Run them in Supabase SQL Editor to baseline the current state.

### 0-A — Confirm which tables have RLS enabled

```sql
SELECT
  tablename,
  rowsecurity   AS rls_enabled,
  forcerowsecurity AS rls_forced
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Expected (current state — RLS enabled but no active tenant policies):

| tablename | rls_enabled | rls_forced |
|---|---|---|
| AuditLog | false | false |
| Organization | true | false |
| Product | true | false |
| ProductBarcode | true | false |
| Sale | true | false |
| SaleItem | true | false |
| Supplier | true | false |
| Supply | true | false |
| SupplyItem | true | false |
| UserRole | true | false |

> Note: `AuditLog` does not have RLS enabled. It is admin/server-only data
> accessed exclusively via Prisma. No tenant-isolation policy is needed today.

### 0-B — Confirm no active policies exist yet

```sql
SELECT
  tablename,
  policyname,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Expected: **0 rows** (all policies in `prisma/rls-policies.sql` are commented out).

### 0-C — Confirm all tenant tables have an `organizationId` column

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

Expected tables: `Organization` (as `id`), `Product`, `Sale`, `Supplier`, `Supply`, `UserRole`, `AuditLog`.

> Tables without a direct `organizationId` (`ProductBarcode`, `SaleItem`, `SupplyItem`)
> use EXISTS subqueries through their parent table — this is handled in the policies.

### 0-D — Confirm the Prisma service role bypasses RLS

```sql
-- Run inside a Supabase SQL Editor session (uses the postgres role by default).
SELECT current_user, current_setting('role');
```

Expected: `postgres` (or a role with `BYPASSRLS`). Prisma uses the same role via `DATABASE_URL`.

### 0-E — Baseline build check

Run locally before making any changes:

```bash
npm run build
```

Must pass with zero errors.

---

## Phase 1 — Custom Access Token Hook

**Goal:** Inject `app_organization_id` and `app_role` into every Supabase Auth JWT.

> **Do not enable tenant-isolation policies until Phase 2 verifies the claims.**

### 1-A — Create the hook function

Copy the entire contents of `prisma/rls-access-token-hook.sql` and run it in
**Supabase Dashboard → SQL Editor**.

The file creates:

```sql
-- (from prisma/rls-access-token-hook.sql)
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

### 1-B — Confirm the function was created

```sql
SELECT
  routine_name,
  routine_type,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name   = 'custom_access_token_hook';
```

Expected:

| routine_name | routine_type | security_type |
|---|---|---|
| custom_access_token_hook | FUNCTION | DEFINER |

### 1-C — Register the hook in Supabase Dashboard

> This step cannot be done via SQL.

1. Go to **Supabase Dashboard → Authentication → Hooks**.
2. Enable **Custom Access Token Hook**.
3. Set function to: `public.custom_access_token_hook`
4. Click **Save**.

### 1-D — Confirm grant is correct

```sql
SELECT
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name   = 'custom_access_token_hook'
ORDER BY grantee;
```

Expected grantee with EXECUTE: `supabase_auth_admin` only.

---

## Phase 2 — JWT Claim Verification

**Goal:** Confirm the hook is injecting claims before any policy touches them.

> **Do not proceed to Phase 3 until all checks in this phase pass.**

### 2-A — Get a fresh JWT

Sign out and sign back in to the Market-OSi app to force a new token issuance.
The hook only fires for newly issued tokens — existing sessions will not have
the new claims until they refresh.

### 2-B — Decode and inspect the JWT

Paste the Supabase `access_token` (from browser DevTools → Application →
Local Storage → `sb-*-auth-token` → `access_token`) into **jwt.io**.

Look for these keys in the payload:

```json
{
  "app_organization_id": 1,
  "app_role": "owner"
}
```

Both keys must be present. If either is missing, stop here and debug Phase 1.

### 2-C — Confirm the claim is readable from SQL

This query simulates what RLS policies will do. Run it in Supabase SQL Editor
**while authenticated as a real user** (use the Supabase client or a service
that forwards the user JWT):

```sql
-- Verify current_setting reads the JWT claims correctly.
-- This will only return a value when called inside a request context
-- that has a JWT (e.g., via PostgREST / Supabase client, not SQL Editor).
SELECT
  current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id' AS org_id_claim,
  current_setting('request.jwt.claims', true)::jsonb ->> 'app_role'            AS role_claim;
```

Expected (example for an owner in org 1):

| org_id_claim | role_claim |
|---|---|
| 1 | owner |

> If run directly in SQL Editor (postgres role), both columns return NULL —
> that is expected because SQL Editor does not have a JWT context. The query
> is meaningful only in a PostgREST / Supabase client request context.

### 2-D — Confirm user organizationId in the database

For each test user, verify the `UserRole` row is correct:

```sql
SELECT
  ur."userId",
  ur."email",
  ur."roli",
  ur."organizationId",
  o."name" AS organization_name
FROM "UserRole" ur
JOIN "Organization" o ON o.id = ur."organizationId"
ORDER BY ur."organizationId", ur."email";
```

Cross-check: every `organizationId` returned here should match the
`app_organization_id` claim in that user's JWT.

### 2-E — Confirm all organizations exist

```sql
SELECT id, name, "createdAt"
FROM "Organization"
ORDER BY id;
```

---

## Phase 3 — Policy Readiness Review

Run these queries to confirm the database is ready for policies to be applied.

### 3-A — Re-confirm RLS enabled on all target tables

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

All nine rows must have `rowsecurity = true`. If any is `false`, run:

```sql
-- Only if a specific table is missing RLS — check 0-A first.
ALTER TABLE "<TableName>" ENABLE ROW LEVEL SECURITY;
```

### 3-B — Confirm no conflicting policies exist

```sql
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Should still return 0 rows at this point. If any policy exists that you
did not create intentionally, investigate before proceeding.

### 3-C — Confirm auth.organization_id() helper does not exist yet

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'auth'
  AND routine_name   = 'organization_id';
```

Expected: 0 rows. The helper will be created in Phase 4.

---

## Phase 4 — Policy Activation

> **Gate:** Phase 2 must be fully complete before starting this phase.
> **Gate:** `npm run build` must pass before starting this phase.

### 4-A — Create the JWT helper function

Run in Supabase SQL Editor:

```sql
CREATE OR REPLACE FUNCTION auth.organization_id() RETURNS int
  LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id'),
    ''
  )::int
$$;
```

This function returns `NULL` if the claim is absent, which causes all
policies to deny the row. It is the safe default.

Verify:

```sql
SELECT routine_name, routine_schema
FROM information_schema.routines
WHERE routine_schema = 'auth'
  AND routine_name   = 'organization_id';
```

### 4-B — Uncomment and run the tenant-isolation policies

Open `prisma/rls-policies.sql`. In **STEP 4**, uncomment:

1. The `CREATE OR REPLACE FUNCTION auth.organization_id()` block.
2. All nine `CREATE POLICY` statements.

Then run the entire uncommented STEP 4 block in Supabase SQL Editor.

> Do not run the ALTER TABLE statements again — RLS is already enabled (Phase 3-A).

### 4-C — Verify policies were created

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

Expected: 9 rows — one policy per table listed in `prisma/rls-policies.sql`.

---

## Phase 5 — Post-activation Verification

### 5-A — Build check

```bash
npm run build
```

Must pass. Policies are database-only; Prisma types are unaffected.

### 5-B — Smoke-test Prisma routes

Test several API routes (products, sales, suppliers) in the running app.
All should return data as before — Prisma bypasses RLS.

### 5-C — Test with a Supabase client (if applicable)

If you have any direct `@supabase/supabase-js` queries:

1. Sign in as a user in org A.
2. Query a table directly via the Supabase client.
3. Confirm only org A rows are returned.
4. Sign in as a user in org B and repeat — confirm org A rows are invisible.

### 5-D — Final policy list

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

Confirm all 9 policies are present with `roles = authenticated` and correct `cmd`.

---

## Phase 6 — Rollback

> Use only if a critical issue is found after Phase 4.
> These statements are safe and non-destructive to data.

### 6-A — Drop all tenant-isolation policies

Run in Supabase SQL Editor:

```sql
-- Drop policies one by one to avoid partial state.
DROP POLICY IF EXISTS "org_tenant_isolation"           ON "Organization";
DROP POLICY IF EXISTS "product_tenant_isolation"       ON "Product";
DROP POLICY IF EXISTS "product_barcode_tenant_isolation" ON "ProductBarcode";
DROP POLICY IF EXISTS "supplier_tenant_isolation"      ON "Supplier";
DROP POLICY IF EXISTS "supply_tenant_isolation"        ON "Supply";
DROP POLICY IF EXISTS "supply_item_tenant_isolation"   ON "SupplyItem";
DROP POLICY IF EXISTS "sale_tenant_isolation"          ON "Sale";
DROP POLICY IF EXISTS "sale_item_tenant_isolation"     ON "SaleItem";
DROP POLICY IF EXISTS "user_role_tenant_isolation"     ON "UserRole";
```

Verify:

```sql
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
-- Expected: 0
```

### 6-B — Drop the JWT helper function (optional)

Only if you want a complete rollback of Phase 4:

```sql
DROP FUNCTION IF EXISTS auth.organization_id();
```

### 6-C — Disable RLS on all tables (full rollback only)

> Only run this if you want to revert all the way to the pre-checklist state.
> Disabling RLS does not delete data. It is safe.

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
```

### 6-D — Remove the Custom Access Token Hook

1. Go to **Supabase Dashboard → Authentication → Hooks**.
2. Disable the **Custom Access Token Hook**.
3. Optionally drop the function:

```sql
DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);
```

### 6-E — Post-rollback verification

```sql
-- Confirm RLS is off for all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- rowsecurity should be false for all rows

-- Confirm no policies remain
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
-- Expected: 0
```

Then run `npm run build` — must still pass.

---

## File Reference

| File | Purpose |
|---|---|
| `prisma/rls-policies.sql` | ALTER TABLE + commented-out CREATE POLICY statements |
| `prisma/rls-access-token-hook.sql` | Custom Access Token Hook function (run in SQL Editor) |
| `RLS_SECURITY.md` | Architecture overview, threat model, activation guide |
| `RLS_ACTIVATION_CHECKLIST.md` | This file — step-by-step activation with verification SQL |
| `prisma/schema.prisma` | Prisma schema with `organizationId` on all tenant tables |
| `src/lib/auth-helpers.ts` | Server-side auth: `requirePermission`, `getAuthUserAndRole` |
