# Row Level Security — Market-OSi

## Overview

This document describes the database-level security strategy for Market-OSi's
multi-tenant architecture on Supabase.

---

## Security layers

The app uses two complementary layers of data isolation:

| Layer | Where | Enforced by | Status |
|---|---|---|---|
| Application-level | API routes (Next.js) | `requirePermission()` + `organizationId` filter on every Prisma query | **Active** |
| Database-level | PostgreSQL (Supabase) | Row Level Security policies | **Partially active** (see below) |

---

## Current state

### What is active

- RLS is **enabled** on all nine tables (see `prisma/rls-policies.sql`).
- The PostgreSQL service role — used by Prisma via `DATABASE_URL` — **bypasses RLS**
  by design. This is standard Supabase behaviour and means Prisma queries are
  unaffected.
- All Prisma queries already scope data by `organizationId` at the application
  layer, enforced by `requirePermission()` in `src/lib/auth-helpers.ts`.

### What is not yet active

The tenant-isolation policies for the `authenticated` role (Supabase Auth users)
are written in `prisma/rls-policies.sql` but commented out. They require a
**Custom JWT Claim** to be implemented first (see below).

---

## How Prisma bypasses RLS

Prisma connects using `DATABASE_URL`, which resolves to the Supabase
`postgres` role (or a role granted `BYPASSRLS`). The Supabase service role
has `BYPASSRLS` set, so RLS policies are invisible to all Prisma queries.

```
Browser → Next.js API Route → requirePermission() → Prisma → postgres role → DB
                                    ↑
                          (organizationId filtering here)
```

RLS would apply if:
- The Supabase JS client (`@supabase/supabase-js`) were used directly for data
  queries (e.g., realtime subscriptions, edge functions, client-side queries).
- An external tool connects with the `authenticated` role (e.g., Supabase Studio
  row browsing, PostgREST direct calls).

---

## Tables covered

| Table | Has `organizationId` | RLS strategy |
|---|---|---|
| `Organization` | — (it IS the tenant) | Direct `id` match |
| `Product` | Yes | Direct column check |
| `ProductBarcode` | No | EXISTS via parent `Product` |
| `Supplier` | Yes | Direct column check |
| `Supply` | Yes | Direct column check |
| `SupplyItem` | No | EXISTS via parent `Supply` |
| `Sale` | Yes | Direct column check |
| `SaleItem` | No | EXISTS via parent `Sale` |
| `UserRole` | Yes | Direct column check |

---

## Activating tenant-isolation policies (future work)

### Step 1 — Create a helper function

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

This reads the custom claim `app_organization_id` from the Supabase Auth JWT.
If the claim is absent, it returns NULL, causing all policies to deny the row.

### Step 2 — Create a Supabase Auth Custom Access Token Hook

In Supabase Dashboard → Authentication → Hooks → Custom Access Token:

Create a Postgres function:

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  claims jsonb;
  org_id int;
BEGIN
  -- Look up the user's organization
  SELECT "organizationId" INTO org_id
  FROM "UserRole"
  WHERE "userId" = (event->>'user_id')
  LIMIT 1;

  claims := event->'claims';

  IF org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_organization_id}', to_jsonb(org_id));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Grant execute to supabase_auth_admin
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC, anon, authenticated;
```

Register this function in Supabase Dashboard → Authentication → Hooks.

### Step 3 — Uncomment policies

Open `prisma/rls-policies.sql` and uncomment:
1. The `auth.organization_id()` function
2. All `CREATE POLICY` statements in Step 4

Run the uncommented SQL in the Supabase SQL Editor.

### Step 4 — Verify

```sql
-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- List active policies
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
```

---

## What does NOT change when you activate policies

- Prisma queries continue to work exactly as before (service role bypasses RLS).
- `requirePermission()` and `organizationId` filtering in API routes remain the
  primary enforcement mechanism.
- No frontend code changes are needed.
- `npm run build` is unaffected (Prisma generates types from the schema, not
  from policies).

---

## Risk matrix

| Threat | Application layer | Database layer (RLS) |
|---|---|---|
| Authenticated user calls Prisma API route without permission | Blocked by `requirePermission()` | N/A (Prisma bypasses RLS) |
| Authenticated user guesses another org's `organizationId` in API body | Blocked — `organizationId` always read from server-side `UserRole`, never from client | N/A |
| Someone uses Supabase anon key directly to query PostgREST | Not applicable (anon key not exposed in frontend) | Blocked by RLS (no matching policy = deny) |
| Authenticated Supabase user queries PostgREST directly | Not fully covered today | **Blocked once policies are activated** |
| Supabase Studio user browsing rows | Not applicable | Blocked by RLS after activation |

---

## File reference

| File | Purpose |
|---|---|
| `prisma/rls-policies.sql` | SQL to enable RLS and define tenant-isolation policies |
| `prisma/schema.prisma` | Prisma schema with `organizationId` on all tenant tables |
| `src/lib/auth-helpers.ts` | Server-side auth helpers: `requirePermission`, `getCurrentOrganization` |
| `MULTI_TENANT.md` | Multi-tenant architecture overview |
| `RLS_SECURITY.md` | This file |
