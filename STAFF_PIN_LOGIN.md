# Staff PIN Login System

Local staff accounts for cashiers and employees that authenticate with a 4–6 digit PIN — no email or Supabase Auth account required.

---

## Overview

| Auth type | Who uses it | How they log in |
|-----------|-------------|-----------------|
| Email + password (Supabase) | platform_owner, owner, manager | `/login` |
| PIN (local Staff model) | cashier staff, employee staff | `/staff-login` |

Staff sessions are stored in the database (`StaffSession` table) and expire after **8 hours**.

---

## Architecture

```
prisma/schema.prisma
  └── Staff           — local staff accounts (no Supabase user)
  └── StaffSession    — active PIN sessions (token in httpOnly cookie)
  └── Sale            — now includes optional staffId / staffName

src/lib/staff-auth.ts
  ├── hashPin / verifyPin     — scrypt-based PIN hashing
  ├── getStaffSession         — read & validate session from cookie
  ├── createStaffSession      — create DB session + return token
  ├── setStaffSessionCookie   — write httpOnly cookie on response
  ├── clearStaffSessionCookie — clear cookie on logout
  ├── setTerminalOrgCookie    — persist org ID on the POS terminal
  └── resolveStaffAuth        — dual-auth helper for API routes

src/middleware.ts
  ├── /staff-login            — always public (no Supabase required)
  ├── /shitjet, /historiku    — allow if staff_session cookie present
  └── everything else         — Supabase auth as before
```

---

## Staff Model Fields

| Field | Type | Description |
|-------|------|-------------|
| id | Int | PK |
| organizationId | Int | Org isolation |
| emri | String | Full name |
| kodi | String? | Optional short code (unique per org) |
| roli | String | `cashier` \| `employee` |
| pinHash | String | scrypt hash — never stored in plain text |
| isActive | Boolean | Deactivating invalidates all sessions |
| failedAttempts | Int | Increments on wrong PIN |
| lockedUntil | DateTime? | Set after 5 failed attempts |

---

## Security

- **PIN hashing** — Node.js `crypto.scrypt` with random 16-byte salt; `timingSafeEqual` comparison
- **Lockout** — 5 failed attempts locks the account for 15 minutes; recorded in audit log
- **Rate limiting** — `staff-auth` route: 10 req/min per IP
- **Session invalidation** — all sessions deleted on: deactivation, PIN change, manual logout
- **httpOnly cookie** — `staff_session` token is not accessible from JavaScript
- **One session per staff** — previous sessions are cleared on each new login
- **Organization isolation** — login validates `staffId + organizationId` match

---

## Setup Guide (Owner)

### 1. Add staff members

Go to **Personal PIN** (`/personal`) in the sidebar.

Click **Shto Staf**, fill in:
- Name (required)
- Short code (optional, e.g. `AK01`)
- Role: Kasijer or Punonjës
- PIN: 4–6 digits (confirmed twice)

### 2. Set up the POS terminal

On the device that staff will use:

1. Log in as owner/manager via `/login`
2. Go to `/personal`
3. Click **Hap Terminal** — this sets a `pos_terminal_org` cookie and opens `/staff-login` in a new tab
4. Bookmark `/staff-login` on that device

The terminal cookie is persistent (1 year) and only stores the organization ID (not a secret).

### 3. Staff login flow

1. Staff opens `/staff-login`
2. Selects their name from the list
3. Enters PIN on the keypad (keyboard also works)
4. System validates → sets `staff_session` cookie → redirects to `/shitjet`

Alternatively, navigate to `/staff-login?org=<organizationId>` directly.

---

## Staff Permissions

| Route | cashier staff | employee staff |
|-------|--------------|----------------|
| `/shitjet` (POS) | ✅ | ❌ |
| `/historiku` (Sales history) | ✅ (read) | ❌ |
| `/produktet` (Products) | ✅ (read only, via API) | ✅ (read only) |
| All management pages | ❌ | ❌ |
| `/platforma` | ❌ | ❌ |

---

## API Reference

### Public (no auth)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/staff-auth/list?orgId=X` | Active staff list for org |
| POST | `/api/staff-auth/login` | Validate PIN, create session |
| POST | `/api/staff-auth/logout` | Clear session |
| GET | `/api/staff-auth/session` | Current staff session data |

### Owner / Manager only

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/staff` | List all staff for org |
| POST | `/api/staff` | Create staff member |
| PATCH | `/api/staff/:id` | Update name/role/isActive/kodi |
| DELETE | `/api/staff/:id` | Deactivate staff (soft delete) |
| POST | `/api/staff/:id/pin` | Change PIN (invalidates sessions) |
| POST | `/api/staff/terminal` | Set terminal org cookie |

### Login request body

```json
{
  "staffId": 1,
  "pin": "1234",
  "organizationId": 1
}
```

---

## Audit Log Events

All events are written to `AuditLog` with `entityType = "staff"`:

| Action | Trigger |
|--------|---------|
| `staff_created` | New staff added |
| `staff_deactivated` | Staff deactivated |
| `staff_activated` | Staff re-activated |
| `staff_pin_changed` | PIN updated by manager |
| `staff_login` | Successful PIN login |
| `staff_login_failed` | Wrong PIN entered |
| `staff_locked` | Account locked after 5 failures |

Sales created via staff session record `staffId` and `staffName` on the `Sale` row and in the audit description.

---

## Database Migrations

After pulling these changes, run:

```bash
npx prisma db push
# or for a migration file:
npx prisma migrate dev --name add-staff-pin-login
```

---

## Environment Variables

No new environment variables required. The feature uses the existing `DATABASE_URL` / `DIRECT_URL` and the existing Supabase setup.
