# Organization User Invites

Platform owners can create users for each organization directly from the `/platforma` dashboard without using the Supabase console.

---

## How It Works

### Invite Flow

1. Platform owner opens `/platforma`
2. In the organization table, click the **green user-plus icon** (Shto përdorues) or the eye icon for any org
3. The users modal opens with an **"Shto Përdorues të Ri"** form at the top
4. Enter the user's email and select their role (Pronar / Menaxher / Kasijer / Punonjës)
5. Click **Shto** — the API does the rest

### What the API Does (`POST /api/platform/organizations/[orgId]/users`)

1. Validates the email and role
2. Checks for duplicate assignment (same email in org, or email already in another org)
3. Calls Supabase Admin API to provision the user:
   - **Primary**: `inviteUserByEmail` — creates the Supabase auth user and sends an email invitation with a magic link for the user to set their password
   - **Fallback A**: If the user already has a Supabase account, finds their existing UUID and assigns them
   - **Fallback B**: If the invite fails for another reason, `createUser` with a random temporary password and `email_confirm: true` is used (no email sent — see manual steps below)
4. Creates a `UserRole` DB row: `{ userId, email, roli, organizationId }`

### Required Environment Variable

```env
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=https://your-app.com
```

Get the service role key from **Supabase Dashboard → Project Settings → API → `service_role` (secret)**.

> **Security**: The service role key has full DB bypass powers. It is never exposed to the browser — it is only used in Next.js API routes (server-side).

---

## Manual Fallback

If `SUPABASE_SERVICE_ROLE_KEY` is not configured or the Supabase Admin API is unavailable, the API returns HTTP 501 with instructions. To create users manually:

### Step 1 — Create user in Supabase Auth

Go to **Supabase Dashboard → Authentication → Users → Invite user** and enter the user's email.

Or use the Supabase CLI:

```bash
supabase auth invite --email user@example.com
```

This sends the user an email to set their password.

### Step 2 — Get the user's UUID

In **Authentication → Users**, find the new user and copy their UUID (the `id` column).

### Step 3 — Insert UserRole in the database

Run this SQL in **Supabase Dashboard → SQL Editor**:

```sql
INSERT INTO "UserRole" ("userId", "email", "roli", "organizationId", "createdAt", "updatedAt")
VALUES (
  'paste-supabase-uuid-here',
  'user@example.com',
  'employee',          -- or: owner, manager, cashier
  1,                   -- replace with the correct organizationId
  NOW(),
  NOW()
);
```

> **Note**: The `roli` column accepts: `owner`, `manager`, `cashier`, `employee`.

---

## User Login & Organization Routing

- After the user logs in for the first time, they are automatically matched to their organization via the `UserRole` table
- The `platform_owner` is always redirected to `/platforma` — they cannot see the org dashboard
- Regular users (owner/manager/cashier/employee) are scoped to their single organization; they never see other organizations or platform-level pages
- Organization isolation is enforced at the API level via `organizationId` from the authenticated user's `UserRole`

---

## Roles Reference

| Role | Albanian | Access |
|------|----------|--------|
| `owner` | Pronar | Full org access (products, sales, users, audit, backup) |
| `manager` | Menaxher | Products, sales, suppliers, notifications |
| `cashier` | Kasijer | Sales (POS), history, notifications |
| `employee` | Punonjës | Products read-only |
| `platform_owner` | Pronar Platforme | Platform dashboard only, no org data |

---

## Constraints

- Each Supabase user (`userId`) can only belong to **one organization** (`UserRole.userId` is `@unique`)
- Each email can only be assigned to one organization at a time
- Only `platform_owner` can call `POST /api/platform/organizations/[orgId]/users`
- The endpoint is protected by `organizations:manage` permission and the `platform` rate limiter (30 req/min)
