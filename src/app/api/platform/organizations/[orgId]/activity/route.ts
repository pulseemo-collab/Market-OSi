import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { orgId: string } }

/** Rows pulled per source before merging. Five sources, so at most 5×this. */
const PER_SOURCE = 15

export type ActivityStream = 'sale' | 'supply' | 'audit' | 'billing' | 'notification'

interface ActivityEvent {
  id: string
  stream: ActivityStream
  at: Date
  title: string
  detail: string | null
  actor: string | null
}

/**
 * A read-only chronological view of what a tenant has been doing, assembled
 * from tables that already exist.
 *
 * There is no event store behind this and none is being introduced: sales,
 * supplies, audit entries, billing changes and notifications are each already
 * timestamped and already scoped by `organizationId`. Merging the newest slice
 * of each is enough to answer the support question ("is this customer actually
 * using the product, and what changed recently?") without a write path, a
 * schema change, or a background projection to keep in sync.
 *
 * Every query below is filtered by `organizationId`, so one tenant's feed can
 * never contain another's rows.
 */
async function handleGet(req: NextRequest, { params }: RouteContext) {
  const { userId, organizationId, error } = await requirePermission('organizations:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  const requested = new URL(req.url).searchParams.get('stream')
  const stream = (['sale', 'supply', 'audit', 'billing', 'notification'] as string[]).includes(
    requested ?? '',
  )
    ? (requested as ActivityStream)
    : null

  const wants = (s: ActivityStream) => stream === null || stream === s

  try {
    const [sales, supplies, auditLogs, billingLogs, notifications] = await Promise.all([
      wants('sale')
        ? prisma.sale.findMany({
            where: { organizationId: orgId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PER_SOURCE,
            select: {
              id: true, totali: true, fitimi: true, paymentMethod: true,
              staffName: true, createdAt: true, _count: { select: { items: true } },
            },
          })
        : [],
      wants('supply')
        ? prisma.supply.findMany({
            where: { organizationId: orgId },
            orderBy: [{ data: 'desc' }, { id: 'desc' }],
            take: PER_SOURCE,
            select: {
              id: true, totali: true, data: true, shenime: true,
              furnitor: { select: { emri: true } }, _count: { select: { items: true } },
            },
          })
        : [],
      wants('audit')
        ? prisma.auditLog.findMany({
            where: { organizationId: orgId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PER_SOURCE,
            select: {
              id: true, action: true, entityType: true, description: true,
              userEmail: true, createdAt: true,
            },
          })
        : [],
      wants('billing')
        ? prisma.billingAuditLog.findMany({
            where: { organizationId: orgId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PER_SOURCE,
            select: {
              id: true, oldPlan: true, newPlan: true, oldStatus: true, newStatus: true,
              notes: true, changedByEmail: true, createdAt: true,
            },
          })
        : [],
      wants('notification')
        ? prisma.notification.findMany({
            where: { organizationId: orgId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PER_SOURCE,
            select: { id: true, type: true, title: true, message: true, severity: true, createdAt: true },
          })
        : [],
    ])

    const events: ActivityEvent[] = [
      ...sales.map((s) => ({
        id: `sale-${s.id}`,
        stream: 'sale' as const,
        at: s.createdAt,
        title: `Shitje #${s.id} — ${s.totali.toLocaleString('sq-AL')} L`,
        detail: `${s._count.items} artikuj · fitim ${s.fitimi.toLocaleString('sq-AL')} L · ${
          s.paymentMethod === 'cash' ? 'para në dorë' : s.paymentMethod
        }`,
        actor: s.staffName,
      })),
      ...supplies.map((s) => ({
        id: `supply-${s.id}`,
        stream: 'supply' as const,
        at: s.data,
        title: `Furnizim #${s.id} — ${s.totali.toLocaleString('sq-AL')} L`,
        detail: `${s._count.items} artikuj${s.shenime ? ` · ${s.shenime}` : ''}`,
        actor: s.furnitor?.emri ?? null,
      })),
      ...auditLogs.map((l) => ({
        id: `audit-${l.id}`,
        stream: 'audit' as const,
        at: l.createdAt,
        title: l.description,
        detail: `${l.action} · ${l.entityType}`,
        actor: l.userEmail,
      })),
      ...billingLogs.map((l) => ({
        id: `billing-${l.id}`,
        stream: 'billing' as const,
        at: l.createdAt,
        title:
          l.oldStatus || l.newStatus
            ? `Abonimi: ${l.oldStatus ?? '—'} → ${l.newStatus ?? '—'}`
            : l.oldPlan || l.newPlan
              ? `Plani: ${l.oldPlan ?? '—'} → ${l.newPlan ?? '—'}`
              : 'Ndryshim abonimi',
        detail: l.notes,
        actor: l.changedByEmail,
      })),
      ...notifications.map((n) => ({
        id: `notification-${n.id}`,
        stream: 'notification' as const,
        at: n.createdAt,
        title: n.title,
        detail: n.message,
        actor: null,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime())

    return NextResponse.json({ events: events.slice(0, 40), stream })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]/activity', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute<RouteContext>(
  '/api/platform/organizations/[orgId]/activity',
  handleGet,
)
