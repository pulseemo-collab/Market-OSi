# Platform Owner Role

## Overview

`platform_owner` is a special SaaS-level role separate from all organization roles. A platform owner manages the Market OS platform itself — viewing cross-organization statistics, future billing, and global monitoring — without having access to any single organization's business features.

## Role Separation

| Role             | Scope        | Description                            |
|------------------|--------------|----------------------------------------|
| `platform_owner` | Platform     | Manages the SaaS platform globally     |
| `owner`          | Organization | Full business access within one org    |
| `manager`        | Organization | Business operations, no admin actions  |
| `cashier`        | Organization | POS and sales history only             |
| `employee`       | Organization | Product browsing only                  |

## Permissions

```ts
'platform:read':        ['platform_owner']
'organizations:read':   ['platform_owner']
'organizations:manage': ['platform_owner']
'billing:read':         ['platform_owner']   // placeholder
'global:audit':         ['platform_owner']   // placeholder
'global:monitoring':    ['platform_owner']   // placeholder
```

## Route Access

| Route        | Allowed            |
|--------------|--------------------|
| `/platforma` | `platform_owner`   |

All organization business routes (`/`, `/produktet`, `/shitjet`, `/historiku`, `/stok-i-ulet`, `/porositje-te-sugjeruara`, `/furnizime`, `/furnitoret`, `/perdoruesit`, `/regjistri`, `/backup`, `/njoftime`) are **not accessible** to `platform_owner`.

## Sidebar

`platform_owner` sees only:
- **Platforma** (`/platforma`)
- Logout / role label in footer

Organization business nav items are hidden entirely.

## API Protection

| Endpoint          | Guard                                      |
|-------------------|--------------------------------------------|
| `GET /api/platform` | `requirePermission('platform:read')` → `platform_owner` only |
| All business APIs | Organization-scoped, organization roles only |

## Setting platform_owner in the Database

This role is assigned manually directly in the `UserRole` table. No automatic promotion exists by design.

### Option A — Supabase Dashboard

1. Open your Supabase project → **Table Editor** → `UserRole`
2. Find the row for the user you want to promote
3. Set the `roli` column to `platform_owner`
4. Save

### Option B — SQL

```sql
UPDATE "UserRole"
SET roli = 'platform_owner'
WHERE email = 'your-platform-admin@example.com';
```

### Option C — Prisma Studio

```bash
npx prisma studio
```

Open the `UserRole` table, find the user, change `roli` to `platform_owner`, save.

## Legacy Safety

Existing `owner` users are **not affected**. They retain full business access to their organization. The `platform_owner` role is additive — it does not replace `owner`. If you previously used the `/platforma` page as an `owner`, you must:

1. Create a new Supabase auth user for the platform admin (or promote an existing one)
2. Set their `roli` to `platform_owner` using one of the methods above

An `owner` user will see **AccessDenied** on `/platforma` after this change, which is the correct behavior.

## Future Platform Pages

The following pages are planned and will require `platform_owner` role:

- `/platform/organizations` — manage all organizations
- `/platform/billing` — subscription and billing management
- `/platform/monitoring` — system health and error tracking

Add them to `ROUTE_ACCESS` in `src/lib/roles.ts` as they are built.
