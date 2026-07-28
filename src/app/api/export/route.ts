import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'

export const dynamic = 'force-dynamic'

async function handleGet(request: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('export:read')
  if (error) return error

  const rl = rateLimit(request, 'exports', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(request, 'Abonimi ka skaduar', 403)

  try {
    const { searchParams } = new URL(request.url)
    const periudha = searchParams.get('periudha') || 'sot'
    const ngaParam = searchParams.get('nga')
    const deriParam = searchParams.get('deri')

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    let periodStart: Date
    let periodEnd: Date = tomorrowStart
    let periudhaLabel: string

    switch (periudha) {
      case 'dje': {
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        periodStart = yesterday
        periodEnd = todayStart
        periudhaLabel = 'Dje'
        break
      }
      case 'jave':
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
        periudhaLabel = 'Kjo Jave'
        break
      case 'muaj':
        periodStart = monthStart
        periudhaLabel = 'Ky Muaj'
        break
      case 'custom':
        periodStart = ngaParam ? new Date(ngaParam) : monthStart
        if (deriParam) {
          const d = new Date(deriParam)
          d.setHours(23, 59, 59, 999)
          periodEnd = d
        }
        periudhaLabel = 'Periudhe e Zgjedhur'
        break
      default:
        periodStart = todayStart
        periudhaLabel = 'Sot'
    }

    const orgFilter = { organizationId: organizationId! }

    const [org, shitjet, produktet, furnizimet] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId! }, select: { name: true } }),
      prisma.sale.findMany({
        where: { ...orgFilter, createdAt: { gte: periodStart, lt: periodEnd } },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.findMany({
        where: orgFilter,
        include: { furnitor: { select: { emri: true } } },
        orderBy: { emri: 'asc' },
      }),
      prisma.supply.findMany({
        where: orgFilter,
        include: {
          furnitor: { select: { emri: true } },
          items: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ])

    const stokUlet = produktet.filter((p) => p.sasia <= p.stokuMinimal)
    const totali = shitjet.reduce((s, x) => s + x.totali, 0)
    const fitimi = shitjet.reduce((s, x) => s + x.fitimi, 0)

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.EXPORT,
      entityType: AUDIT_ENTITY_TYPES.EXPORT,
      description: `U eksportua raporti për periudhën "${periudhaLabel}"`,
      metadata: { periudha, periudhaLabel, numriShitjeve: shitjet.length, totali },
    })

    return NextResponse.json({
      orgName: org?.name || null,
      periudhaLabel,
      nga: ngaParam || null,
      deri: deriParam || null,
      summary: {
        totali,
        fitimi,
        numriShitjeve: shitjet.length,
        marzhi: totali > 0 ? (fitimi / totali) * 100 : 0,
      },
      shitjet,
      produktet,
      stokUlet,
      furnizimet,
    })
  } catch (error) {
    console.error('Export error:', error)
    return errorResponse(request, 'Gabim ne server', 500)
  }
}

export const GET = instrumentRoute('/api/export', handleGet)
