/**
 * Idempotent write protection.
 *
 * A client that sends an `Idempotency-Key` header gets an at-most-once
 * guarantee for that write: a double click, an F5 during submit, a browser
 * retry or a network-level retry all resolve to the *first* response instead of
 * creating a second sale, supply or user.
 *
 * Two cases are handled:
 *
 *   - The duplicate arrives while the original is still running. It joins the
 *     in-flight promise rather than starting a second transaction.
 *   - The duplicate arrives after the original finished. It replays the stored
 *     response, marked with `Idempotent-Replay: true`.
 *
 * Keys are scoped by tenant, user and route, so two organizations — or two
 * users, or the same key on different endpoints — can never collide.
 *
 * 5xx and 429 responses are deliberately *not* stored: a request that failed
 * because of a transient server condition must remain retryable.
 */

import { NextRequest, NextResponse } from 'next/server'
import { recordIdempotencyReplay, recordIdempotencyStored } from './metrics'

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
}

const completed = new Map<string, StoredEntry>()
const inFlight = new Map<string, Promise<StoredResult | null>>()

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

/** Responses worth remembering: deterministic outcomes the client can safely reuse. */
function isStorable(status: number): boolean {
  return status < 500 && status !== 429
}

export interface IdempotencyScope {
  /** Route identifier, e.g. 'POST /api/sales'. */
  route: string
  organizationId: number
  /** Supabase user id or `staff:<id>` — prevents key reuse across users. */
  userId: string
}

/**
 * Runs `handler` at most once per `Idempotency-Key` within the key's TTL.
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

  const key = `${scope.organizationId}:${scope.userId}:${scope.route}:${clientKey}`

  const stored = completed.get(key)
  if (stored) {
    if (stored.expiresAt > Date.now()) {
      recordIdempotencyReplay(scope.route)
      return replay(stored, clientKey)
    }
    completed.delete(key)
  }

  const running = inFlight.get(key)
  if (running) {
    const result = await running
    if (result) {
      recordIdempotencyReplay(scope.route)
      return replay(result, clientKey)
    }
    // The original attempt failed in a retryable way (5xx/429) and left nothing
    // to replay, so this request runs on its own.
    return handler()
  }

  const execution = (async (): Promise<{ response: NextResponse; stored: StoredResult | null }> => {
    const response = await handler()
    if (!isStorable(response.status)) return { response, stored: null }

    let body: unknown
    try {
      body = await response.clone().json()
    } catch {
      return { response, stored: null }
    }

    enforceCapacity()
    completed.set(key, { status: response.status, body, expiresAt: Date.now() + TTL_MS })
    recordIdempotencyStored()
    return { response, stored: { status: response.status, body } }
  })()

  inFlight.set(
    key,
    execution.then(({ stored }) => stored).catch(() => null),
  )

  try {
    // The originating caller always receives the handler's own response, so
    // cookies and headers set by the route survive untouched.
    const { response } = await execution
    return response
  } finally {
    inFlight.delete(key)
  }
}

/** Stored and in-flight key counts — surfaced through /api/health. */
export function idempotencyStats(): { stored: number; inFlight: number } {
  return { stored: completed.size, inFlight: inFlight.size }
}
