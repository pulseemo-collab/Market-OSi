# Rate Limiting — Market OS

## Overview

All API routes are protected by a centralized rate limiter (`src/lib/rate-limit.ts`). It uses a fixed-window counter (1-minute window) backed by an in-memory Map on the Node.js server process.

## Limits by Route Type

| Route Type | Requests / Minute | Routes |
|---|---|---|
| `auth` | 10 | `/api/users`, `/api/users/[id]` |
| `exports` | 10 | `/api/export` |
| `audit-logs` | 30 | `/api/audit-logs` |
| `dashboard` | 60 | `/api/dashboard`, `/api/reorder-suggestions` |
| `products` | 100 | `/api/products`, `/api/products/[id]` |
| `suppliers` | 100 | `/api/suppliers`, `/api/suppliers/[id]` |
| `supplies` | 100 | `/api/supplies`, `/api/supplies/[id]` |
| `sales` | 120 | `/api/sales`, `/api/sales/[id]` |

## User Identification

Requests are bucketed by (in priority order):

1. **Authenticated user ID** — resolved from Supabase session via `requirePermission()`. This is the primary key for rate limiting since all routes require authentication.
2. **IP address** — fallback via `X-Forwarded-For` or `X-Real-IP` headers when no user ID is available (e.g., pre-auth scenarios).

The rate limit key also includes the **organization ID**, ensuring tenant A's request volume never impacts tenant B's quota.

Key format: `{routeType}:uid:{userId}:org:{organizationId}`

## Response on Limit Exceeded

**Status:** `429 Too Many Requests`

**Body:**
```json
{ "error": "Shumë kërkesa. Ju lutem provoni përsëri pas pak." }
```

**Headers included on 429 responses:**

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed per minute |
| `X-RateLimit-Remaining` | Remaining requests in the current window (0 when exceeded) |
| `Retry-After` | Seconds until the window resets |

## Logging

When a limit is exceeded, a warning is written to the server log:

```
[RateLimit] Exceeded — route=products org=1 identifier=uid:abc123 count=101/100
```

## Sentry Integration

If `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN` is set, exceeded-limit events are sent to Sentry as `warning`-level messages with the following context:

- Tag `rate_limit.route` — the route type (e.g., `products`)
- Tag `rate_limit.identifier` — the user/IP identifier
- Tag `organization.id` — the organization ID
- Context `rate_limit` — `{ routeType, identifier, organizationId, count, limit }`

## Implementation Details

- **Algorithm:** Fixed-window counter. Counts are reset at the start of each 60-second window per key.
- **Storage:** In-memory `Map`. Fast, no external dependency. Counts do not survive server restarts.
- **Cleanup:** Expired entries are pruned every 200 operations to prevent unbounded memory growth.
- **Multi-tenant isolation:** The `organizationId` is part of the rate limit key so cross-tenant interference is impossible.
- **Placement:** Rate limiting runs immediately after `requirePermission()` succeeds, before any business logic or database queries.

## Applying to New Routes

```typescript
import { NextRequest } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { requirePermission } from '@/lib/auth-helpers'

export async function GET(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('resource:action')
  if (error) return error

  const rl = rateLimit(req, 'products', userId, organizationId)
  if (rl.limited) return rl.response!

  // ... handler logic
}
```

Choose the `RouteType` that best matches the sensitivity and frequency of the route. If in doubt, use `'products'` (100/min) as a safe default for general CRUD endpoints.
