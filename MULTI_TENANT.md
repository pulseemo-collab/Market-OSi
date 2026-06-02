# Multi-Tenant Architecture

Market-OSi supports multiple independent businesses (organizations) in a single deployment. Each organization's data is fully isolated at the database level.

## Data Model

### Organization

The root tenant entity. Every data record belongs to exactly one organization.

```
Organization
  id        Int      (PK)
  name      String
  createdAt DateTime
  updatedAt DateTime
```

### organizationId on all business entities

The following models carry `organizationId` (foreign key → Organization):

| Model      | Effect                                      |
|------------|---------------------------------------------|
| `Product`  | Products visible only within org            |
| `Sale`     | Sales isolated per org                      |
| `Supplier` | Suppliers scoped to org                     |
| `Supply`   | Supplies scoped to org                      |
| `UserRole` | Users belong to exactly one org             |

## How it works

### Authentication & org resolution

Every API request goes through `requirePermission()` in `src/lib/auth-helpers.ts`. This function:

1. Verifies the Supabase session.
2. Looks up the `UserRole` record for the authenticated user.
3. Returns `{ userId, role, organizationId }`.

The `organizationId` is always derived server-side from the authenticated user's `UserRole`. It is **never trusted from the client**.

### getCurrentOrganization()

A standalone helper for routes that only need the org without a permission check:

```typescript
import { getCurrentOrganization } from '@/lib/auth-helpers'

const { organizationId, error } = await getCurrentOrganization()
if (error) return error
```

### API route pattern

Every route that reads or writes data follows this pattern:

```typescript
// GET — filter by org
const { organizationId, error } = await requirePermission('products:read')
if (error) return error

const products = await prisma.product.findMany({
  where: { organizationId: organizationId! },
})

// POST — set org on create
const product = await prisma.product.create({
  data: { ...fields, organizationId: organizationId! },
})

// PUT/DELETE — verify ownership before mutating
const existing = await prisma.product.findFirst({
  where: { id, organizationId: organizationId! },
})
if (!existing) return NextResponse.json({ error: '...' }, { status: 404 })
```

### New user provisioning

When a user signs in for the first time (`src/app/layout.tsx`), the system:

1. Looks for the first organization (lowest `id`).
2. Creates one named `"Default Market"` if none exists.
3. Creates a `UserRole` for the user linked to that organization.

The first user ever registered becomes `owner`; all subsequent new users start as `employee`.

## Database migration

The migration file is at:

```
prisma/migrations/20260602000001_add_multi_tenant/migration.sql
```

It safely migrates existing data without data loss:

1. Creates the `Organization` table.
2. Inserts a default organization named **"Default Market"** (id = 1).
3. Adds `organizationId` columns to all affected tables using `DEFAULT 1` so existing rows are automatically assigned to the default org.
4. Drops the column defaults (future inserts must explicitly set `organizationId`).
5. Adds foreign key constraints.

### Running the migration

```bash
# Apply migration to the database
npx prisma migrate deploy

# Or for development
npx prisma migrate dev
```

After applying the migration, regenerate the Prisma client:

```bash
npm run db:generate
```

The `npm run build` script runs `prisma generate` automatically before compiling.

## Security guarantees

- **Server-side enforcement only.** `organizationId` is never read from request bodies or query params. It always comes from the server-side session.
- **Cross-org access prevention.** All `findFirst`/`findMany`/`deleteMany`/`updateMany` include `organizationId` in the `where` clause. A user from org A cannot read or mutate data from org B even if they know the record ID.
- **Ownership verification before mutation.** PUT and DELETE routes first fetch the record with the org filter before proceeding, returning 404 (not 403) if the record doesn't belong to the caller's org — this avoids leaking the existence of cross-org resources.

## RBAC compatibility

The existing 4-role system (`owner`, `manager`, `cashier`, `employee`) is unchanged. Roles are scoped per organization: a user who is `owner` in org A has no special access in org B.

## Adding a new organization

Currently done directly via the database or a future admin UI:

```sql
INSERT INTO "Organization" ("name", "updatedAt") VALUES ('New Market', NOW());
```

Then assign users to it by updating their `UserRole.organizationId`.
