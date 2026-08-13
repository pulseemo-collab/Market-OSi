/**
 * Duplicate-write protection.
 *
 * The scenario throughout is a POS terminal on a bad connection: the cashier
 * taps "Shit", the request times out or the browser retries, and the same sale
 * arrives twice. Exactly one sale must exist afterwards.
 */

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest, NextResponse } from 'next/server'

import { withIdempotency } from '../src/lib/idempotency'
import { setIdempotencyClient } from '../src/lib/idempotency-store'
import { createFakeIdempotencyClient } from './fake-idempotency-client'

// These assertions describe behaviour the caller sees, which is now produced by
// the in-process cache and the durable claim together. Backing the durable half
// with the fake table exercises both rather than silently testing only the
// cache. Cross-instance behaviour is covered in idempotency-durable.test.ts.
const store = createFakeIdempotencyClient()

before(() => setIdempotencyClient(store))
after(() => setIdempotencyClient(null))

const BASKET = JSON.stringify({ items: [{ productId: 1, sasia: 2 }] })

function saleRequest(key: string | null, body: string = BASKET): NextRequest {
  return new NextRequest('http://localhost/api/sales', {
    method: 'POST',
    headers: key ? { 'Idempotency-Key': key, 'content-type': 'application/json' } : {},
    body,
  })
}

const scope = { route: 'POST /api/sales', organizationId: 1, userId: 'user-a' }

/** Counts executions and returns a distinct sale id each time. */
function saleHandler() {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    handler: async () => {
      calls += 1
      return NextResponse.json({ saleId: calls }, { status: 201 })
    },
  }
}

test('a retried request replays the first response instead of selling twice', async () => {
  const key = `k-${Math.random()}`
  const sale = saleHandler()

  const first = await withIdempotency(saleRequest(key), scope, sale.handler)
  const second = await withIdempotency(saleRequest(key), scope, sale.handler)

  assert.equal(sale.calls, 1, 'the sale must be created exactly once')
  assert.equal(second.status, 201)
  assert.equal(second.headers.get('Idempotent-Replay'), 'true')
  assert.deepEqual(await second.json(), await first.json())
})

test('concurrent duplicates join the in-flight sale rather than starting a second', async () => {
  const key = `k-${Math.random()}`
  let calls = 0

  const handler = async () => {
    calls += 1
    await new Promise((r) => setTimeout(r, 40))
    return NextResponse.json({ saleId: calls }, { status: 201 })
  }

  // A double tap: both requests are in flight before either has committed.
  const [a, b] = await Promise.all([
    withIdempotency(saleRequest(key), scope, handler),
    withIdempotency(saleRequest(key), scope, handler),
  ])

  assert.equal(calls, 1)
  assert.deepEqual(await a.json(), await b.json())
})

test('requests without a key are unaffected', async () => {
  const sale = saleHandler()

  await withIdempotency(saleRequest(null), scope, sale.handler)
  await withIdempotency(saleRequest(null), scope, sale.handler)

  // Adding the wrapper must not change behaviour for a client that never opted in.
  assert.equal(sale.calls, 2)
})

test('the same key from another organization is a different operation', async () => {
  const key = `k-${Math.random()}`
  const sale = saleHandler()

  await withIdempotency(saleRequest(key), scope, sale.handler)
  await withIdempotency(saleRequest(key), { ...scope, organizationId: 2 }, sale.handler)

  // Cross-tenant collision here would leak one organization's response body to
  // another — the isolation guarantee has to hold inside the reliability layer.
  assert.equal(sale.calls, 2)
})

test('the same key from another user is a different operation', async () => {
  const key = `k-${Math.random()}`
  const sale = saleHandler()

  await withIdempotency(saleRequest(key), scope, sale.handler)
  await withIdempotency(saleRequest(key), { ...scope, userId: 'user-b' }, sale.handler)

  assert.equal(sale.calls, 2)
})

test('the same key on another route is a different operation', async () => {
  const key = `k-${Math.random()}`
  const sale = saleHandler()

  await withIdempotency(saleRequest(key), scope, sale.handler)
  await withIdempotency(saleRequest(key), { ...scope, route: 'POST /api/supplies' }, sale.handler)

  assert.equal(sale.calls, 2)
})

test('a key reused with a different basket is refused, not silently replayed', async () => {
  const key = `k-${Math.random()}`
  const sale = saleHandler()

  await withIdempotency(saleRequest(key), scope, sale.handler)

  const different = await withIdempotency(
    saleRequest(key, JSON.stringify({ items: [{ productId: 99, sasia: 7 }] })),
    scope,
    sale.handler,
  )

  // Replaying here would discard a genuine second sale and report the first
  // one's total back to the cashier.
  assert.equal(different.status, 409)
  assert.equal(sale.calls, 1)
  assert.equal((await different.json()).code, 'CONFLICT')
})

test('a server error is not stored, so the write stays retryable', async () => {
  const key = `k-${Math.random()}`
  let calls = 0

  const flaky = async () => {
    calls += 1
    return calls === 1
      ? NextResponse.json({ error: 'db down' }, { status: 503 })
      : NextResponse.json({ saleId: 1 }, { status: 201 })
  }

  const first = await withIdempotency(saleRequest(key), scope, flaky)
  const second = await withIdempotency(saleRequest(key), scope, flaky)

  assert.equal(first.status, 503)
  assert.equal(second.status, 201, 'a transient failure must not poison the key')
  assert.equal(calls, 2)
})

test('a stock conflict is not pinned, so the sale can be retried after a restock', async () => {
  const key = `k-${Math.random()}`
  let calls = 0

  const handler = async () => {
    calls += 1
    return calls === 1
      ? NextResponse.json({ error: 'stoku ndryshoi' }, { status: 409 })
      : NextResponse.json({ saleId: 1 }, { status: 201 })
  }

  const first = await withIdempotency(saleRequest(key), scope, handler)
  const second = await withIdempotency(saleRequest(key), scope, handler)

  // 409 means nothing was committed, so replaying it is not needed for safety —
  // and would leave the cashier stuck on a stale rejection for the whole TTL.
  assert.equal(first.status, 409)
  assert.equal(second.status, 201)
})

test('a client error is stored, since the outcome is settled', async () => {
  const key = `k-${Math.random()}`
  const sale = saleHandler()

  const reject = async () => {
    sale.handler()
    return NextResponse.json({ error: 'basket empty' }, { status: 400 })
  }

  const first = await withIdempotency(saleRequest(key), scope, reject)
  const second = await withIdempotency(saleRequest(key), scope, reject)

  assert.equal(first.status, 400)
  assert.equal(second.status, 400)
  assert.equal(second.headers.get('Idempotent-Replay'), 'true')
})

test('the handler can still read the body after the wrapper fingerprints it', async () => {
  const key = `k-${Math.random()}`
  const req = saleRequest(key)

  // The wrapper reads the payload through a clone. If it consumed the original
  // stream instead, every wrapped route would fail at its own req.json().
  const response = await withIdempotency(req, scope, async () => {
    const body = await req.json()
    return NextResponse.json({ received: body.items.length }, { status: 201 })
  })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { received: 1 })
})

test('the originating caller receives the handler own response, headers intact', async () => {
  const key = `k-${Math.random()}`

  const response = await withIdempotency(saleRequest(key), scope, async () => {
    const res = NextResponse.json({ saleId: 1 }, { status: 201 })
    res.headers.set('X-Custom', 'preserved')
    return res
  })

  // Only replays are reconstructed; the first caller must get the real response
  // so route-set cookies and headers survive.
  assert.equal(response.headers.get('X-Custom'), 'preserved')
  assert.equal(response.headers.get('Idempotent-Replay'), null)
})
