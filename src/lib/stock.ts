/**
 * Atomic stock movement.
 *
 * Every path that moves inventory — creating a sale, editing one, deleting one,
 * receiving a supply — goes through here, so the two properties that make
 * concurrent inventory correct are stated once instead of being re-derived at
 * each call site:
 *
 *   1. A decrement carries its own precondition. `sasia >= required` lives in
 *      the UPDATE's WHERE clause, so PostgreSQL re-evaluates it against the
 *      committed row after taking the row lock. Two cashiers selling the last
 *      unit therefore serialise: the second update matches no rows and the
 *      caller rolls back. Reading stock in JavaScript and decrementing
 *      afterwards cannot give that guarantee, because both readers see the same
 *      pre-decrement value.
 *
 *   2. Rows are always touched in ascending product id. Two transactions
 *      holding overlapping baskets in opposite orders would each hold a row the
 *      other needs; a single global order makes that deadlock unreachable.
 *
 * Deltas are netted per product before any write, so each row is updated at
 * most once per transaction — fewer locks held, and no window in which stock is
 * visibly restored before being re-taken.
 */

import { StockConflictError } from './errors'

/**
 * The slice of a Prisma transaction client this module needs.
 *
 * Narrowing to it keeps the logic testable against a fake without constructing
 * a PrismaClient, and documents that nothing here reaches beyond `updateMany`.
 */
export interface StockClient {
  product: {
    updateMany(args: {
      where: { id: number; organizationId: number; sasia?: { gte: number } }
      data: { sasia: { increment: number } | { decrement: number } }
    }): Promise<{ count: number }>
  }
}

/** Sums per-line quantities into one movement per product. */
export function sumByProduct(
  items: Array<{ productId: number; sasia: number }>,
): Map<number, number> {
  const totals = new Map<number, number>()
  for (const item of items) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.sasia)
  }
  return totals
}

/**
 * Net movement per product: what the sale previously held, minus what it holds
 * now. Positive returns stock, negative consumes it.
 */
export function netDeltas(
  released: Map<number, number>,
  acquired: Map<number, number>,
): Map<number, number> {
  const deltas = new Map<number, number>()
  released.forEach((qty, productId) => {
    deltas.set(productId, (deltas.get(productId) ?? 0) + qty)
  })
  acquired.forEach((qty, productId) => {
    deltas.set(productId, (deltas.get(productId) ?? 0) - qty)
  })
  return deltas
}

export interface ApplyStockOptions {
  organizationId: number
  /** Resolves a product name for the conflict message shown to the cashier. */
  nameOf?: (productId: number) => string | undefined
}

/**
 * Applies netted stock deltas inside an open transaction.
 *
 * Throws `StockConflictError` if a decrement finds insufficient stock, which
 * aborts the caller's transaction and rolls back every write in it — the sale
 * and its items included. That is the guarantee: stock and sale move together
 * or not at all.
 */
export async function applyStockDeltas(
  tx: StockClient,
  deltas: Map<number, number>,
  options: ApplyStockOptions,
): Promise<void> {
  const { organizationId, nameOf } = options
  const orderedIds = Array.from(deltas.keys()).sort((a, b) => a - b)

  for (const productId of orderedIds) {
    const delta = deltas.get(productId)!
    if (delta === 0) continue

    if (delta > 0) {
      // Returning stock always succeeds; there is no precondition to check.
      await tx.product.updateMany({
        where: { id: productId, organizationId },
        data: { sasia: { increment: delta } },
      })
      continue
    }

    const required = -delta
    const updated = await tx.product.updateMany({
      where: { id: productId, organizationId, sasia: { gte: required } },
      data: { sasia: { decrement: required } },
    })

    if (updated.count === 0) {
      throw new StockConflictError(nameOf?.(productId) ?? `#${productId}`)
    }
  }
}
