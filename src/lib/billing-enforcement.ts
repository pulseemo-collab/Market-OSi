import { prisma } from './prisma'

export interface SubscriptionAccessResult {
  allowed: boolean
  reason?: string
  subStatus?: string | null
  trialDaysLeft?: number | null
  periodEndsAt?: string | null
}

export async function checkSubscriptionAccess(
  organizationId: number,
  role: string
): Promise<SubscriptionAccessResult> {
  // TEMPORARY: billing not yet implemented — allow all orgs unconditionally

  if (role === 'platform_owner') return { allowed: true }

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  })

  if (!subscription) return { allowed: false, reason: 'Abonimi nuk u gjet' }

  const { plan, status, trialEndsAt, currentPeriodEnd } = subscription
  const now = new Date()

  if (plan === 'internal') return { allowed: true, subStatus: 'active' }

  if (status === 'trialing') {
    const trialDaysLeft = trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : null
    if (!trialEndsAt || trialEndsAt > now) {
      return { allowed: true, subStatus: 'trialing', trialDaysLeft, periodEndsAt: trialEndsAt?.toISOString() ?? null }
    }
    return { allowed: false, reason: 'Abonimi ka skaduar', subStatus: 'trialing', trialDaysLeft: 0 }
  }

  if (status === 'active') {
    if (!currentPeriodEnd || currentPeriodEnd > now) {
      return { allowed: true, subStatus: 'active', periodEndsAt: currentPeriodEnd?.toISOString() ?? null }
    }
    return { allowed: false, reason: 'Abonimi ka skaduar', subStatus: 'active' }
  }

  return { allowed: false, reason: 'Abonimi ka skaduar', subStatus: status ?? null }
}
