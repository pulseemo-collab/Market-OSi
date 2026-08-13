/**
 * Inventory concurrency and transaction-rollback behaviour.
 *
 * `applyStockDeltas` is exercised against a fake transaction client that
 * reproduces the one PostgreSQL property the design depends on: an UPDATE with
 * a `sasia >= required` predicate matches zero rows when stock has already
 * fallen below the requirement. Every assertion here is about the application's
 * reaction to that outcome — the database's own guarantee is not being tested,
 * it is being assumed, and it is documented in src/lib/stock.ts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { applyStockDeltas, netDeltas, sumByProduct } from '../src/lib/stock'
import { StockConflictError } from '../src/lib/errors'

interface Update {
  id: number
  organizationId: number
  gte?: number
  change: number
}

/** Fake transaction client with the guarded-update semantics of PostgreSQL. */
function fakeTx(stock: Record<number, number>) {
  const updates: Update[] = []

  return {
    updates,
    stock,
    product: {
      async updateMany(args: {
        where: { id: number; organizationId: number; sasia?: { gte: number } }
        data: { sasia: { increment: number } | { decrement: number } }
      }): Promise<{ count: number }> {
        const { id, organizationId, sasia } = args.where
        const current = stock[id] ?? 0

        // The precondition is re-evaluated against current state, exactly as
        // the WHERE clause is re-evaluated after the row lock is taken.
        if (sasia !== undefined && current < sasia.gte) {
          updates.push({ id, organizationId, gte: sasia.gte, change: 0 })
          return { count: 0 }
        }

        const change =
          'increment' in args.data.sasia ? args.data.sasia.increment : -args.data.sasia.decrement

        stock[id] = current + change
        updates.push({ id, organizationId, gte: sasia?.gte, change })
        return { count: 1 }
      },
    },
  }
}

test('sumByProduct collapses repeated lines for the same product', () => {
  const totals = sumByProduct([
    { productId: 7, sasia: 1 },
    { productId: 7, sasia: 1 },
    { productId: 9, sasia: 3 },
  ])

  // The bug this prevents: two lines of one unit each, validated separately
  // against a stock of one, both passing.
  assert.equal(totals.get(7), 2)
  assert.equal(totals.get(9), 3)
})

test('netDeltas returns stock released by an edited sale and takes what it now needs', () => {
  const deltas = netDeltas(
    sumByProduct([{ productId: 1, sasia: 5 }, { productId: 2, sasia: 2 }]),
    sumByProduct([{ productId: 1, sasia: 3 }, { productId: 3, sasia: 4 }]),
  )

  assert.equal(deltas.get(1), 2) // held 5, now holds 3 → returns 2
  assert.equal(deltas.get(2), 2) // dropped entirely → returns 2
  assert.equal(deltas.get(3), -4) // newly added → consumes 4
})

test('a decrement within stock succeeds and writes each product once', async () => {
  const tx = fakeTx({ 1: 10, 2: 5 })

  await applyStockDeltas(tx, new Map([[1, -3], [2, -5]]), { organizationId: 42 })

  assert.equal(tx.stock[1], 7)
  assert.equal(tx.stock[2], 0)
  assert.equal(tx.updates.length, 2)
})

test('concurrent sale of the last unit: the loser gets StockConflictError, not negative stock', async () => {
  // Both cashiers read stock = 1 before either commits, so both reach the
  // decrement. This is precisely the race the guard exists for.
  const shared = { 1: 1 }
  const first = fakeTx(shared)
  const second = fakeTx(shared)

  await applyStockDeltas(first, new Map([[1, -1]]), {
    organizationId: 42,
    nameOf: () => 'Buka',
  })

  await assert.rejects(
    () =>
      applyStockDeltas(second, new Map([[1, -1]]), {
        organizationId: 42,
        nameOf: () => 'Buka',
      }),
    (error: unknown) => {
      assert.ok(error instanceof StockConflictError)
      assert.equal(error.status, 409)
      assert.match(error.clientMessage, /Buka/)
      // Not retryable: the basket must be re-priced against real stock, and a
      // blind retry would just lose the race again.
      assert.equal(error.retryable, false)
      return true
    },
  )

  assert.equal(shared[1], 0, 'stock must never go negative')
})

test('a failed decrement stops before later products are touched', async () => {
  const tx = fakeTx({ 1: 10, 2: 0, 3: 10 })

  await assert.rejects(
    () => applyStockDeltas(tx, new Map([[1, -1], [2, -1], [3, -1]]), { organizationId: 42 }),
    StockConflictError,
  )

  // Product 1 was decremented before the failure. That write is not undone
  // here — it is undone by the surrounding transaction rolling back, which is
  // why every caller of applyStockDeltas runs inside prisma.$transaction.
  assert.equal(tx.stock[3], 10, 'work after the conflict must not run')
  assert.equal(tx.updates.length, 2)
})

test('products are always locked in ascending id order', async () => {
  const tx = fakeTx({ 1: 10, 5: 10, 9: 10 })

  await applyStockDeltas(tx, new Map([[9, -1], [1, -1], [5, -1]]), { organizationId: 42 })

  assert.deepEqual(
    tx.updates.map((u) => u.id),
    [1, 5, 9],
    'a shared lock order is what makes deadlock between overlapping baskets unreachable',
  )
})

test('returning stock carries no precondition', async () => {
  const tx = fakeTx({ 1: 0 })

  await applyStockDeltas(tx, new Map([[1, 4]]), { organizationId: 42 })

  assert.equal(tx.stock[1], 4)
  assert.equal(tx.updates[0].gte, undefined, 'an increment must not be guarded')
})

test('zero deltas issue no write at all', async () => {
  const tx = fakeTx({ 1: 10 })

  await applyStockDeltas(tx, new Map([[1, 0]]), { organizationId: 42 })

  assert.equal(tx.updates.length, 0)
})

test('every update is scoped to the calling organization', async () => {
  const tx = fakeTx({ 1: 10, 2: 10 })

  await applyStockDeltas(tx, new Map([[1, -1], [2, 1]]), { organizationId: 7 })

  // Tenant isolation has to survive the reliability paths too: a guard that
  // dropped the organizationId would let one tenant's sale move another's stock.
  assert.ok(tx.updates.every((u) => u.organizationId === 7))
})
