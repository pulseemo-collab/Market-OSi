/**
 * Cross-instance duplicate-write protection.
 *
 * The scenario is the one the in-process map could not handle: a POS terminal
 * retries a sale, and the retry is routed to a *different* serverless instance
 * than the original. Nothing is shared between them except PostgreSQL, so the
 * database has to be what decides which request executes.
 *
 * "Instance" here means a separate module-level cache. Each simulated instance
 * calls `withIdempotency` through its own fresh copy of `src/lib/idempotency`,
 * while all of them share one fake `IdempotencyRecord` table — exactly the
 * topology of a Vercel deployment.
 */

import test, { afterEach, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest, NextResponse } from 'next/server'

import {
  acquireClaim,
  completeClaim,
  releaseClaim,
  setIdempotencyClient,
  IDEMPOTENCY_STORE_LIMITS,
} from '../src/lib/idempotency-store'
import { createFakeIdempotencyClient } from './fake-idempotency-client'

const store = createFakeIdempotencyClient()

before(() => setIdempotencyClient(store))
after(() => setIdempotencyClient(null))
afterEach(() => {
  store.breakStore(false)
  store.reset()
})

const BASKET = JSON.stringify({ items: [{ productId: 1, sasia: 2 }] })

const scope = { route: 'POST /api/sales', organizationId: 1, userId: 'user-a' }
const parts = { ...scope, key: 'key-1' }

function saleRequest(key: string | null, body: string = BASKET): NextRequest {
  return new NextRequest('http://localhost/api/sales', {
    method: 'POST',
    headers: key ? { 'Idempotency-Key': key, 'content-type': 'application/json' } : {},
    body,
  })
}

/**
 * A separate application instance.
 *
 * `withIdempotency` keeps its dedup cache in module scope, so a fresh module
 * registry is what makes two callers genuinely independent — the same way two
 * Vercel lambdas are. They still share the fake table underneath.
 */
function instance(): typeof import('../src/lib/idempotency') {
  const modulePath = require.resolve('../src/lib/idempotency')
  delete require.cache[modulePath]
  const loaded = require('../src/lib/idempotency') as typeof import('../src/lib/idempotency')
  delete require.cache[modulePath]
  return loaded
}

// ---------------------------------------------------------------------------
// The claim protocol
// ---------------------------------------------------------------------------

test('only one of two concurrent claims on the same key is granted', async () => {
  const [a, b] = await Promise.all([
    acquireClaim(parts, 'fp-1'),
    acquireClaim(parts, 'fp-1'),
  ])

  const granted = [a, b].filter((r) => r.outcome === 'claimed')
  assert.equal(granted.length, 1, 'the unique constraint must admit exactly one owner')
  assert.equal(store.size(), 1, 'and leave exactly one row behind')

  // The loser is told to wait, never handed a claim of its own.
  const loser = [a, b].find((r) => r.outcome !== 'claimed')!
  assert.equal(loser.outcome, 'in_progress')
})

test('a settled claim is replayed to a later duplicate', async () => {
  const claim = await acquireClaim(parts, 'fp-1')
  assert.equal(claim.outcome, 'claimed')

  await completeClaim(
    (claim as { recordId: number }).recordId,
    parts.organizationId,
    201,
    { saleId: 42 },
  )

  const second = await acquireClaim(parts, 'fp-1')
  assert.equal(second.outcome, 'replay')
  assert.deepEqual(second, { outcome: 'replay', status: 201, body: { saleId: 42 } })
})

test('the same key with a different payload is refused, not replayed', async () => {
  const claim = await acquireClaim(parts, 'fp-1')
  await completeClaim((claim as { recordId: number }).recordId, 1, 201, { saleId: 42 })

  const different = await acquireClaim(parts, 'fp-DIFFERENT')
  assert.equal(different.outcome, 'conflict')
})

test('a released claim leaves the key free for the next attempt', async () => {
  const claim = await acquireClaim(parts, 'fp-1')
  await releaseClaim((claim as { recordId: number }).recordId, 1)

  assert.equal(store.size(), 0, 'a failed attempt must not leave a row behind')
  assert.equal((await acquireClaim(parts, 'fp-1')).outcome, 'claimed')
})

test('an expired claim is stolen by exactly one of several waiting requests', async () => {
  const claim = await acquireClaim(parts, 'fp-1')
  assert.equal(claim.outcome, 'claimed')

  // The instance holding the claim died. Its lease lapses.
  expire(parts)

  const results = await Promise.all([
    acquireClaim(parts, 'fp-2'),
    acquireClaim(parts, 'fp-2'),
    acquireClaim(parts, 'fp-2'),
  ])

  const claimed = results.filter((r) => r.outcome === 'claimed')
  assert.equal(claimed.length, 1, 'a crashed instance must not pin the key, nor free it twice')
  assert.equal(store.size(), 1)
})

test('an expired completed record stops being replayable', async () => {
  const claim = await acquireClaim(parts, 'fp-1')
  await completeClaim((claim as { recordId: number }).recordId, 1, 201, { saleId: 42 })

  assert.equal((await acquireClaim(parts, 'fp-1')).outcome, 'replay')

  expire(parts)

  // Past its window the key is reusable, so a terminal reusing an old key days
  // later gets a real sale rather than a stale receipt.
  assert.equal((await acquireClaim(parts, 'fp-1')).outcome, 'claimed')
})

test('a claim lease is bounded, so a crash cannot pin a key indefinitely', async () => {
  await acquireClaim(parts, 'fp-1')
  const row = store.rows()[0]

  const leaseMs = row.expiresAt.getTime() - row.claimedAt.getTime()
  assert.ok(leaseMs > 0 && leaseMs <= 120_000, `lease of ${leaseMs}ms must be short and finite`)
  assert.equal(leaseMs, IDEMPOTENCY_STORE_LIMITS.claimLeaseMs)
})

test('an oversized response is not stored, and releases the key instead', async () => {
  const claim = await acquireClaim(parts, 'fp-1')
  const huge = { blob: 'x'.repeat(IDEMPOTENCY_STORE_LIMITS.maxBodyChars + 1) }

  const settled = await completeClaim((claim as { recordId: number }).recordId, 1, 201, huge)

  assert.equal(settled, false)
  assert.equal(store.size(), 0, 'unbounded rows on the hottest write path is the risk here')
})

// ---------------------------------------------------------------------------
// Tenant and scope isolation
// ---------------------------------------------------------------------------

test('the same key in another organization is a different claim', async () => {
  assert.equal((await acquireClaim(parts, 'fp-1')).outcome, 'claimed')
  assert.equal(
    (await acquireClaim({ ...parts, organizationId: 2 }, 'fp-1')).outcome,
    'claimed',
  )
  assert.equal(store.size(), 2, 'tenants must not contend for one another’s keys')
})

test('the same key from another user or route is a different claim', async () => {
  assert.equal((await acquireClaim(parts, 'fp-1')).outcome, 'claimed')
  assert.equal((await acquireClaim({ ...parts, userId: 'user-b' }, 'fp-1')).outcome, 'claimed')
  assert.equal(
    (await acquireClaim({ ...parts, route: 'POST /api/supplies' }, 'fp-1')).outcome,
    'claimed',
  )
  assert.equal(store.size(), 3)
})

test('one tenant cannot settle or release another tenant claim', async () => {
  const claim = await acquireClaim(parts, 'fp-1')
  const recordId = (claim as { recordId: number }).recordId

  // Tenant 2 naming tenant 1's row id must affect nothing: organizationId is
  // part of every write's WHERE clause, not merely of the lookup that found it.
  assert.equal(await completeClaim(recordId, 2, 201, { stolen: true }), false)
  await releaseClaim(recordId, 2)

  assert.equal(store.size(), 1)
  assert.equal(store.rows()[0].status, 'in_progress')
  assert.equal(store.rows()[0].responseStatus, null)
})

// ---------------------------------------------------------------------------
// End to end, across instances
// ---------------------------------------------------------------------------

test('a retry routed to a second instance replays instead of selling twice', async () => {
  const first = instance()
  const second = instance()

  let sales = 0
  const handler = async () => {
    sales += 1
    return NextResponse.json({ saleId: sales }, { status: 201 })
  }

  const a = await first.withIdempotency(saleRequest('k-cross'), scope, handler)
  const b = await second.withIdempotency(saleRequest('k-cross'), scope, handler)

  // The failure this whole feature exists to prevent.
  assert.equal(sales, 1, 'the sale must be created exactly once across instances')
  assert.equal(b.headers.get('Idempotent-Replay'), 'true')

  const original = await a.json()
  assert.deepEqual(await b.json(), original)
  assert.equal(original.saleId, 1)
})

test('simultaneous duplicates on two instances execute one write', async () => {
  const first = instance()
  const second = instance()

  let sales = 0
  const handler = async () => {
    sales += 1
    await new Promise((r) => setTimeout(r, 30))
    return NextResponse.json({ saleId: sales }, { status: 201 })
  }

  const [a, b] = await Promise.all([
    first.withIdempotency(saleRequest('k-race'), scope, handler),
    second.withIdempotency(saleRequest('k-race'), scope, handler),
  ])

  assert.equal(sales, 1, 'exactly one instance may run the handler')

  // The loser waits for the winner and replays it, rather than erroring.
  const statuses = [a.status, b.status].sort()
  assert.deepEqual(statuses, [201, 201])
  assert.deepEqual(await a.json(), await b.json())
})

test('a key reused with a different basket on another instance is refused', async () => {
  const first = instance()
  const second = instance()
  const sale = async () => NextResponse.json({ saleId: 1 }, { status: 201 })

  await first.withIdempotency(saleRequest('k-reuse'), scope, sale)

  let executed = 0
  const response = await second.withIdempotency(
    saleRequest('k-reuse', JSON.stringify({ items: [{ productId: 99, sasia: 7 }] })),
    scope,
    async () => {
      executed += 1
      return NextResponse.json({ saleId: 2 }, { status: 201 })
    },
  )

  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'CONFLICT')
  assert.equal(executed, 0)
})

test('a transient failure on one instance leaves the key usable on another', async () => {
  const first = instance()
  const second = instance()

  const failing = async () => NextResponse.json({ error: 'db down' }, { status: 503 })
  const succeeding = async () => NextResponse.json({ saleId: 1 }, { status: 201 })

  const a = await first.withIdempotency(saleRequest('k-transient'), scope, failing)
  assert.equal(a.status, 503)
  assert.equal(store.size(), 0, 'a 5xx must release the claim, not poison the key')

  const b = await second.withIdempotency(saleRequest('k-transient'), scope, succeeding)
  assert.equal(b.status, 201, 'the retry must be allowed to succeed')
})

test('a stock conflict on one instance does not pin the key on another', async () => {
  const first = instance()
  const second = instance()

  const a = await first.withIdempotency(saleRequest('k-stock'), scope, async () =>
    NextResponse.json({ error: 'stoku ndryshoi' }, { status: 409 }),
  )
  assert.equal(a.status, 409)

  // After a restock the same key must be able to sell.
  const b = await second.withIdempotency(saleRequest('k-stock'), scope, async () =>
    NextResponse.json({ saleId: 1 }, { status: 201 }),
  )
  assert.equal(b.status, 201)
})

test('a thrown handler releases the claim', async () => {
  const only = instance()

  await assert.rejects(
    only.withIdempotency(saleRequest('k-throw'), scope, async () => {
      throw new Error('kaboom')
    }),
    /kaboom/,
  )

  assert.equal(store.size(), 0, 'an exception must not leave a key claimed until its lease ends')
})

test('an unreachable store degrades to same-instance protection, never to refusal', async () => {
  const only = instance()
  store.breakStore(true)

  let sales = 0
  const handler = async () => {
    sales += 1
    return NextResponse.json({ saleId: sales }, { status: 201 })
  }

  // A dedup table that is down must not stop a shop from selling.
  const a = await only.withIdempotency(saleRequest('k-degraded'), scope, handler)
  assert.equal(a.status, 201)

  // Same-instance protection still holds while degraded.
  const b = await only.withIdempotency(saleRequest('k-degraded'), scope, handler)
  assert.equal(sales, 1)
  assert.equal(b.headers.get('Idempotent-Replay'), 'true')

  assert.ok(only.idempotencyStats().durableFailures > 0, 'degradation must be observable')
})

test('requests without a key never touch the store', async () => {
  const only = instance()
  let sales = 0

  await only.withIdempotency(saleRequest(null), scope, async () => {
    sales += 1
    return NextResponse.json({ saleId: sales }, { status: 201 })
  })

  assert.equal(store.size(), 0)
  assert.equal(store.insertAttempts(), 0, 'opting out must cost nothing')
})

test('no request payload is ever persisted', async () => {
  const only = instance()
  const secret = 'CUSTOMER-CARD-4111111111111111'

  await only.withIdempotency(
    saleRequest('k-privacy', JSON.stringify({ items: [], note: secret })),
    scope,
    async () => NextResponse.json({ saleId: 1 }, { status: 201 }),
  )

  const persisted = JSON.stringify(store.rows())
  assert.equal(persisted.includes(secret), false, 'only a fingerprint of the body may be stored')
  assert.ok(store.rows()[0].fingerprint.length > 0)
})

// ---------------------------------------------------------------------------

/** Ages a record past its lease/replay window, as wall-clock time would. */
function expire(target: { organizationId: number; userId: string; route: string; key: string }) {
  const row = store
    .rows()
    .find(
      (r) =>
        r.organizationId === target.organizationId &&
        r.userId === target.userId &&
        r.route === target.route &&
        r.key === target.key,
    )
  assert.ok(row, 'expected a record to expire')

  // Mutate the live row, not the defensive copy returned by rows().
  void store.idempotencyRecord.updateMany({
    where: { id: row.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  })
}
