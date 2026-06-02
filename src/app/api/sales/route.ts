import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { createNotification, NOTIFICATION_TYPES, NOTIFICATION_SEVERITIES } from '@/lib/notifications'

const LARGE_SALE_THRESHOLD = parseInt(process.env.LARGE_SALE_THRESHOLD || '5000')

export async function GET(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('sales:read')
  if (error) return error

  const rl = rateLimit(req, 'sales', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const { searchParams } = new URL(req.url)
    const periudha = searchParams.get('periudha') || 'sot'
    const dataParam = searchParams.get('data') // YYYY-MM-DD for exact date filter

    // Exact date filter
    if (dataParam) {
      const d = new Date(dataParam)
      const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
      const dateEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)
      const salesByDate = await prisma.sale.findMany({
        where: { organizationId: organizationId!, createdAt: { gte: dateStart, lt: dateEnd } },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json(salesByDate)
    }

    const now = new Date()
    let dateFrom: Date

    switch (periudha) {
      case 'sot':
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'dje': {
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 1)
        dateFrom.setHours(0, 0, 0, 0)
        const djeTomorrow = new Date(dateFrom)
        djeTomorrow.setDate(djeTomorrow.getDate() + 1)
        const salesDje = await prisma.sale.findMany({
          where: {
            organizationId: organizationId!,
            createdAt: { gte: dateFrom, lt: djeTomorrow },
          },
          include: { items: { include: { product: true } } },
          orderBy: { createdAt: 'desc' },
        })
        return NextResponse.json(salesDje)
      }
      case 'jave':
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 7)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'muaj':
        dateFrom = new Date(now)
        dateFrom.setDate(1)
        dateFrom.setHours(0, 0, 0, 0)
        break
      default:
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
    }

    const sales = await prisma.sale.findMany({
      where: {
        organizationId: organizationId!,
        createdAt: { gte: dateFrom },
      },
      include: {
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(sales)
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/sales', action: 'GET' })
    console.error('Sales GET error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('sales:create')
  if (error) return error

  const rl = rateLimit(req, 'sales', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const body = await req.json()
    const { items, shenime, paymentMethod } = body
    const validPaymentMethod = ['cash', 'bank'].includes(paymentMethod) ? paymentMethod : 'cash'

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Nuk ka produkte në shitje' },
        { status: 400 }
      )
    }

    let totali = 0
    let fitimi = 0

    for (const item of items) {
      const product = await prisma.product.findFirst({
        where: { id: item.productId, organizationId: organizationId! },
      })

      if (!product) {
        return NextResponse.json(
          { error: `Produkti nuk u gjet: ${item.emriProduktit}` },
          { status: 404 }
        )
      }

      if (product.sasia < item.sasia) {
        return NextResponse.json(
          { error: `Stoku i pamjaftueshëm për: ${product.emri}. Stoku: ${product.sasia}` },
          { status: 400 }
        )
      }

      totali += product.cmimiShitjes * item.sasia
      fitimi += (product.cmimiShitjes - product.cmimiBlerjes) * item.sasia
    }

    const sale = await prisma.$transaction(async (tx) => {
      const newSale = await tx.sale.create({
        data: {
          totali,
          fitimi,
          shenime: shenime || null,
          paymentMethod: validPaymentMethod,
          organizationId: organizationId!,
          items: {
            create: await Promise.all(
              items.map(async (item: {
                productId: number
                emriProduktit: string
                sasia: number
                cmimiBlerjes: number
                cmimiShitjes: number
              }) => {
                const product = await tx.product.findFirst({
                  where: { id: item.productId, organizationId: organizationId! },
                })
                return {
                  productId: item.productId,
                  emriProduktit: item.emriProduktit,
                  sasia: item.sasia,
                  cmimiBlerjes: product!.cmimiBlerjes,
                  cmimiShitjes: product!.cmimiShitjes,
                  fitimi: (product!.cmimiShitjes - product!.cmimiBlerjes) * item.sasia,
                }
              })
            ),
          },
        },
        include: { items: { include: { product: true } } },
      })

      for (const item of items) {
        await tx.product.updateMany({
          where: { id: item.productId, organizationId: organizationId! },
          data: { sasia: { decrement: item.sasia } },
        })
      }

      return newSale
    })

    const methodLabel = validPaymentMethod === 'cash' ? 'Cash' : 'Bankë'
    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.CREATE,
      entityType: AUDIT_ENTITY_TYPES.SALE,
      entityId: sale.id,
      description: `Shitje e re #${sale.id} — ${sale.totali.toFixed(2)} L (${methodLabel}, ${sale.items.length} produkte)`,
      metadata: { totali: sale.totali, fitimi: sale.fitimi, paymentMethod: validPaymentMethod },
    })

    // Trigger LARGE_SALE notification (assigned to the seller)
    if (sale.totali >= LARGE_SALE_THRESHOLD) {
      await createNotification({
        organizationId: organizationId!,
        userId: userId!,
        type: NOTIFICATION_TYPES.LARGE_SALE,
        title: 'Shitje e Madhe',
        message: `Shitja #${sale.id} arriti ${sale.totali.toFixed(0)} L (${sale.items.length} produkte, ${methodLabel})`,
        severity: NOTIFICATION_SEVERITIES.MEDIUM,
        metadata: { saleId: sale.id, totali: sale.totali, fitimi: sale.fitimi, paymentMethod: validPaymentMethod },
      })
    }

    // Trigger LOW_STOCK notifications for products that went below minimum
    const soldProductIds = items.map((i: { productId: number }) => i.productId)
    const updatedProducts = await prisma.product.findMany({
      where: { id: { in: soldProductIds }, organizationId: organizationId! },
      select: { id: true, emri: true, sasia: true, stokuMinimal: true, njesia: true },
    })

    // Deduplication: skip products that already have a recent unread LOW_STOCK notification
    const recentLowStock = await prisma.notification.findMany({
      where: {
        organizationId: organizationId!,
        type: NOTIFICATION_TYPES.LOW_STOCK,
        isRead: false,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { metadata: true },
    })
    const recentProductIds = new Set(
      recentLowStock
        .map((n) => (n.metadata as Record<string, unknown> | null)?.productId as number | undefined)
        .filter((id): id is number => id != null)
    )

    for (const product of updatedProducts) {
      if (product.sasia <= product.stokuMinimal && !recentProductIds.has(product.id)) {
        const isCritical = product.sasia <= 0
        await createNotification({
          organizationId: organizationId!,
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
    }

    return NextResponse.json(sale, { status: 201 })
  } catch (error) {
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/sales', action: 'POST' })
    console.error('Sales POST error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}
