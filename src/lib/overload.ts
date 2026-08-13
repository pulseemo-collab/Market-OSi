/**
 * Concurrency limiting for expensive operations.
 *
 * Phase A's rate limiter bounds requests *per minute*, which is the right tool
 * for abuse. It is the wrong tool for cost: five simultaneous restores are
 * within every rate limit and will still saturate the connection pool, because
 * the limiter counts arrivals and not work in progress.
 *
 * This module counts work in progress. When an operation is already at its
 * ceiling the next caller is rejected immediately with 503 rather than queued —
 * a queue here would trade a fast, honest rejection for unbounded memory growth
 * and a client that times out anyway.
 *
 * Slots are keyed, so the limit can be applied per tenant. That matters for
 * multi-tenant fairness: one organization running restores must not consume the
 * global budget and lock every other organization out.
 */

import { OverloadedError } from './errors'
import { recordOverloadRejection } from './metrics'

export interface LimiterOptions {
  /** Operation name, used for metrics and the log line. */
  name: string
  /** Maximum simultaneous executions per key. */
  maxConcurrent: number
}

/**
 * Ceilings for the operations that can each hold a database connection for
 * seconds at a time.
 *
 * `restore` is 1 per organization by construction, not by tuning: the handler
 * deletes the tenant's data and rebuilds it, so two concurrent runs on one
 * organization would interleave into a corrupt result. This is the guard that
 * makes that impossible.
 */
export const LIMITS = {
  restore: { name: 'restore', maxConcurrent: 1 },
  backup: { name: 'backup', maxConcurrent: 2 },
  export: { name: 'export', maxConcurrent: 3 },
  platformAnalytics: { name: 'platform-analytics', maxConcurrent: 2 },
} as const satisfies Record<string, LimiterOptions>

const active = new Map<string, number>()

function slotKey(name: string, key: string | number | undefined): string {
  return key === undefined ? name : `${name}:${key}`
}

/**
 * Runs `task` if a slot is free, otherwise throws `OverloadedError` (503).
 *
 * `key` scopes the ceiling — pass an organizationId to limit per tenant, omit
 * it to limit process-wide. The slot is always released, including when `task`
 * throws, so a failing operation cannot permanently consume capacity.
 */
export async function withConcurrencyLimit<T>(
  options: LimiterOptions,
  key: string | number | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const mapKey = slotKey(options.name, key)
  const current = active.get(mapKey) ?? 0

  if (current >= options.maxConcurrent) {
    recordOverloadRejection(options.name)
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        type: 'overload_rejected',
        operation: options.name,
        active: current,
        maxConcurrent: options.maxConcurrent,
      }),
    )
    throw new OverloadedError(options.name)
  }

  active.set(mapKey, current + 1)
  try {
    return await task()
  } finally {
    const remaining = (active.get(mapKey) ?? 1) - 1
    if (remaining <= 0) active.delete(mapKey)
    else active.set(mapKey, remaining)
  }
}

/** In-flight counts per limited operation — surfaced through /api/health. */
export function overloadStats(): Record<string, number> {
  const out: Record<string, number> = {}
  active.forEach((count, key) => {
    out[key] = count
  })
  return out
}
