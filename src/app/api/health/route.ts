import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { cacheStats } from '@/lib/cache'
import { inFlightCount } from '@/lib/dedupe'
import { idempotencyStats } from '@/lib/idempotency'
import { jobStats } from '@/lib/jobs'
import { getMetricsSnapshot } from '@/lib/metrics'
import { circuitStats, withTimeout } from '@/lib/reliability'
import { overloadStats } from '@/lib/overload'
import { classifyError } from '@/lib/errors'

const APP_VERSION = '1.1.0'

/**
 * The database probe gets its own short timeout, well under any platform or
 * load-balancer probe deadline.
 *
 * A health check that hangs is worse than one that fails: the orchestrator
 * learns nothing and waits, when what it needs is a prompt "not ready".
 */
const DB_PROBE_TIMEOUT_MS = parseInt(process.env.HEALTH_DB_TIMEOUT_MS ?? '3000')

/** Above this, the instance is reachable but too slow to call healthy. */
const DB_DEGRADED_MS = parseInt(process.env.HEALTH_DB_DEGRADED_MS ?? '1000')

const startedAt = Date.now()

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const timestamp = new Date().toISOString()
  const probe = new URL(request.url).searchParams.get('probe')

  // Liveness answers one question: is this process running and able to serve a
  // response at all? It deliberately touches no dependency, because restarting
  // an instance for a database outage is the wrong remedy — every replacement
  // would fail the same check and the restart loop would add load to an already
  // struggling database.
  if (probe === 'liveness') {
    return NextResponse.json(
      {
        status: 'ok',
        probe: 'liveness',
        timestamp,
        version: APP_VERSION,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
      { status: 200 },
    )
  }

  // Readiness (the default, unchanged for existing uptime monitors) asks
  // whether this instance can actually serve business traffic.
  let dbStatus: 'ok' | 'degraded' | 'error' = 'error'
  let dbLatencyMs: number | null = null
  let dbFailure: string | null = null
  try {
    const t0 = Date.now()
    await withTimeout(() => prisma.$queryRaw`SELECT 1`, {
      operation: 'health-db-probe',
      timeoutMs: DB_PROBE_TIMEOUT_MS,
    })
    dbLatencyMs = Date.now() - t0
    dbStatus = dbLatencyMs >= DB_DEGRADED_MS ? 'degraded' : 'ok'
  } catch (error) {
    // The classified code is safe to publish — it names a category, never a
    // connection string, host or driver message.
    dbStatus = 'error'
    dbFailure = classifyError(error).code
  }

  // Supabase config check — presence only, never expose values
  const supabaseStatus =
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? 'configured'
      : 'misconfigured'

  const authServiceStatus = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? 'configured'
    : 'misconfigured'

  const configured = supabaseStatus === 'configured' && authServiceStatus === 'configured'
  // Ready means "can serve requests", which a slow-but-working database still
  // allows. Only an unreachable database, or missing configuration, takes the
  // instance out of rotation.
  const ready = dbStatus !== 'error' && configured
  const allOk = dbStatus === 'ok' && configured

  // The liveness payload stays public and unchanged for uptime probes.
  // Performance counters describe traffic across all tenants, so they are only
  // returned to a platform operator who explicitly asks for them.
  let metrics: Record<string, unknown> | undefined
  if (new URL(request.url).searchParams.get('metrics') === 'true') {
    const { error } = await requirePermission('global:monitoring')
    if (error) return error

    metrics = {
      ...getMetricsSnapshot(),
      cacheStore: cacheStats(),
      dedupeInFlight: inFlightCount(),
      idempotency: idempotencyStats(),
      jobs: jobStats(),
      circuits: circuitStats(),
      concurrency: overloadStats(),
    }
  }

  return NextResponse.json(
    {
      status: allOk ? 'ok' : ready ? 'degraded' : 'unavailable',
      ready,
      probe: 'readiness',
      timestamp,
      version: APP_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      services: {
        api: 'ok',
        database: { status: dbStatus, latencyMs: dbLatencyMs, ...(dbFailure ? { failure: dbFailure } : {}) },
        supabase: { status: supabaseStatus },
        authService: { status: authServiceStatus },
      },
      ...(metrics ? { metrics } : {}),
    },
    // A degraded-but-usable instance still answers 200 so a slow database does
    // not empty the load balancer pool and concentrate the same traffic on
    // fewer instances.
    { status: ready ? 200 : 503 },
  )
}
