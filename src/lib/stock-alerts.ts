/**
 * Low-stock notification fan-out, moved off the point-of-sale response path.
 *
 * After a sale the system re-reads the affected products, checks which ones
 * dropped to or below their minimum, de-duplicates against recent unread alerts
 * and inserts one notification per remaining product. On a large basket that is
 * several queries plus N inserts — work the cashier has no reason to wait for.
 *
 * The scan runs as a background job instead. The sale itself, its audit entry
 * and the stock decrement all stay on the request path and are still durable;
 * only the advisory alert is deferred.
 */

import { prisma } from './prisma'
import { enqueueJob, registerJob } from './jobs'
import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  createNotification,
} from './notifications'

const JOB_NAME = 'low-stock-scan'

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000

interface LowStockScanPayload {
  organizationId: number
  productIds: number[]
}

registerJob<LowStockScanPayload>(JOB_NAME, async ({ organizationId, productIds }) => {
  const [products, recentLowStock] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, emri: true, sasia: true, stokuMinimal: true, njesia: true },
    }),
    prisma.notification.findMany({
      where: {
        organizationId,
        type: NOTIFICATION_TYPES.LOW_STOCK,
        isRead: false,
        createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      },
      select: { metadata: true },
    }),
  ])

  const alreadyNotified = new Set(
    recentLowStock
      .map((n) => (n.metadata as Record<string, unknown> | null)?.productId as number | undefined)
      .filter((id): id is number => id != null),
  )

  for (const product of products) {
    if (product.sasia > product.stokuMinimal || alreadyNotified.has(product.id)) continue

    const isCritical = product.sasia <= 0
    await createNotification({
      organizationId,
      type: NOTIFICATION_TYPES.LOW_STOCK,
      title: isCritical ? 'Stok i Zbrazur' : 'Stok i Ulët',
      message: `"${product.emri}": ${product.sasia} ${product.njesia} (minimal: ${product.stokuMinimal})`,
      severity: isCritical ? NOTIFICATION_SEVERITIES.CRITICAL : NOTIFICATION_SEVERITIES.HIGH,
      metadata: {
        productId: product.id,
        productName: product.emri,
        currentStock: product.sasia,
        minimalStock: product.stokuMinimal,
      },
    })
  }
})

/** Schedules the post-sale low-stock check for the given products. */
export function queueLowStockScan(organizationId: number, productIds: number[]): void {
  if (productIds.length === 0) return
  enqueueJob<LowStockScanPayload>(
    JOB_NAME,
    { organizationId, productIds: Array.from(new Set(productIds)) },
    { organizationId },
  )
}
