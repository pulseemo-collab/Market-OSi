/**
 * Durable idempotency claims.
 *
 * The in-process map this replaces could only deduplicate requests that reached
 * the *same* Node process. On Vercel a POS retry routinely lands on a different
 * instance, where that map is empty — so the second request executed and the
 * sale was recorded twice. This module moves the claim into PostgreSQL, which
 * every instance already shares.
 *
 * The whole design rests on one constraint:
 *
 *     UNIQUE (organizationId, userId, route, key)
 *
 * Acquiring a claim is an INSERT. Two duplicates racing on different instances
 * both INSERT; PostgreSQL admits exactly one and rejects the other with a unique
 * violation (P2002). The winner executes, the loser waits for the result. No
 * lock manager, no external service, no polling for consensus — the uniqueness
 * check *is* the mutual exclusion.
 *
 * A claim is a lease, not a permanent reservation. If the instance holding it
 * dies mid-write, the row stays `in_progress` only until `expiresAt`, after
 * which another request may steal it. That bound is what keeps a crash from
 * pinning a cashier's key until someone intervenes.
 *
 * What is never written here: request bodies (reduced to a non-reversible
 * fingerprint), response headers (they can carry Set-Cookie), auth tokens, and
 * driver-level error text. `responseBody` holds only what was already sent to
 * this same client under this same key.
 */

import { Prisma } from '@prisma/client'

import { classifyError } from './errors'

export type ClaimOutcome =
  /** This request owns the claim and must run the handler. */
  | { outcome: 'claimed'; recordId: number }
  /** A previous run of this exact request settled; replay its response. */
  | { outcome: 'replay'; status: number; body: unknown }
  /** Same key, different payload — a client defect, never a silent replay. */
  | { outcome: 'conflict' }
  /** Another instance is executing it right now and did not finish in time. */
  | { outcome: 'in_progress' }
  /** The store itself is unreachable; the caller degrades instead of failing. */
  | { outcome: 'unavailable' }

/**
 * How long a claim may stay `in_progress` before another request may steal it.
 *
 * The floor is the slowest write path (a sale transaction is bounded well under
 * 10s); the ceiling is how long a cashier should ever be blocked by an instance
 * that died mid-request.
 */
const CLAIM_LEASE_MS = parseInt(process.env.IDEMPOTENCY_CLAIM_LEASE_MS ?? '60000')

/** How long a settled response stays replayable. */
const COMPLETED_TTL_MS = parseInt(process.env.IDEMPOTENCY_TTL_MS ?? '600000')

/** Bounded wait for a claim held by another instance. */
const WAIT_ROUNDS = parseInt(process.env.IDEMPOTENCY_WAIT_ROUNDS ?? '6')
const WAIT_INTERVAL_MS = parseInt(process.env.IDEMPOTENCY_WAIT_INTERVAL_MS ?? '120')

/**
 * Ceiling on a stored response body, in JSON characters.
 *
 * A response too large to store is still *returned* to the caller — it simply
 * is not replayable, and the claim is released. Unbounded rows on the hottest
 * write path is the failure this prevents.
 */
const MAX_BODY_CHARS = parseInt(process.env.IDEMPOTENCY_MAX_BODY_CHARS ?? '65536')

/** Sweep expired rows roughly this often, counted in claim attempts. */
const SWEEP_EVERY = 200
const SWEEP_BATCH = 500

const STATUS_IN_PROGRESS = 'in_progress'
const STATUS_COMPLETED = 'completed'

export interface IdempotencyKeyParts {
  organizationId: number
  userId: string
  route: string
  key: string
}

interface RecordRow {
  id: number
  fingerprint: string
  status: string
  responseStatus: number | null
  responseBody: unknown
  expiresAt: Date
}

/**
 * The slice of PrismaClient this module uses.
 *
 * Narrowing to it keeps the claim protocol testable against a fake that models
 * the unique constraint, without standing up PostgreSQL — and documents that
 * nothing here reaches beyond these four operations on one table.
 */
export interface IdempotencyClient {
  idempotencyRecord: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: number }>
    findUnique(args: {
      where: { organizationId_userId_route_key: IdempotencyKeyParts }
    }): Promise<RecordRow | null>
    findMany(args: {
      where: Record<string, unknown>
      select: { id: true }
      take: number
    }): Promise<Array<{ id: number }>>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>
  }
}

let client: IdempotencyClient | null = null

/**
 * Resolves the Prisma client lazily.
 *
 * Importing it at module load would construct a PrismaClient in every context
 * that touches idempotency, including test runs that never reach a database.
 */
async function getClient(): Promise<IdempotencyClient> {
  if (client) return client
  const { prisma } = await import('./prisma')
  client = prisma as unknown as IdempotencyClient
  return client
}

/**
 * Test seam. Supplying a fake here is what lets the claim protocol be verified
 * against modelled unique-constraint behaviour; passing `null` restores Prisma.
 */
export function setIdempotencyClient(fake: IdempotencyClient | null): void {
  client = fake
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002'
}

let attemptCount = 0

/**
 * Best-effort removal of expired rows.
 *
 * Scoped to this module's own table and to rows whose lease and replay window
 * have both lapsed, batched so a sweep can never turn into a long-running
 * delete, and never awaited — cleanup must not add latency to a sale, nor fail
 * one if it errors.
 */
function maybeSweep(db: IdempotencyClient): void {
  if (++attemptCount % SWEEP_EVERY !== 0) return

  // Two steps because deleteMany has no row limit: select a bounded batch of
  // expired ids, then delete exactly those. An unbounded delete after an outage
  // could otherwise touch every stale row in one statement.
  void (async () => {
    const expired = await db.idempotencyRecord.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true },
      take: SWEEP_BATCH,
    })
    if (expired.length === 0) return
    await db.idempotencyRecord.deleteMany({
      where: { id: { in: expired.map((row) => row.id) } },
    })
  })().catch(() => undefined)
}

/**
 * Attempts to take ownership of an idempotency key.
 *
 * Returns `claimed` to exactly one caller per key per lease window. Everyone
 * else gets `replay`, `conflict` or `in_progress` — and `unavailable` if the
 * database cannot be reached, which the caller treats as "degrade", never as
 * "allow through unchecked twice".
 */
export async function acquireClaim(
  parts: IdempotencyKeyParts,
  fingerprint: string,
): Promise<ClaimOutcome> {
  let db: IdempotencyClient
  try {
    db = await getClient()
  } catch {
    return { outcome: 'unavailable' }
  }

  maybeSweep(db)

  for (let round = 0; round <= WAIT_ROUNDS; round++) {
    try {
      // The claim. If no row exists for this tuple, this INSERT wins and this
      // request owns the operation.
      const created = await db.idempotencyRecord.create({
        data: {
          ...parts,
          fingerprint,
          status: STATUS_IN_PROGRESS,
          claimedAt: new Date(),
          expiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
        },
      })
      return { outcome: 'claimed', recordId: created.id }
    } catch (error) {
      if (!isUniqueViolation(error)) {
        // A real store failure. Reported as unavailable so the caller degrades
        // to same-instance protection rather than rejecting a legitimate sale.
        logStoreFailure('acquire', error)
        return { outcome: 'unavailable' }
      }
    }

    // Someone else holds the tuple. Find out in what state.
    let existing: RecordRow | null
    try {
      existing = await db.idempotencyRecord.findUnique({
        where: { organizationId_userId_route_key: parts },
      })
    } catch (error) {
      logStoreFailure('read', error)
      return { outcome: 'unavailable' }
    }

    // Deleted between the INSERT and the read — the owner failed in a retryable
    // way and released the key. Try to claim it ourselves.
    if (!existing) continue

    const expired = existing.expiresAt.getTime() <= Date.now()

    if (expired) {
      // The lease or replay window lapsed. Steal it with a guarded update: the
      // `expiresAt <= now` predicate is re-evaluated under the row lock, so of
      // several requests racing to steal, exactly one matches a row.
      const stolen = await stealClaim(db, existing.id, fingerprint)
      if (stolen === 'unavailable') return { outcome: 'unavailable' }
      if (stolen === 'won') return { outcome: 'claimed', recordId: existing.id }
      continue
    }

    // A live record. Payload must match before anything is shared back.
    if (existing.fingerprint !== fingerprint) return { outcome: 'conflict' }

    if (existing.status === STATUS_COMPLETED && existing.responseStatus !== null) {
      return {
        outcome: 'replay',
        status: existing.responseStatus,
        body: existing.responseBody,
      }
    }

    // Still running on another instance. Wait briefly — a POS retry usually
    // arrives while the original is mid-flight, and a short wait turns that into
    // a correct replay instead of an error the cashier has to interpret.
    if (round < WAIT_ROUNDS) await sleep(WAIT_INTERVAL_MS)
  }

  return { outcome: 'in_progress' }
}

/**
 * Takes over an expired record.
 *
 * `won` means this request now owns the claim, `lost` means another request
 * took it first and the caller must re-read.
 */
async function stealClaim(
  db: IdempotencyClient,
  recordId: number,
  fingerprint: string,
): Promise<'won' | 'lost' | 'unavailable'> {
  try {
    const result = await db.idempotencyRecord.updateMany({
      where: { id: recordId, expiresAt: { lte: new Date() } },
      data: {
        fingerprint,
        status: STATUS_IN_PROGRESS,
        responseStatus: null,
        // DbNull writes SQL NULL to a Json? column; a bare null would be read
        // as the JSON value `null`.
        responseBody: Prisma.DbNull,
        claimedAt: new Date(),
        completedAt: null,
        expiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
      },
    })
    return result.count === 1 ? 'won' : 'lost'
  } catch (error) {
    logStoreFailure('steal', error)
    return 'unavailable'
  }
}

/**
 * Settles a claim with a replayable response.
 *
 * Scoped by organizationId as well as primary key: the tenant boundary is
 * restated on the write even though the id alone already identifies the row.
 */
export async function completeClaim(
  recordId: number,
  organizationId: number,
  status: number,
  body: unknown,
): Promise<boolean> {
  let serialised: string
  try {
    serialised = JSON.stringify(body)
  } catch {
    await releaseClaim(recordId, organizationId)
    return false
  }

  if (serialised.length > MAX_BODY_CHARS) {
    // Too large to keep. Releasing is the safe direction: the caller still gets
    // its response, and a later duplicate re-executes rather than the table
    // growing without bound.
    await releaseClaim(recordId, organizationId)
    return false
  }

  try {
    const db = await getClient()
    const updated = await db.idempotencyRecord.updateMany({
      where: { id: recordId, organizationId },
      data: {
        status: STATUS_COMPLETED,
        responseStatus: status,
        // JsonNull stores the JSON value `null`, distinct from "no body".
        responseBody: body === null ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + COMPLETED_TTL_MS),
      },
    })
    return updated.count === 1
  } catch (error) {
    logStoreFailure('complete', error)
    return false
  }
}

/**
 * Releases a claim without storing a result, leaving the key free.
 *
 * This is what keeps a transient failure from poisoning a key: a 5xx, a 429, a
 * stock conflict or a thrown exception all end here, so the very next retry can
 * claim the key cleanly instead of replaying a failure for the whole TTL.
 */
export async function releaseClaim(
  recordId: number,
  organizationId: number,
): Promise<void> {
  try {
    const db = await getClient()
    await db.idempotencyRecord.deleteMany({ where: { id: recordId, organizationId } })
  } catch (error) {
    // The lease expiry is the backstop: an unreleased claim frees itself.
    logStoreFailure('release', error)
  }
}

/**
 * Logs a store failure as a classified code.
 *
 * Never the raw error — driver text can carry table names, constraint names,
 * query fragments and connection details.
 */
function logStoreFailure(operation: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      type: 'idempotency_store_failure',
      operation,
      code: classifyError(error).code,
    }),
  )
}

export const IDEMPOTENCY_STORE_LIMITS = {
  claimLeaseMs: CLAIM_LEASE_MS,
  completedTtlMs: COMPLETED_TTL_MS,
  waitRounds: WAIT_ROUNDS,
  waitIntervalMs: WAIT_INTERVAL_MS,
  maxBodyChars: MAX_BODY_CHARS,
} as const
