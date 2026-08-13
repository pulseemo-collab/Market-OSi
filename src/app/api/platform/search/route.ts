import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/** Results returned per entity type. Enough to recognise a hit, not to browse. */
const PER_TYPE = 8
const MIN_QUERY = 2

/**
 * Cross-tenant lookup for support: "a customer just called about barcode X /
 * receipt #Y / an account named Z — which organization is that?"
 *
 * Plain case-insensitive `contains` against indexed-enough columns, capped at a
 * handful of rows per type. No full-text index, no ranking model, no trigram
 * extension: those are worth their operational cost when search is a product
 * feature, and this is a lookup box used by one operator.
 *
 * Every result carries its organization id and name. That is the point of the
 * endpoint — a bare product name or sale id crossing tenants would be actively
 * misleading, since the same barcode legitimately exists in many markets.
 */
async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('organizations:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 100)

  if (q.length < MIN_QUERY) {
    return NextResponse.json({
      query: q,
      organizations: [], users: [], staff: [], products: [], sales: [],
      tooShort: true,
    })
  }

  const like = { contains: q, mode: 'insensitive' as const }
  // A bare number is meaningful as an id for organizations and sales.
  const asId = /^\d+$/.test(q) ? parseInt(q, 10) : null

  try {
    const [organizations, users, staff, products, sales] = await Promise.all([
      prisma.organization.findMany({
        where: asId !== null ? { OR: [{ name: like }, { id: asId }] } : { name: like },
        take: PER_TYPE,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.userRole.findMany({
        where: { email: like },
        take: PER_TYPE,
        orderBy: { email: 'asc' },
        select: {
          id: true, email: true, roli: true, organizationId: true,
          organization: { select: { name: true } },
        },
      }),
      prisma.staff.findMany({
        where: { OR: [{ emri: like }, { kodi: like }] },
        take: PER_TYPE,
        orderBy: { emri: 'asc' },
        // pinHash is never selected.
        select: {
          id: true, emri: true, kodi: true, roli: true, isActive: true,
          organizationId: true, organization: { select: { name: true } },
        },
      }),
      prisma.product.findMany({
        where: {
          OR: [
            { emri: like },
            { kategoria: like },
            { barcodes: { some: { barcode: { contains: q } } } },
          ],
        },
        take: PER_TYPE,
        orderBy: { emri: 'asc' },
        select: {
          id: true, emri: true, kategoria: true, sasia: true, isArchived: true,
          organizationId: true, organization: { select: { name: true } },
          barcodes: { select: { barcode: true }, take: 1 },
        },
      }),
      asId !== null
        ? prisma.sale.findMany({
            where: { id: asId },
            take: PER_TYPE,
            select: {
              id: true, totali: true, createdAt: true, staffName: true,
              organizationId: true, organization: { select: { name: true } },
            },
          })
        : [],
    ])

    return NextResponse.json({
      query: q,
      organizations,
      users: users.map((u) => ({
        id: u.id, email: u.email, roli: u.roli,
        organizationId: u.organizationId, organizationName: u.organization.name,
      })),
      staff: staff.map((s) => ({
        id: s.id, emri: s.emri, kodi: s.kodi, roli: s.roli, isActive: s.isActive,
        organizationId: s.organizationId, organizationName: s.organization.name,
      })),
      products: products.map((p) => ({
        id: p.id, emri: p.emri, kategoria: p.kategoria, sasia: p.sasia, isArchived: p.isArchived,
        barcode: p.barcodes[0]?.barcode ?? null,
        organizationId: p.organizationId, organizationName: p.organization.name,
      })),
      sales: sales.map((s) => ({
        id: s.id, totali: s.totali, createdAt: s.createdAt, staffName: s.staffName,
        organizationId: s.organizationId, organizationName: s.organization.name,
      })),
    })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/search', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/platform/search', handleGet)
