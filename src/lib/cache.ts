/**
 * Tenant-scoped response cache with tag-based invalidation.
 *
 * Rules this module enforces by construction:
 *
 *   1. Every key is namespaced by organizationId, so one tenant can never read
 *      another tenant's cached payload.
 *   2. Every entry carries tags. Mutations invalidate the specific tags they
 *      touch — there is no global flush.
 *   3. A miss is wrapped in single-flight dedup, so a thundering herd on a cold
 *      key produces exactly one database round trip.
 *
 * Never cache through this module: authentication, permissions, staff sessions,
 * login or PIN verification. Those are re-evaluated on every request.
 *
 * Cached values are shared by reference across callers and must be treated as
 * immutable — build the payload, cache it, return it, never mutate it after.
 */

import { dedupe } from './dedupe'
import { recordCacheHit, recordCacheInvalidation, recordCacheMiss } from './metrics'

const MAX_ENTRIES = parseInt(process.env.CACHE_MAX_ENTRIES ?? '2000')

/** Time-to-live per cached resource, in milliseconds. */
export const CACHE_TTL = {
  /** Aggregated sales/stock figures — recomputed a few times a minute. */
  dashboard: 30_000,
  /** Derived from stock levels; a minute of staleness is invisible to users. */
  reorder: 60_000,
  /** Business profile: changes only from the settings page. */
  organization: 300_000,
  /** Billing gate consulted on every business request. */
  subscription: 30_000,
  /** Immutable ledger of past billing changes. */
  billingHistory: 60_000,
  /** Cross-tenant platform statistics — expensive, read by one operator. */
  platform: 60_000,
  /** Supplier lookup list, used to populate selects across several pages. */
  suppliers: 120_000,
} as const

interface CacheEntry {
  value: unknown
  expiresAt: number
  tags: string[]
}

const store = new Map<string, CacheEntry>()
const tagIndex = new Map<string, Set<string>>()

let opCount = 0

function dropKey(key: string): void {
  const entry = store.get(key)
  if (!entry) return
  store.delete(key)
  for (const tag of entry.tags) {
    const keys = tagIndex.get(tag)
    if (!keys) continue
    keys.delete(key)
    if (keys.size === 0) tagIndex.delete(tag)
  }
}

function sweepExpired(): number {
  const now = Date.now()
  const expired: string[] = []
  store.forEach((entry, key) => {
    if (entry.expiresAt <= now) expired.push(key)
  })
  for (const key of expired) dropKey(key)
  return expired.length
}

function maybeSweep(): void {
  if (++opCount % 200 !== 0) return
  sweepExpired()
}

function enforceCapacity(): void {
  if (store.size < MAX_ENTRIES) return
  sweepExpired()
  // Map iterates in insertion order, so the first keys are the oldest writes.
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next()
    if (oldest.done) break
    dropKey(oldest.value)
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Entities whose mutations invalidate cached reads. */
export type CacheEntity =
  | 'products'
  | 'sales'
  | 'suppliers'
  | 'supplies'
  | 'organization'
  | 'subscription'
  | 'users'
  | 'staff'

/** Tag identifying one entity within one tenant. */
export function orgTag(organizationId: number, entity: CacheEntity): string {
  return `org:${organizationId}:${entity}`
}

/** Tag covering every cached entry belonging to one tenant. */
export function orgScopeTag(organizationId: number): string {
  return `org:${organizationId}`
}

/** Tag for cross-tenant platform aggregates, which any org's data can affect. */
export const PLATFORM_TAG = 'platform'

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export interface CacheOptions {
  /** Logical resource name, used for the cache key and for hit/miss metrics. */
  namespace: string
  /** Tenant that owns the entry. Cross-tenant reuse is impossible by design. */
  organizationId: number
  /** Discriminates variants of the same resource, e.g. serialized filters. */
  variant?: string
  ttlMs: number
  /** Tags that, when invalidated, evict this entry. */
  tags: string[]
}

function buildKey(options: CacheOptions): string {
  return `${options.namespace}:org:${options.organizationId}:${options.variant ?? ''}`
}

/**
 * Returns the cached value, or computes it via `loader` and caches the result.
 * Concurrent misses on the same key share a single `loader` invocation.
 *
 * A rejected `loader` is never cached.
 */
export async function cached<T>(options: CacheOptions, loader: () => Promise<T>): Promise<T> {
  maybeSweep()

  const key = buildKey(options)
  const entry = store.get(key)

  if (entry && entry.expiresAt > Date.now()) {
    recordCacheHit(options.namespace)
    return entry.value as T
  }
  if (entry) dropKey(key)

  recordCacheMiss(options.namespace)

  return dedupe(options.namespace, key, async () => {
    const value = await loader()

    enforceCapacity()

    const tags = [orgScopeTag(options.organizationId), ...options.tags]
    store.set(key, { value, expiresAt: Date.now() + options.ttlMs, tags })
    for (const tag of tags) {
      let keys = tagIndex.get(tag)
      if (!keys) {
        keys = new Set()
        tagIndex.set(tag, keys)
      }
      keys.add(key)
    }

    return value
  })
}

/**
 * Evicts every entry carrying any of the given tags.
 *
 * Call this from mutation handlers with the tags the mutation actually affects.
 * Passing a broad tag (an entire org) is supported but should stay rare.
 */
export function invalidateTags(...tags: string[]): void {
  for (const tag of tags) {
    const keys = tagIndex.get(tag)
    if (!keys || keys.size === 0) {
      recordCacheInvalidation(tag, 0)
      continue
    }
    const affected = Array.from(keys)
    for (const key of affected) dropKey(key)
    recordCacheInvalidation(tag, affected.length)
  }
}

/** Entry count and tag count — surfaced through /api/health. */
export function cacheStats(): { entries: number; tags: number; maxEntries: number } {
  return { entries: store.size, tags: tagIndex.size, maxEntries: MAX_ENTRIES }
}
