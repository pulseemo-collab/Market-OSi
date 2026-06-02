-- =============================================================================
-- Supabase Custom Access Token Hook — Market-OSi
-- =============================================================================
--
-- PURPOSE:
--   Inject `app_organization_id` and `app_role` into every Supabase Auth JWT
--   so that RLS policies can use them without an extra DB lookup per query.
--
-- HOW TO USE:
--   1. Run this entire file in Supabase SQL Editor (Dashboard → SQL Editor).
--   2. Go to Dashboard → Authentication → Hooks → Custom Access Token Hook.
--   3. Set the function to: public.custom_access_token_hook
--   4. Save and test (sign out / sign in to get a new JWT).
--   5. Verify claims exist before enabling tenant-isolation policies.
--      See RLS_ACTIVATION_CHECKLIST.md → PHASE 2 for verification queries.
--
-- SAFETY:
--   - This file is NON-DESTRUCTIVE. It only creates/replaces a function and
--     adjusts GRANT/REVOKE on that function.
--   - It does NOT enable RLS, does NOT drop policies, does NOT alter tables.
--   - Re-running is safe (CREATE OR REPLACE).
--
-- DO NOT run this file automatically via Prisma migrations.
-- =============================================================================


-- =============================================================================
-- STEP 1: Create the Custom Access Token Hook function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims    jsonb;
  org_id    int;
  user_role text;
BEGIN
  -- Read the user's organization and role from UserRole.
  -- UserRole.userId is a TEXT column that matches Supabase Auth user UUIDs.
  -- We cast auth UUID to text for the comparison.
  SELECT "organizationId", "roli"
  INTO   org_id, user_role
  FROM   "UserRole"
  WHERE  "userId" = (event->>'user_id')
  LIMIT  1;

  -- Start from the existing claims block inside the event.
  claims := event->'claims';

  -- Inject app_organization_id if the user belongs to an organization.
  -- Absent claim → NULL → RLS policies evaluate to false (deny-all).
  IF org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_organization_id}', to_jsonb(org_id));
  END IF;

  -- Inject app_role if a role record exists.
  -- Possible values match UserRole.roli: 'owner', 'manager', 'cashier', 'employee'.
  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_role}', to_jsonb(user_role));
  END IF;

  -- Return the modified event with the updated claims.
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;


-- =============================================================================
-- STEP 2: Grant execute to Supabase Auth internals only
-- =============================================================================

-- Allow the Supabase Auth service to call this hook.
GRANT EXECUTE
  ON FUNCTION public.custom_access_token_hook
  TO supabase_auth_admin;

-- Deny execution to all other roles for defence-in-depth.
REVOKE EXECUTE
  ON FUNCTION public.custom_access_token_hook
  FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- STEP 3: (Informational) Register the hook in Supabase Dashboard
-- =============================================================================
-- This cannot be done via SQL. Perform this step manually:
--
--   Dashboard → Authentication → Hooks → Custom Access Token Hook
--   Function: public.custom_access_token_hook
--   Save → sign out → sign in → decode new JWT to verify claims.
--
-- Use jwt.io (paste the Supabase access token) or the verification queries
-- in RLS_ACTIVATION_CHECKLIST.md → PHASE 2.
-- =============================================================================


-- =============================================================================
-- VERIFICATION (run after completing Dashboard step above)
-- =============================================================================
-- Confirm the function exists with the correct signature:
--
-- SELECT routine_name, routine_type, security_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name   = 'custom_access_token_hook';
--
-- Expected row:
--   routine_name              | routine_type | security_type
--   custom_access_token_hook  | FUNCTION     | DEFINER
-- =============================================================================
