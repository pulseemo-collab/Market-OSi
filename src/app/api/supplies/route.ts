import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'

export async function GET() {
  const { organizationId, error } = await requirePermission('supplies:read')
  if (error) return error

  try {
    const supplies = await prisma.supply.findMany({
      where: { organizationId: organizationId! },
      include: {
        furnitor: { select: { id: true, emri: true } },
        items: {
          include: {
            product: { select: { id: true, emri: true, njesia: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(supplies)
  } catch (error) {
    console.error('Supplies GET error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('supplies:write')
  if (error) return error

  try {
    const body = await req.json()
    const { furnitorId, data, shenime, items } = body

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Nuk ka produkte në furnizim' }, { status: 400 })
    }

    for (const item of items) {
      if (!item.productId) {
        return NextResponse.json({ error: 'Produkti është i pavlefshëm' }, { status: 400 })
      }
      if (typeof item.sasia !== 'number' || item.sasia <= 0) {
        return NextResponse.json(
          { error: `Sasia duhet të jetë pozitive për: ${item.emriProduktit}` },
          { status: 400 }
        )
      }
      if (typeof item.cmimiBlerjes !== 'number' || item.cmimiBlerjes < 0) {
        return NextResponse.json(
          { error: `Çmimi i blerjes i pavlefshëm për: ${item.emriProduktit}` },
          { status: 400 }
        )
      }
    }

    const totali = items.reduce(
      (sum: number, item: { sasia: number; cmimiBlerjes: number }) =>
        sum + item.sasia * item.cmimiBlerjes,
      0
    )

    const supply = await prisma.$transaction(async (tx) => {
      const newSupply = await tx.supply.create({
        data: {
          furnitorId: furnitorId ? Number(furnitorId) : null,
          data: data ? new Date(data) : new Date(),
          shenime: shenime || null,
          totali,
          organizationId: organizationId!,
          items: {
            create: items.map((item: {
              productId: number
              emriProduktit: string
              sasia: number
              njesia: string
              cmimiBlerjes: number
            }) => ({
              productId: item.productId,
              emriProduktit: item.emriProduktit,
              sasia: item.sasia,
              njesia: item.njesia,
              cmimiBlerjes: item.cmimiBlerjes,
              totali: item.sasia * item.cmimiBlerjes,
            })),
          },
        },
        include: {
          furnitor: { select: { id: true, emri: true } },
          items: {
            include: { product: { select: { id: true, emri: true, njesia: true } } },
          },
        },
      })

      for (const item of items) {
        await tx.product.updateMany({
          where: { id: item.productId, organizationId: organizationId! },
          data: {
            sasia: { increment: item.sasia },
            ...(item.updatePrice ? { cmimiBlerjes: item.cmimiBlerjes } : {}),
          },
        })
      }

      return newSupply
    })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.CREATE,
      entityType: AUDIT_ENTITY_TYPES.SUPPLY,
      entityId: supply.id,
      description: `Furnizim i ri u krijua — ${supply.items.length} produkte, totali ${supply.totali.toFixed(2)} L`,
      metadata: { totali: supply.totali, numriProdukteve: supply.items.length, furnitorId },
    })

    return NextResponse.json(supply, { status: 201 })
  } catch (error) {
    console.error('Supplies POST error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}
