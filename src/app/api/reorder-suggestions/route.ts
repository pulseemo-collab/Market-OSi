import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('reorder:read')
  if (error) return error

  const rl = rateLimit(req, 'dashboard', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const products = await prisma.product.findMany({
      where: { organizationId: organizationId! },
      include: { furnitor: true },
      orderBy: { emri: 'asc' },
    })

    const lowStock = products.filter((p) => p.sasia <= p.stokuMinimal)

    type GroupedItem = {
      id: number
      emri: string
      kategoria: string
      sasia: number
      stokuMinimal: number
      njesia: string
      cmimiBlerjes: number
      sasiaSugjeruar: number
    }

    type Group = {
      furnitorId: number | null
      furnitorEmri: string
      products: GroupedItem[]
    }

    const groupMap = new Map<string, Group>()

    for (const p of lowStock) {
      const key = p.furnitorId != null ? String(p.furnitorId) : '__none__'
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          furnitorId: p.furnitorId,
          furnitorEmri: p.furnitor?.emri ?? 'Pa Furnitor',
          products: [],
        })
      }
      const sasiaSugjeruar = Math.max(p.stokuMinimal * 2 - p.sasia, p.stokuMinimal)
      groupMap.get(key)!.products.push({
        id: p.id,
        emri: p.emri,
        kategoria: p.kategoria,
        sasia: p.sasia,
        stokuMinimal: p.stokuMinimal,
        njesia: p.njesia,
        cmimiBlerjes: p.cmimiBlerjes,
        sasiaSugjeruar,
      })
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => {
      if (a.furnitorId === null) return 1
      if (b.furnitorId === null) return -1
      return a.furnitorEmri.localeCompare(b.furnitorEmri)
    })

    return NextResponse.json({ totalProducts: lowStock.length, groups })
  } catch (error) {
    console.error('Reorder suggestions error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}
