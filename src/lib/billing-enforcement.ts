import { prisma } from './prisma'

export interface SubscriptionAccessResult {
  allowed: boolean
  reason?: string
}

export async function checkSubscriptionAccess(
  organizationId: number,
  role: string
): Promise<SubscriptionAccessResult> {
  if (role === 'platform_owner') return { allowed: true }

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  })

  if (!subscription) return { allowed: false, reason: 'Abonimi nuk u gjet' }

  const { plan, status, trialEndsAt, currentPeriodEnd } = subscription
  const now = new Date()

  if (plan === 'internal') return { allowed: true }

  if (status === 'trialing') {
    if (!trialEndsAt || trialEndsAt > now) return { allowed: true }
    return { allowed: false, reason: 'Abonimi ka skaduar' }
  }

  if (status === 'active') {
    if (!currentPeriodEnd || currentPeriodEnd > now) return { allowed: true }
    return { allowed: false, reason: 'Abonimi ka skaduar' }
  }

  return { allowed: false, reason: 'Abonimi ka skaduar' }
}
