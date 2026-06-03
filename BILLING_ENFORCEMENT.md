# Billing Enforcement

## Overview

Market-OSi enforces subscription access on all business routes. Organizations with expired or cancelled subscriptions are blocked from using the application until their subscription is renewed by a platform owner.

## Access Rules

| Plan      | Status      | Access                                      |
|-----------|-------------|---------------------------------------------|
| `internal`| any         | Always allowed                              |
| any       | `trialing`  | Allowed until `trialEndsAt`                 |
| any       | `active`    | Allowed until `currentPeriodEnd` (if set)   |
| any       | `expired`   | Blocked                                     |
| any       | `cancelled` | Blocked                                     |

`platform_owner` role is never subject to billing enforcement regardless of organization.

## Implementation

### Core Helper

`src/lib/billing-enforcement.ts` — `checkSubscriptionAccess(organizationId, role)`

Returns `{ allowed: boolean, reason?: string }`. Called synchronously in every business API route handler.

### Subscription Status Endpoint

`GET /api/subscription-status` — Used by the client-side gate. Returns `{ allowed: boolean }`.
Writes one `billing_access_blocked` audit log entry when a blocked user checks their status.

### UI Enforcement

`src/hooks/useSubscription.ts` — React hook that calls `/api/subscription-status` once on mount.
`src/components/SubscriptionExpired.tsx` — Renders the blocked page in Albanian.

Each protected page uses the hook and returns `<SubscriptionExpired />` when blocked:

```tsx
const subscription = useSubscription()
if (!role || !allowedRoles.includes(role)) return <AccessDenied />
if (subscription === 'blocked') return <SubscriptionExpired />
```

### API Enforcement

Every protected API handler calls `checkSubscriptionAccess` after auth and rate-limiting:

```typescript
const billing = await checkSubscriptionAccess(organizationId!, role!)
if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })
```

### Protected Routes

**UI pages:** `/` (dashboard), `/produktet`, `/shitjet`, `/furnitoret`, `/furnizime`, `/historiku`, `/backup`, `/njoftime`

**API routes:** `/api/dashboard`, `/api/products`, `/api/products/[id]`, `/api/sales`, `/api/sales/[id]`, `/api/suppliers`, `/api/suppliers/[id]`, `/api/supplies`, `/api/supplies/[id]`, `/api/audit-logs`, `/api/backup`, `/api/restore`, `/api/notifications`, `/api/notifications/[id]`, `/api/notifications/mark-all-read`, `/api/export`

**Not enforced (intentional):** `/platforma`, `/api/platform/*` — platform owner routes are always accessible.

## User Experience

Blocked users see:

> **Abonimi ka skaduar**
> Kontaktoni platformën për të rinovuar aksesin tuaj.

API responses return HTTP 403 with:
```json
{ "error": "Abonimi ka skaduar" }
```

## Platform Owner Override

To restore access for a blocked organization:

1. Navigate to `/platforma`
2. Find the organization
3. Click the billing icon to open the billing modal
4. Change status to `active` or `trialing` and set an appropriate end date
5. Save — access is restored immediately

All billing changes are recorded in `BillingAuditLog` with the platform owner's identity.

## Audit Logging

A `billing_access_blocked` entry is written to the organization's `AuditLog` when `/api/subscription-status` detects a blocked subscription. This happens once per page load for users of blocked organizations.
