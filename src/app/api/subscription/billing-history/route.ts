import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { PLAN_PRICES } from '@/lib/billing'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, cached, orgTag } from '@/lib/cache'

const PLAN_AMOUNTS: Record<string, number> = {
  monthly: PLAN_PRICES.monthly,
  yearly: PLAN_PRICES.yearly,
}

function planLabel(plan: string | null | undefined): string {
  if (plan === 'monthly') return 'Mujor'
  if (plan === 'yearly') return 'Vjetor'
  return plan ?? '—'
}

function statusLabel(status: string | null | undefined): string {
  if (status === 'cancelled') return 'Anuluar'
  if (status === 'active') return 'Aktiv'
  if (status === 'trialing') return 'Provë'
  if (status === 'expired') return 'Skaduar'
  return status ?? '—'
}

async function handleGet() {
  const { organizationId, error } = await requireRole(['Administrator', 'Manager'])
  if (error) return error

  if (!organizationId) {
    return errorResponse('Organizata nuk u gjet', 400)
  }

  // An append-only ledger that the billing page reloads after every action.
  // Tagged on subscription so any plan change refreshes it immediately.
  const logs = await cached(
    {
      namespace: 'billingHistory',
      organizationId,
      ttlMs: CACHE_TTL.billingHistory,
      tags: [orgTag(organizationId, 'subscription')],
    },
    () =>
      prisma.billingAuditLog.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
  )

  const records = logs.map((log) => {
    let description = log.notes ?? '—'
    let amount: number | null = null
    let status = 'Konfirmuar'

    if (log.newPlan && !log.newStatus) {
      description = `Ndryshim plani: ${planLabel(log.oldPlan)} → ${planLabel(log.newPlan)}`
      amount = PLAN_AMOUNTS[log.newPlan] ?? null
    } else if (log.newStatus === 'cancelled') {
      description = 'Abonimi u anulua'
      status = 'Anuluar'
    } else if (log.newStatus === 'active') {
      if (log.amount !== null) {
        // Top-up (extension) — use exact stored amount and description
        description = log.notes ?? `Zgjatje abonimi`
        amount = log.amount
      } else {
        description = `Aktivizim abonimi ${planLabel(log.newPlan ?? log.oldPlan)}`
        amount = PLAN_AMOUNTS[log.newPlan ?? log.oldPlan ?? ''] ?? null
      }
    } else if (log.newStatus) {
      description = `${statusLabel(log.oldStatus)} → ${statusLabel(log.newStatus)}`
    }

    return {
      id: log.id,
      date: log.createdAt.toISOString(),
      description,
      amount,
      paymentMethod: 'Transfer Bankar',
      status,
    }
  })

  return NextResponse.json({ records })
}

export const GET = instrumentRoute('/api/subscription/billing-history', handleGet)
