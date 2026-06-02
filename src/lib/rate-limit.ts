import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

export type RouteType =
  | 'auth'
  | 'sales'
  | 'products'
  | 'suppliers'
  | 'supplies'
  | 'dashboard'
  | 'audit-logs'
  | 'exports'
  | 'backups'

const LIMITS: Record<RouteType, number> = {
  auth: 10,
  sales: 120,
  products: 100,
  suppliers: 100,
  supplies: 100,
  dashboard: 60,
  'audit-logs': 30,
  exports: 10,
  backups: 5,
}

const WINDOW_MS = 60_000

interface Entry {
  count: number
  windowStart: number
}

// Module-level store shared across requests in the same Node.js process
const store = new Map<string, Entry>()
let opCount = 0

function maybeCleanup(): void {
  if (++opCount % 200 !== 0) return
  const now = Date.now()
  store.forEach((entry, key) => {
    if (now - entry.windowStart >= WINDOW_MS) store.delete(key)
  })
}

function getIdentifier(req: NextRequest, userId: string | null): string {
  if (userId) return `uid:${userId}`
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded
    ? forwarded.split(',')[0].trim()
    : (req.headers.get('x-real-ip') ?? 'unknown')
  return `ip:${ip}`
}

function isSentryEnabled(): boolean {
  return !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
}

export type RateLimitResult =
  | { limited: false; headers: Record<string, string> }
  | { limited: true; response: NextResponse; headers: Record<string, string> }

export function rateLimit(
  req: NextRequest,
  routeType: RouteType,
  userId: string | null,
  organizationId: number | null,
): RateLimitResult {
  maybeCleanup()

  const limit = LIMITS[routeType]
  const now = Date.now()
  const identifier = getIdentifier(req, userId)
  // Multi-tenant: org isolation ensures tenant A's usage doesn't block tenant B
  const key = `${routeType}:${identifier}:org:${organizationId ?? 'none'}`

  const entry = store.get(key)
  const inWindow = entry != null && now - entry.windowStart < WINDOW_MS

  const windowStart = inWindow ? entry!.windowStart : now
  const count = inWindow ? entry!.count + 1 : 1

  store.set(key, { count, windowStart })

  const remaining = Math.max(0, limit - count)
  const retryAfterSec = Math.ceil((windowStart + WINDOW_MS - now) / 1000)

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'Retry-After': String(retryAfterSec),
  }

  if (count > limit) {
    console.warn(
      `[RateLimit] Exceeded — route=${routeType} org=${organizationId ?? 'none'} identifier=${identifier} count=${count}/${limit}`,
    )

    if (isSentryEnabled()) {
      Sentry.withScope((scope) => {
        scope.setTag('rate_limit.route', routeType)
        scope.setTag('rate_limit.identifier', identifier)
        if (organizationId != null) scope.setTag('organization.id', String(organizationId))
        scope.setLevel('warning')
        scope.setContext('rate_limit', { routeType, identifier, organizationId, count, limit })
        Sentry.captureMessage(`Rate limit exceeded: ${routeType}`, 'warning')
      })
    }

    return {
      limited: true,
      response: NextResponse.json(
        { error: 'Shumë kërkesa. Ju lutem provoni përsëri pas pak.' },
        { status: 429, headers },
      ),
      headers,
    }
  }

  return { limited: false, headers }
}
