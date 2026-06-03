# Free Plan RLS Options — Market-OSi

> Analysis only. No code changes in this document.
> All options preserve existing Prisma-based multi-tenant isolation.

---

## 1. What the blocked hook was providing

The Custom Access Token Hook (Team/Enterprise only) did one thing: it injected
two application-specific fields into the Supabase Auth JWT before the token was
issued to the client.

```
Supabase Auth → Hook → Postgres function reads UserRole → adds to JWT:
  app_organization_id: 1
  app_role: "owner"
```

The planned RLS policies then read those fields directly from the JWT:

```sql
-- Reads the JWT claim — fast, no DB lookup
SELECT NULLIF(
  current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id', ''
)::int
```

Without the hook, `current_setting('request.jwt.claims', true)` never contains
`app_organization_id`. The claim is simply absent. All policies that use it
evaluate to `NULL = <some int>` which is `FALSE` — every row is denied.

**The existing policies in rls-policies.sql and rls-activation-final.sql
cannot be used on the Free plan. They are structurally dependent on the hook.**

---

## 2. What Supabase provides for free

These are available on all plans, including Free:

| Function | Returns | Notes |
|---|---|---|
| `auth.uid()` | UUID of the signed-in user | Always present for `authenticated` role |
| `auth.role()` | `'anon'` or `'authenticated'` | Role string from JWT |
| `auth.email()` | User's email address | Present in JWT if email auth is used |
| `auth.jwt()` | Full JWT claims as jsonb | Includes standard claims; no custom claims without hook |

`auth.uid()` is the key primitive. It returns the user's UUID — the same value
stored in `UserRole.userId`. This is enough to look up the organization.

---

## 3. Can RLS achieve tenant isolation without JWT custom claims?

**Yes.** The JWT hook was an optimisation, not a requirement.

The hook approach reads `organizationId` from the JWT (already in memory, zero
DB cost). The free-plan approach reads `organizationId` from the `UserRole`
table (one database lookup per query). The result is identical tenant isolation.

The trade-off is a single indexed database lookup per direct-client query instead
of a JWT field read. For Prisma-based queries (which bypass RLS entirely) there
is no trade-off — the overhead is zero.

---

## 4. Options

### Option A — `auth.uid()` + SECURITY DEFINER helper (Recommended)

Replace the JWT-claim helper with a function that looks up `organizationId`
from `UserRole` using `auth.uid()`:

```sql
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
```

Then every policy uses this function instead of `auth.organization_id()`:

```sql
-- Example: Product
CREATE POLICY "product_tenant_isolation" ON "Product"
  FOR ALL TO authenticated
  USING ("organizationId" = public.get_my_organization_id());

-- Example: ProductBarcode (parent-table pattern, unchanged)
CREATE POLICY "product_barcode_tenant_isolation" ON "ProductBarcode"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Product" p
      WHERE p.id = "ProductBarcode"."productId"
        AND p."organizationId" = public.get_my_organization_id()
    )
  );
```

**Why SECURITY DEFINER is required here:**

`UserRole` itself has RLS enabled. If a plain (non-definer) function queries
`UserRole` as the `authenticated` role, it hits UserRole's own RLS policy,
which also needs the org ID to evaluate — a circular dependency. `SECURITY
DEFINER` runs the function as its owner (the postgres role), which has
`BYPASSRLS`. The lookup returns the correct row. The circular dependency
is avoided entirely.

**Performance:**

`auth.uid()` is a `STABLE` function (same value for the whole query).
`UserRole.userId` is `UNIQUE` (index guaranteed). PostgreSQL evaluates a
`STABLE` function call with constant arguments once per statement, not once
per row. The net cost per direct-client query is a single O(1) primary-key
index scan on UserRole. That is comparable to any ordinary FK join.

For **Prisma queries** (service role, BYPASSRLS): zero cost. RLS is not
evaluated at all. This covers 100% of current application traffic.

**Upgrade path:**

When/if you upgrade to Team plan, swap the function body:

```sql
-- Upgrade: replace the DB lookup with the faster JWT read
CREATE OR REPLACE FUNCTION public.get_my_organization_id() RETURNS int
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(
      current_setting('request.jwt.claims', true)::jsonb ->> 'app_organization_id', ''
    )::int
  $$;
```

All ten policies are unchanged. The upgrade is a one-line function replacement.

---

### Option B — Anon-deny only (minimal)

Create only RESTRICTIVE policies for the `anon` role. Leave `authenticated`
with no policy (default deny):

```sql
CREATE POLICY "anon_deny" ON "Product"
  AS RESTRICTIVE FOR ALL TO anon USING (false);
-- (repeat for each table)
```

**What this protects:** Blocks anyone using the Supabase anon key directly
(curl, PostgREST, realtime, browser without auth) from reading or writing data.

**What this does not protect:** An authenticated user making direct PostgREST
requests (e.g., via `supabase.from('Product').select(...)`) would currently
receive zero rows because there is no matching policy for `authenticated` —
which is the safe default. But there is no positive tenant-isolation rule.
If you later add a permissive policy for authenticated users without
`organizationId` scoping, a mistake would expose cross-org data.

This is a half-measure. It is safe today (all queries go through Prisma) but
provides no tenant isolation guarantee for future direct-client code.

---

### Option C — RLS enabled, policies deferred (current state post-Phase-0)

After the Phase 0 patch is applied, all 9 tables have RLS enabled with zero
active policies. The PostgreSQL default when RLS is enabled and no policy
matches is: **deny**. This applies to both `anon` and `authenticated`.

Current state this produces:
- Prisma (service role, BYPASSRLS): all queries work normally ✓
- Direct Supabase client — anon: all queries return empty ✓
- Direct Supabase client — authenticated: all queries return empty ✓
- PostgREST (anon or authenticated): all queries return empty ✓

**This is already a valid security posture for the current architecture.**

No tenant isolation policy exists, but no direct-client queries exist either.
The risk is zero today. The risk emerges only if someone adds a direct
Supabase client data query without realising RLS will block it silently.

Choosing this option means: "We will add Option A policies when we actually
need direct-client access (realtime, edge functions)."

---

### Option D — Abandon RLS, pure Prisma security

Disable RLS on all tables. Rely entirely on:
1. `requirePermission()` in every API route
2. `organizationId` filter in every Prisma query
3. Server-side-only execution (no client-side DB access)

**Security posture of the current application:**

| Attack vector | Status without RLS |
|---|---|
| Unauthenticated user calls API | 401 from `requirePermission()` |
| Authenticated user from org A calls org B's data via API | 403 from `requirePermission()` + org filter |
| User manipulates request body to pass another org's ID | Ignored — org ID is read server-side only, never from request body |
| Direct PostgREST query with anon key | Unprotected — no RLS, no app-layer check |
| Direct PostgREST query with authenticated JWT | Unprotected — no RLS, org ID not enforced |
| Supabase Studio table browsing (admin) | Unprotected — but requires Supabase project admin access |

The only unprotected vectors are **direct database access bypassing the
Next.js API layer**. Those vectors require either:
- The Supabase service role key (which should never be in the browser)
- Supabase project admin credentials
- A future code change that introduces a direct `supabase.from()` data query

This is a reasonable security posture for an internal business application
where the Supabase service role key is never exposed to clients.

---

## 5. Decision matrix

| | Option A | Option B | Option C | Option D |
|---|---|---|---|---|
| Tenant isolation via RLS | Full | None | None (default deny) | N/A |
| Works on Free plan | Yes | Yes | Yes | Yes |
| Requires code changes | No | No | No (done) | No |
| Requires new SQL | Yes (new policies) | Yes (anon deny) | No | Maybe (disable) |
| Prisma queries affected | Never | Never | Never | Never |
| Direct client queries | Scoped to org | Blocked entirely | Blocked entirely | Unprotected |
| Future-proof for realtime | Yes | No | Partial | No |
| Upgrade path to paid | One function swap | Rebuild all policies | Add Option A policies | Rebuild from scratch |
| Complexity | Low | Very low | Zero | Zero |
| **Recommended** | **Yes** | No | Acceptable | Last resort |

---

## 6. Current security posture assessment

**The application is already secure for its current architecture.**

Every API route calls `requirePermission()` before touching the database.
Every Prisma query filters by `organizationId` that is read server-side from
`UserRole`, not from the request. There is no code path where a client can
supply their own `organizationId` and have it trusted.

RLS would add a **second, independent security layer** at the database level.
Its value is:

1. **Defence-in-depth:** A future coding mistake (a Prisma query that forgets
   the `organizationId` filter) does not expose cross-org data if RLS is active.
   But if RLS uses the service role which bypasses policies, this protection
   does not apply to Prisma queries anyway.

2. **Direct-client safety:** If realtime subscriptions, edge functions, or
   direct `supabase.from()` calls are added, RLS prevents those from leaking
   cross-org data without requiring the developer to remember to filter.

3. **External tools:** Supabase Studio browsing, third-party integrations using
   the anon or user JWT, etc.

For the current state — zero direct-client queries, all data through Prisma —
Option C (RLS on, no policies, default deny) gives the same practical protection
as Option A, with no additional SQL to write or maintain.

---

## 7. Recommendation

**Adopt Option A** (`auth.uid()` + SECURITY DEFINER helper function).

Rationale:

- Option A achieves the same tenant isolation as the original JWT hook design,
  without any paid features.
- The SECURITY DEFINER function (`public.get_my_organization_id()`) is a
  direct, clean replacement for the planned `auth.organization_id()` helper.
  It reads from the same source (UserRole) that the hook was reading from.
- Performance impact is zero for current Prisma-based traffic, and negligible
  for any future direct-client queries (one unique-index lookup per query).
- All 10 policies from `rls-activation-final.sql` need one mechanical change:
  replace `auth.organization_id()` with `public.get_my_organization_id()`.
- When the plan is upgraded, the function body is replaced in one statement.
  No policy changes needed.
- Choosing Option C today ("defer") is also valid, but it delays a task that
  grows harder as more tables and direct-client paths are added later.

**If Option A is approved, the next steps are:**

1. Apply `prisma/rls-phase0-patch.sql` to finish Phase 0.
2. Create `prisma/rls-activation-free-plan.sql` with the SECURITY DEFINER
   function and 10 updated policies.
3. Follow a simplified checklist (no JWT hook phases needed):
   - Phase 0: RLS enable patch (already identified)
   - Phase 1: Deploy `get_my_organization_id()` function
   - Phase 2: Verify function returns correct org ID for test users
   - Phase 3: Apply 10 policies
   - Phase 4: Smoke-test + build check

**Files that become obsolete if Option A is chosen:**

| File | Status |
|---|---|
| `prisma/rls-access-token-hook.sql` | Obsolete — hook requires paid plan |
| `prisma/rls-activation-final.sql` | Obsolete — uses `auth.organization_id()` (JWT claim) |
| `RLS_ACTIVATION_CHECKLIST.md` Phases 1–2 | Obsolete — JWT verification phases no longer needed |
| `RLS_FINAL_CHECKLIST.md` Phases 1–2 | Obsolete — replace with function verification |

These files should be kept as documentation of the original design intent but
should not be executed.

---

## 8. What changes between JWT hook and SECURITY DEFINER approach

| Aspect | JWT Hook (paid) | SECURITY DEFINER (free) |
|---|---|---|
| Where org ID is stored | Inside the JWT | In the UserRole table |
| How policies read it | `current_setting('request.jwt.claims', ...)` | `SELECT "organizationId" FROM "UserRole" WHERE "userId" = auth.uid()` |
| DB lookup per query | No (JWT is in memory) | Yes (one indexed lookup) |
| Circular RLS dependency on UserRole | N/A | Solved by SECURITY DEFINER |
| Policy SQL | `USING ("organizationId" = auth.organization_id())` | `USING ("organizationId" = public.get_my_organization_id())` |
| Upgrade path | N/A (already paid) | Replace function body only |
| Prisma queries affected | None | None |
| Tenant isolation strength | Identical | Identical |
