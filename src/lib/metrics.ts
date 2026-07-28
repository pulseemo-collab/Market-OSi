/**
 * In-process performance counters.
 *
 * Extends the Phase A observability story (structured logs, request IDs, slow
 * query warnings) with aggregate numbers: cache efficiency, query cost per
 * model, endpoint latency, idempotency replays.
 *
 * Counters live in the Node.js process — the same trade-off already accepted by
 * the rate limiter. They describe one instance, not the whole fleet, and are
 * read back through GET /api/health?metrics=1.
 */

const SLOW_ENDPOINT_MS = parseInt(process.env.SLOW_ENDPOINT_MS ?? '1000')
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS ?? '1000')

/** Guards against unbounded growth if a label is ever built from user input. */
const MAX_LABELS = 500

const startedAt = Date.now()

export interface DurationStat {
  count: number
  totalMs: number
  maxMs: number
  slowCount: number
}

const counters = new Map<string, number>()
const durations = new Map<string, DurationStat>()

function bump(map: Map<string, number>, key: string, by = 1): void {
  const current = map.get(key)
  if (current === undefined && map.size >= MAX_LABELS) return
  map.set(key, (current ?? 0) + by)
}

function observe(key: string, durationMs: number, slowThresholdMs: number): void {
  let stat = durations.get(key)
  if (!stat) {
    if (durations.size >= MAX_LABELS) return
    stat = { count: 0, totalMs: 0, maxMs: 0, slowCount: 0 }
    durations.set(key, stat)
  }
  stat.count += 1
  stat.totalMs += durationMs
  if (durationMs > stat.maxMs) stat.maxMs = durationMs
  if (durationMs >= slowThresholdMs) stat.slowCount += 1
}

export function recordCacheHit(namespace: string): void {
  bump(counters, `cache.hit.${namespace}`)
}

export function recordCacheMiss(namespace: string): void {
  bump(counters, `cache.miss.${namespace}`)
}

export function recordCacheInvalidation(tag: string, keysRemoved: number): void {
  bump(counters, 'cache.invalidation')
  bump(counters, 'cache.keys_evicted', keysRemoved)
  if (keysRemoved > 0) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        type: 'cache_invalidation',
        tag,
        keysRemoved,
      }),
    )
  }
}

/** A second caller joined an in-flight computation instead of repeating it. */
export function recordDedupeJoin(namespace: string): void {
  bump(counters, `dedupe.join.${namespace}`)
}

export function recordIdempotencyReplay(route: string): void {
  bump(counters, 'idempotency.replay')
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      type: 'idempotency_replay',
      route,
    }),
  )
}

export function recordIdempotencyStored(): void {
  bump(counters, 'idempotency.stored')
}

export function recordQuery(model: string, action: string, durationMs: number): void {
  observe(`query.${model}.${action}`, durationMs, SLOW_QUERY_MS)
}

export function recordEndpoint(
  route: string,
  method: string,
  status: number,
  durationMs: number,
): void {
  observe(`endpoint.${method} ${route}`, durationMs, SLOW_ENDPOINT_MS)
  if (status >= 500) bump(counters, `endpoint.errors.${method} ${route}`)

  if (durationMs >= SLOW_ENDPOINT_MS) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        type: 'slow_endpoint',
        route,
        method,
        status,
        durationMs,
      }),
    )
  }
}

export interface MetricsSnapshot {
  uptimeSeconds: number
  counters: Record<string, number>
  durations: Record<string, { count: number; avgMs: number; maxMs: number; slowCount: number }>
  cache: { hits: number; misses: number; hitRate: number | null }
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const counterOut: Record<string, number> = {}
  let hits = 0
  let misses = 0
  counters.forEach((value, key) => {
    counterOut[key] = value
    if (key.startsWith('cache.hit.')) hits += value
    if (key.startsWith('cache.miss.')) misses += value
  })

  const durationOut: Record<
    string,
    { count: number; avgMs: number; maxMs: number; slowCount: number }
  > = {}
  durations.forEach((stat, key) => {
    durationOut[key] = {
      count: stat.count,
      avgMs: Math.round((stat.totalMs / stat.count) * 100) / 100,
      maxMs: stat.maxMs,
      slowCount: stat.slowCount,
    }
  })

  const total = hits + misses

  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    counters: counterOut,
    durations: durationOut,
    cache: {
      hits,
      misses,
      hitRate: total > 0 ? Math.round((hits / total) * 1000) / 1000 : null,
    },
  }
}
