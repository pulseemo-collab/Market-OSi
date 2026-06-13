import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { PLAN_PRICES } from '@/lib/billing'

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

export async function GET() {
  const { organizationId, error } = await requireRole(['owner', 'manager'])
  if (error) return error

  if (!organizationId) {
    return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 400 })
  }

  const logs = await prisma.billingAuditLog.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

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
      description = `Aktivizim abonimi ${planLabel(log.newPlan ?? log.oldPlan)}`
      amount = PLAN_AMOUNTS[log.newPlan ?? log.oldPlan ?? ''] ?? null
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
