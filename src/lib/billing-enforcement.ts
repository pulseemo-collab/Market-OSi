import { prisma } from './prisma'

export interface SubscriptionAccessResult {
  allowed: boolean
  reason?: string
  subStatus?: string | null
  trialDaysLeft?: number | null
  periodEndsAt?: string | null
  plan?: string | null
  nextPlan?: string | null
}

export async function checkSubscriptionAccess(
  organizationId: number,
  role: string
): Promise<SubscriptionAccessResult> {
  // TEMPORARY: billing not yet implemented — allow all orgs unconditionally

  if (role === 'platform_owner') return { allowed: true }

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true, nextPlan: true },
  })

  if (!subscription) return { allowed: false, reason: 'Abonimi nuk u gjet' }

  const { plan, status, trialEndsAt, currentPeriodEnd, nextPlan } = subscription
  const now = new Date()
  // Fallback: old orgs registered before plan selection was added
  const effectivePlan = plan === 'trial' ? 'monthly' : plan

  if (plan === 'internal') return { allowed: true, subStatus: 'active', plan, nextPlan: nextPlan ?? null }

  if (status === 'trialing') {
    const trialDaysLeft = trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : null
    if (!trialEndsAt || trialEndsAt > now) {
      return { allowed: true, subStatus: 'trialing', trialDaysLeft, periodEndsAt: trialEndsAt?.toISOString() ?? null, plan: effectivePlan, nextPlan: nextPlan ?? null }
    }
    return { allowed: false, reason: 'Abonimi ka skaduar', subStatus: 'trialing', trialDaysLeft: 0, plan: effectivePlan, nextPlan: nextPlan ?? null }
  }

  if (status === 'active') {
    if (!currentPeriodEnd || currentPeriodEnd > now) {
      return { allowed: true, subStatus: 'active', periodEndsAt: currentPeriodEnd?.toISOString() ?? null, plan: effectivePlan, nextPlan: nextPlan ?? null }
    }
    return { allowed: false, reason: 'Abonimi ka skaduar', subStatus: 'active', plan: effectivePlan, nextPlan: nextPlan ?? null }
  }

  return { allowed: false, reason: 'Abonimi ka skaduar', subStatus: status ?? null, plan: effectivePlan, nextPlan: nextPlan ?? null }
}
