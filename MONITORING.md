# Monitoring — Market OS

## Overview

Market OS uses [Sentry](https://sentry.io) for production error monitoring. Sentry is **optional** — the application runs normally without it configured.

## Setup

### 1. Create a Sentry project

1. Go to [sentry.io](https://sentry.io) and create an account or log in.
2. Create a new project → choose **Next.js**.
3. Copy the **DSN** from **Project → Settings → Client Keys (DSN)**.

### 2. Configure environment variables

Add the following to your `.env.local` (or production environment):

```env
# Required for error capturing
NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@oyyy.ingest.sentry.io/zzzzz
SENTRY_DSN=https://xxxxx@oyyy.ingest.sentry.io/zzzzz

# Optional — only needed for source map uploads in CI/CD
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
```

> `NEXT_PUBLIC_SENTRY_DSN` is used by the browser bundle. `SENTRY_DSN` is used server-side. Both can be the same DSN value.

### 3. Verify

Deploy or run `npm run dev` and trigger an error. It should appear in your Sentry dashboard within seconds.

---

## What is captured

### API errors

All unhandled exceptions inside `try/catch` blocks in API routes are sent to Sentry with rich context:

| Field            | Description                              |
|------------------|------------------------------------------|
| `user.id`        | Supabase user UUID                       |
| `user.email`     | User's email address                     |
| `user.role`      | Role: `owner`, `manager`, `cashier`, `employee` |
| `organization.id`| Organization the user belongs to         |
| `api.route`      | Route path e.g. `/api/products`          |
| `api.action`     | HTTP method: `GET`, `POST`, `PUT`, `DELETE` |

**Integrated API routes:**

- `/api/products` and `/api/products/[id]`
- `/api/sales` and `/api/sales/[id]`
- `/api/suppliers` and `/api/suppliers/[id]`
- `/api/supplies` and `/api/supplies/[id]`
- `/api/dashboard`

### Client / React errors

- **`ErrorBoundary`** (`src/components/ErrorBoundary.tsx`) — wraps the entire app in `layout.tsx`. Catches React render errors and reports them with the component stack.
- **`src/app/error.tsx`** — Next.js App Router error boundary for route segments.
- **`src/app/global-error.tsx`** — Catches errors thrown inside the root layout itself.

### Session replays

When `NEXT_PUBLIC_SENTRY_DSN` is set, Sentry Session Replay is enabled:

- **5%** of normal sessions are recorded.
- **100%** of sessions that contain an error are recorded.

---

## Helper: `captureApiError`

```typescript
import { captureApiError } from '@/lib/sentry'

// In an API route catch block:
captureApiError(error, {
  userId,
  userEmail,
  role,
  organizationId,
  route: '/api/my-route',
  action: 'POST',
})
```

If Sentry is not configured (`SENTRY_DSN` is empty), this function is a no-op.

### `setUserContext`

Call this server-side to attach user identity to all subsequent Sentry events in the same request:

```typescript
import { setUserContext } from '@/lib/sentry'

setUserContext({ userId, userEmail, role, organizationId })
```

---

## Data privacy

- Passwords, tokens, and database URLs are **never** sent to Sentry.
- The `beforeSend` hook in `sentry.client.config.ts` strips any `password=` query params from request URLs.
- User emails are captured as standard Sentry user context to aid debugging — consistent with Sentry's intended use.
- Source maps are hidden from the client bundle (`hideSourceMaps: true`) to prevent source code exposure.

---

## Build without Sentry credentials

`npm run build` passes with or without Sentry environment variables. The `withSentryConfig` wrapper uses `silent: true` so no warnings are printed when credentials are absent.

---

## Configuration files

| File | Purpose |
|------|---------|
| `sentry.client.config.ts` | Browser-side Sentry init (session replay, client errors) |
| `sentry.server.config.ts` | Node.js server-side init |
| `sentry.edge.config.ts` | Edge runtime init (middleware) |
| `src/instrumentation.ts` | Next.js hook that loads server/edge configs at startup |
| `src/lib/sentry.ts` | Centralized `captureApiError` and `setUserContext` helpers |
| `src/components/ErrorBoundary.tsx` | Reusable React error boundary component |
| `src/app/error.tsx` | Next.js route-segment error page |
| `src/app/global-error.tsx` | Next.js root error page |
