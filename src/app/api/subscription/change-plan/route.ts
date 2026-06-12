import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'

const PLAN_LABELS: Record<string, string> = { monthly: 'Mujor', yearly: 'Vjetor' }

export async function POST(req: Request) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['owner'])
  if (error) return error

  if (!organizationId) {
    return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 400 })
  }

  const body = await req.json()
  const { plan } = body as { plan: string | null }

  if (plan !== null && plan !== 'monthly' && plan !== 'yearly') {
    return NextResponse.json({ error: 'Plan i pavlefshëm' }, { status: 400 })
  }

  const existing = await prisma.subscription.findUnique({ where: { organizationId } })
  if (!existing) {
    return NextResponse.json({ error: 'Abonimi nuk u gjet' }, { status: 404 })
  }

  if (plan !== null && existing.plan === plan) {
    return NextResponse.json({ error: 'Plani i zgjedhur është i njëjtë me planin aktual' }, { status: 400 })
  }

  await prisma.subscription.update({
    where: { organizationId },
    data: { nextPlan: plan },
  })

  if (plan !== null) {
    const oldLabel = PLAN_LABELS[existing.plan] ?? existing.plan
    const newLabel = PLAN_LABELS[plan] ?? plan

    await prisma.billingAuditLog.create({
      data: {
        organizationId,
        changedByUserId: userId!,
        changedByEmail: userEmail!,
        oldPlan: existing.plan,
        newPlan: plan,
        notes: `Plani i ardhshëm u caktua: ${newLabel}`,
      },
    })

    logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId,
      action: AUDIT_ACTIONS.BILLING_PLAN_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
      description: `Plani u ndryshua nga ${oldLabel} në ${newLabel}`,
    }).catch(() => {})
  }

  return NextResponse.json({ success: true, nextPlan: plan })
}
