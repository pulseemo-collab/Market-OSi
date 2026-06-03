# Billing & Subscription — Manual Foundation

Market-OSi tracks subscriptions per organization without any payment provider integration.
All billing changes are manual, performed by the platform owner.

---

## Data Models

### Subscription

One subscription per organization (1-to-1).

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | Int | auto | Primary key |
| `organizationId` | Int (unique) | — | FK → Organization |
| `plan` | String | `"trial"` | See plans below |
| `status` | String | `"trialing"` | See statuses below |
| `trialEndsAt` | DateTime? | — | When the trial expires |
| `currentPeriodStart` | DateTime? | — | Start of active billing period |
| `currentPeriodEnd` | DateTime? | — | End of active billing period |
| `notes` | String? | — | Free-form notes from platform owner |
| `createdAt` | DateTime | now | |
| `updatedAt` | DateTime | auto | |

### BillingAuditLog

Immutable log of plan/status changes. Written on every PUT to `/api/platform/subscriptions/[orgId]`
that changes `plan` or `status`.

| Field | Type | Notes |
|---|---|---|
| `id` | Int | Primary key |
| `organizationId` | Int | Which org was changed |
| `changedByUserId` | String | Supabase user ID of actor |
| `changedByEmail` | String | Email of actor |
| `oldPlan` | String? | Previous plan (null if plan unchanged) |
| `newPlan` | String? | New plan (null if plan unchanged) |
| `oldStatus` | String? | Previous status (null if status unchanged) |
| `newStatus` | String? | New status (null if status unchanged) |
| `notes` | String? | Notes submitted with the change |
| `createdAt` | DateTime | Timestamp of change |

---

## Plans

| Key | Label | When to use |
|---|---|---|
| `trial` | Provë | Default for all new organizations |
| `basic` | Basic | Standard paid tier |
| `pro` | Pro | Advanced paid tier |
| `internal` | Internal | Internal/test organizations |

## Statuses

| Key | Label | Meaning |
|---|---|---|
| `trialing` | Provë | Organization is within a trial window |
| `active` | Aktiv | Subscription is active and paid |
| `expired` | Skaduar | Trial or period has ended |
| `cancelled` | Anuluar | Manually cancelled |

---

## Default for New Organizations

Every new organization — whether created by the platform owner via `/platforma` or auto-provisioned
on first user signup — gets a subscription with:

- `plan = "trial"`
- `status = "trialing"`
- `trialEndsAt = now + 14 days`

---

## API Endpoints

All endpoints require `platform_owner` role.

### GET `/api/platform/subscriptions`
Returns all subscriptions with their organization info.

### GET `/api/platform/subscriptions/[orgId]`
Returns the subscription and the last 30 audit log entries for the given organization.

**Response:**
```json
{
  "subscription": { "id": 1, "plan": "trial", "status": "trialing", ... },
  "auditLogs": [ { "changedByEmail": "...", "oldPlan": null, "newPlan": "pro", ... } ]
}
```

### PUT `/api/platform/subscriptions/[orgId]`
Updates plan, status, dates, and/or notes. Writes a `BillingAuditLog` row when `plan` or `status` changes.

**Request body** (all fields optional):
```json
{
  "plan": "basic",
  "status": "active",
  "trialEndsAt": "2026-07-01",
  "currentPeriodStart": "2026-06-01",
  "currentPeriodEnd": "2026-07-01",
  "notes": "Migrated from trial manually"
}
```

---

## Platform UI (`/platforma`)

The platform owner dashboard includes:

1. **Subscription summary bar** — counts per status (Provë / Aktiv / Skaduar / Anuluar).
2. **Organization table** — each row shows the plan and status badges inline.
3. **Billing modal** — opened via the coin icon (🪙) on each org row:
   - View current plan, status, and trial/period dates.
   - Edit plan, status, trial end date, period start/end, and notes.
   - Save → writes changes + audit log entry.
   - Audit history section shows the last 30 changes.

---

## Access Control

| Permission | Role | Endpoints |
|---|---|---|
| `billing:read` | `platform_owner` | GET `/api/platform/subscriptions`, GET `/api/platform/subscriptions/[orgId]` |
| `billing:manage` | `platform_owner` | PUT `/api/platform/subscriptions/[orgId]` |

---

## Not Yet Implemented

- Stripe or any payment provider integration.
- Automatic blocking/enforcement when `status = "expired"`.
- Email notifications when trial is about to expire.
- Webhook handling for payment events.

These are intentionally out of scope for this foundation layer.

---

## Migration Notes

Migration `20260603000001_billing_foundation` handles the transition from the previous schema:

- Plans renamed: `free → trial`, `starter → basic`, `enterprise → internal`
- Statuses renamed: `trial → trialing`, `canceled/past_due → cancelled`
- Removed: `trialStartsAt`, `canceledAt` columns from `Subscription`
- `BillingAuditLog` redesigned with explicit `oldPlan/newPlan/oldStatus/newStatus` fields
  instead of JSON `previousState/newState` blobs
