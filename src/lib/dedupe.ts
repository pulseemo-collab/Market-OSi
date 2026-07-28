/**
 * Single-flight request coalescing.
 *
 * When N identical expensive computations are requested while one is already
 * running, all N callers await the same promise instead of hitting the database
 * N times. This is what keeps a dashboard refresh storm — every cashier opening
 * the same org's dashboard at 09:00 — from multiplying into N× the query load.
 *
 * The map only ever holds in-flight work: entries are removed as soon as the
 * underlying promise settles, so there is nothing to expire and no stale data
 * risk. Failures propagate to every joined caller and are not memoized.
 */

import { recordDedupeJoin } from './metrics'

const inFlight = new Map<string, Promise<unknown>>()

export function dedupe<T>(
  namespace: string,
  key: string,
  loader: () => Promise<T>,
): Promise<T> {
  const mapKey = `${namespace}:${key}`
  const existing = inFlight.get(mapKey)
  if (existing) {
    recordDedupeJoin(namespace)
    return existing as Promise<T>
  }

  const promise = loader().finally(() => {
    inFlight.delete(mapKey)
  })

  inFlight.set(mapKey, promise)
  return promise
}

/** Number of computations currently in flight — surfaced through /api/health. */
export function inFlightCount(): number {
  return inFlight.size
}
