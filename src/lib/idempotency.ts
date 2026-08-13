/**
 * Idempotent write protection.
 *
 * A client that sends an `Idempotency-Key` header gets an at-most-once
 * guarantee for that write: a double click, an F5 during submit, a browser
 * retry or a network-level retry all resolve to the *first* response instead of
 * creating a second sale, supply or user.
 *
 * Protection runs at two levels, and both are needed:
 *
 *   - **Durable (PostgreSQL).** The authority. A row in `IdempotencyRecord`
 *     claimed under a unique constraint, so duplicates landing on *different*
 *     serverless instances still serialise. See `idempotency-store.ts`.
 *   - **In-process.** A cache in front of it. A double tap almost always hits
 *     the same instance, and answering it locally avoids a database round trip
 *     on the hottest write path. It is populated only from durably settled
 *     results, so it can never claim something the database has not.
 *
 * Keys are scoped by tenant, user and route, so two organizations — or two
 * users, or the same key on different endpoints — can never collide. That tuple
 * is the unique constraint, so isolation is enforced by the database itself.
 *
 * 5xx, 429 and 409 responses are deliberately *not* stored: a request that
 * failed for a transient or contested reason must remain retryable.
 *
 * If the durable store is unreachable the request still runs, protected by the
 * in-process layer alone — the pre-existing guarantee, never less. Refusing
 * sales because the dedup table is unavailable would convert a degraded
 * dependency into an outage.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  recordIdempotencyConflict,
  recordIdempotencyDegraded,
  recordIdempotencyInProgress,
  recordIdempotencyReplay,
  recordIdempotencyStored,
} from './metrics'
import { ConflictError, errorResponseFrom } from './errors'
import {
  acquireClaim,
  completeClaim,
  releaseClaim,
  type IdempotencyKeyParts,
} from './idempotency-store'

export const IDEMPOTENCY_HEADER = 'idempotency-key'

const TTL_MS = parseInt(process.env.IDEMPOTENCY_TTL_MS ?? '600000')
const MAX_ENTRIES = parseInt(process.env.IDEMPOTENCY_MAX_ENTRIES ?? '5000')
const MAX_KEY_LENGTH = 200

interface StoredResult {
  status: number
  body: unknown
}

interface StoredEntry extends StoredResult {
  expiresAt: number
  fingerprint: string
}

const completed = new Map<string, StoredEntry>()
const inFlight = new Map<string, Promise<StoredResult | null>>()
/** Fingerprint of the payload currently executing under each key. */
const inFlightFingerprints = new Map<string, string>()

/** Times the durable store could not be reached — surfaced through /api/health. */
let degradedCount = 0

let opCount = 0

function maybeSweep(): void {
  if (++opCount % 100 !== 0) return
  const now = Date.now()
  const expired: string[] = []
  completed.forEach((entry, key) => {
    if (entry.expiresAt <= now) expired.push(key)
  })
  for (const key of expired) completed.delete(key)
}

function enforceCapacity(): void {
  while (completed.size >= MAX_ENTRIES) {
    const oldest = completed.keys().next()
    if (oldest.done) break
    completed.delete(oldest.value)
  }
}

function replay(result: StoredResult, clientKey: string): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      'Idempotent-Replay': 'true',
      'Idempotency-Key': clientKey,
    },
  })
}

/**
 * Responses worth remembering: outcomes that are settled and safe to reuse.
 *
 * Excluded, each for a different reason:
 *
 *   - 5xx and 429 — the request failed for a transient server reason and must
 *     stay retryable.
 *   - 409 — a conflict means nothing was committed, so replaying it is not
 *     needed for safety, and the state it reports is exactly the state that can
 *     change. Pinning it would leave a cashier who lost a stock race stuck with
 *     a stale rejection for the whole TTL even after the item is restocked.
 */
function isStorable(status: number): boolean {
  return status < 500 && status !== 429 && status !== 409
}

/**
 * Order-insensitive fingerprint of the request body.
 *
 * Guards against the dangerous half of key reuse: a client bug that sends a
 * *different* basket under a key already used. Without this the second, genuine
 * sale would silently receive the first sale's response and never be recorded.
 * Cheap non-cryptographic hash — this detects mistakes, not attacks, and the
 * key is already scoped to one user and organization.
 *
 * It is also the only form in which a request body is persisted: the durable
 * record stores this string, never the payload it came from.
 */
function fingerprint(body: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 15)
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}:${body.length}`
}

export interface IdempotencyScope {
  /** Route identifier, e.g. 'POST /api/sales'. */
  route: string
  organizationId: number
  /** Supabase user id or `staff:<id>` — prevents key reuse across users. */
  userId: string
}

/**
 * Runs `handler` at most once per `Idempotency-Key` within the key's TTL,
 * across every instance of the application.
 *
 * Requests without the header run normally, so adding this wrapper to a route
 * never changes behaviour for existing clients.
 */
export async function withIdempotency(
  req: NextRequest,
  scope: IdempotencyScope,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const clientKey = req.headers.get(IDEMPOTENCY_HEADER)?.trim()
  if (!clientKey || clientKey.length > MAX_KEY_LENGTH) return handler()

  maybeSweep()

  const localKey = `${scope.organizationId}:${scope.userId}:${scope.route}:${clientKey}`
  const parts: IdempotencyKeyParts = {
    organizationId: scope.organizationId,
    userId: scope.userId,
    route: scope.route,
    key: clientKey,
  }

  // Read through a clone so the handler's own `req.json()` still sees an
  // unconsumed body.
  let payload: string
  try {
    payload = await req.clone().text()
  } catch {
    // Unreadable body — fall through without deduplication rather than
    // rejecting a request the handler might well be able to serve.
    return handler()
  }
  const payloadFingerprint = fingerprint(payload)

  // ---- Level 1: this instance already knows the answer -------------------

  const stored = completed.get(localKey)
  if (stored) {
    if (stored.expiresAt > Date.now()) {
      if (stored.fingerprint !== payloadFingerprint) {
        return keyReuseConflict(req, scope, clientKey)
      }
      recordIdempotencyReplay(scope.route)
      return replay(stored, clientKey)
    }
    completed.delete(localKey)
  }

  // A duplicate that arrived while the original is still running on *this*
  // instance joins it directly, which is both faster and more precise than
  // polling the database for a claim this process already owns.
  const running = inFlight.get(localKey)
  if (running) {
    if (inFlightFingerprints.get(localKey) !== payloadFingerprint) {
      return keyReuseConflict(req, scope, clientKey)
    }
    const result = await running
    if (result) {
      recordIdempotencyReplay(scope.route)
      return replay(result, clientKey)
    }
    // The original attempt failed in a retryable way and left nothing to
    // replay, so this request continues into the durable path on its own.
  }

  // ---- Level 2: claim the key across every instance ----------------------

  const claim = await acquireClaim(parts, payloadFingerprint)

  switch (claim.outcome) {
    case 'replay': {
      // Cache it so further duplicates on this instance skip the round trip.
      enforceCapacity()
      completed.set(localKey, {
        status: claim.status,
        body: claim.body,
        expiresAt: Date.now() + TTL_MS,
        fingerprint: payloadFingerprint,
      })
      recordIdempotencyReplay(scope.route)
      return replay({ status: claim.status, body: claim.body }, clientKey)
    }

    case 'conflict':
      return keyReuseConflict(req, scope, clientKey)

    case 'in_progress':
      return stillProcessing(req, scope)

    case 'unavailable':
      degradedCount += 1
      recordIdempotencyDegraded()
      break

    case 'claimed':
      break
  }

  const recordId = claim.outcome === 'claimed' ? claim.recordId : null

  // ---- Execute, then settle or release the claim -------------------------

  const execution = (async (): Promise<{ response: NextResponse; stored: StoredResult | null }> => {
    let response: NextResponse
    try {
      response = await handler()
    } catch (error) {
      // Nothing was settled, so the key must not stay claimed — the next retry
      // has to be able to take it.
      if (recordId !== null) await releaseClaim(recordId, scope.organizationId)
      throw error
    }

    if (!isStorable(response.status)) {
      if (recordId !== null) await releaseClaim(recordId, scope.organizationId)
      return { response, stored: null }
    }

    let body: unknown
    try {
      body = await response.clone().json()
    } catch {
      if (recordId !== null) await releaseClaim(recordId, scope.organizationId)
      return { response, stored: null }
    }

    if (recordId !== null) {
      await completeClaim(recordId, scope.organizationId, response.status, body)
    }

    enforceCapacity()
    completed.set(localKey, {
      status: response.status,
      body,
      expiresAt: Date.now() + TTL_MS,
      fingerprint: payloadFingerprint,
    })
    recordIdempotencyStored()
    return { response, stored: { status: response.status, body } }
  })()

  inFlight.set(
    localKey,
    execution.then(({ stored }) => stored).catch(() => null),
  )
  inFlightFingerprints.set(localKey, payloadFingerprint)

  try {
    // The originating caller always receives the handler's own response, so
    // cookies and headers set by the route survive untouched.
    const { response } = await execution
    return response
  } finally {
    inFlight.delete(localKey)
    inFlightFingerprints.delete(localKey)
  }
}

/**
 * Same key, different payload.
 *
 * Refusing is the safe answer in both readings: if the client meant to retry,
 * its payload changed and replaying the old response would misreport what
 * happened; if it meant a new operation, it must use a new key or the write
 * would be silently swallowed.
 */
function keyReuseConflict(
  req: NextRequest,
  scope: IdempotencyScope,
  clientKey: string,
): NextResponse {
  recordIdempotencyConflict(scope.route)
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      type: 'idempotency_key_reuse',
      route: scope.route,
      orgId: scope.organizationId,
    }),
  )
  return errorResponseFrom(
    req,
    new ConflictError(
      'Ky çelës veprimi është përdorur për një kërkesë tjetër. Rifreskoni dhe provoni përsëri.',
      { detail: `idempotency key reused with different payload on ${scope.route}` },
    ),
  )
}

/**
 * The same operation is still executing on another instance.
 *
 * Returned only after a bounded wait, so it means "genuinely slow", not "just
 * arrived". 409 rather than a 5xx because nothing is broken and nothing was
 * duplicated: the original is in flight and its result will be replayable.
 */
function stillProcessing(req: NextRequest, scope: IdempotencyScope): NextResponse {
  recordIdempotencyInProgress(scope.route)
  return errorResponseFrom(
    req,
    new ConflictError(
      'Ky veprim është duke u përpunuar. Prisni pak dhe kontrolloni para se ta provoni sërish.',
      {
        detail: `idempotency key still in progress on ${scope.route}`,
        retryable: true,
      },
    ),
  )
}

/** Local cache counters and durable-store health — surfaced through /api/health. */
export function idempotencyStats(): {
  stored: number
  inFlight: number
  durableFailures: number
} {
  return { stored: completed.size, inFlight: inFlight.size, durableFailures: degradedCount }
}
