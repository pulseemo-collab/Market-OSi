import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, cached, orgTag } from '@/lib/cache'

export const dynamic = 'force-dynamic'

async function buildSuggestions(organizationId: number) {
  const products = await prisma.product.findMany({
    where: { organizationId, isArchived: false },
    // Only the supplier's id and name are read below; the full row was never used.
    select: {
      id: true,
      emri: true,
      kategoria: true,
      sasia: true,
      stokuMinimal: true,
      njesia: true,
      cmimiBlerjes: true,
      furnitorId: true,
      furnitor: { select: { emri: true } },
    },
    orderBy: [{ emri: 'asc' }, { id: 'asc' }],
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

  return { totalProducts: lowStock.length, groups }
}

async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('reorder:read')
  if (error) return error

  const rl = rateLimit(req, 'dashboard', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    // Derived entirely from product stock levels, identical for every user in
    // the org, and evicted by any product or supply write.
    const suggestions = await cached(
      {
        namespace: 'reorder',
        organizationId: organizationId!,
        ttlMs: CACHE_TTL.reorder,
        tags: [orgTag(organizationId!, 'products'), orgTag(organizationId!, 'suppliers')],
      },
      () => buildSuggestions(organizationId!),
    )

    return NextResponse.json(suggestions)
  } catch (error) {
    console.error('Reorder suggestions error:', error)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/reorder-suggestions', handleGet)
