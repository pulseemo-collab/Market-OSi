import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { cacheStats } from '@/lib/cache'
import { inFlightCount } from '@/lib/dedupe'
import { idempotencyStats } from '@/lib/idempotency'
import { jobStats } from '@/lib/jobs'
import { getMetricsSnapshot } from '@/lib/metrics'

const APP_VERSION = '1.1.0'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const timestamp = new Date().toISOString()

  // DB check — simple ping
  let dbStatus: 'ok' | 'error' = 'error'
  let dbLatencyMs: number | null = null
  try {
    const t0 = Date.now()
    await prisma.$queryRaw`SELECT 1`
    dbLatencyMs = Date.now() - t0
    dbStatus = 'ok'
  } catch {
    dbStatus = 'error'
  }

  // Supabase config check — presence only, never expose values
  const supabaseStatus =
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? 'configured'
      : 'misconfigured'

  const authServiceStatus = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? 'configured'
    : 'misconfigured'

  const allOk = dbStatus === 'ok' && supabaseStatus === 'configured' && authServiceStatus === 'configured'

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
    }
  }

  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      timestamp,
      version: APP_VERSION,
      services: {
        api: 'ok',
        database: { status: dbStatus, latencyMs: dbLatencyMs },
        supabase: { status: supabaseStatus },
        authService: { status: authServiceStatus },
      },
      ...(metrics ? { metrics } : {}),
    },
    { status: allOk ? 200 : 503 },
  )
}
