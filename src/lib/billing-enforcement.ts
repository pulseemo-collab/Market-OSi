import { prisma } from './prisma'
import { CACHE_TTL, cached, orgTag } from './cache'

export interface SubscriptionAccessResult {
  allowed: boolean
  reason?: string
  subStatus?: string | null
  trialDaysLeft?: number | null
  periodEndsAt?: string | null
  plan?: string | null
  nextPlan?: string | null
  cancelAtPeriodEnd?: boolean
  closeAtPeriodEnd?: boolean
  cancelledAt?: string | null
}

interface CachedSubscription {
  plan: string
  status: string
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  nextPlan: string | null
  cancelAtPeriodEnd: boolean
  closeAtPeriodEnd: boolean
  cancelledAt: Date | null
}

/**
 * Reads the organization's subscription row, cached briefly.
 *
 * This lookup used to run on every products, sales, supplies, dashboard and
 * export request — one database round trip per API call, per user, forever.
 * Only the row is cached; the access decision itself is recomputed on every
 * call, so trial countdowns and period expiry stay exact to the second.
 *
 * Any write to a Subscription row evicts this entry from inside the Prisma
 * client, so plan changes, cancellations and top-ups take effect on the very
 * next request no matter which route performed them.
 */
function loadSubscription(organizationId: number): Promise<CachedSubscription | null> {
  return cached(
    {
      namespace: 'subscription',
      organizationId,
      ttlMs: CACHE_TTL.subscription,
      tags: [orgTag(organizationId, 'subscription')],
    },
    () =>
      prisma.subscription.findUnique({
        where: { organizationId },
        select: {
          plan: true,
          status: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          nextPlan: true,
          cancelAtPeriodEnd: true,
          closeAtPeriodEnd: true,
          cancelledAt: true,
        },
      }),
  )
}

export async function checkSubscriptionAccess(
  organizationId: number,
  role: string
): Promise<SubscriptionAccessResult> {
  if (role === 'platform_owner') return { allowed: true }

  const subscription = await loadSubscription(organizationId)

  if (!subscription) return { allowed: false, reason: 'Abonimi nuk u gjet' }

  const { plan, status, trialEndsAt, currentPeriodEnd, nextPlan, cancelAtPeriodEnd, closeAtPeriodEnd, cancelledAt } = subscription
  const now = new Date()
  const effectivePlan = plan === 'trial' ? 'monthly' : plan

  if (plan === 'internal') return { allowed: true, subStatus: 'active', plan, nextPlan: nextPlan ?? null }

  if (status === 'trialing') {
    const trialDaysLeft = trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : null
    if (!trialEndsAt || trialEndsAt > now) {
      return {
        allowed: true,
        subStatus: 'trialing',
        trialDaysLeft,
        periodEndsAt: trialEndsAt?.toISOString() ?? null,
        plan: effectivePlan,
        nextPlan: nextPlan ?? null,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      }
    }
    return {
      allowed: false,
      reason: 'Abonimi ka skaduar',
      subStatus: 'trialing',
      trialDaysLeft: 0,
      plan: effectivePlan,
      nextPlan: nextPlan ?? null,
    }
  }

  if (status === 'active') {
    if (!currentPeriodEnd || currentPeriodEnd > now) {
      return {
        allowed: true,
        subStatus: 'active',
        periodEndsAt: currentPeriodEnd?.toISOString() ?? null,
        plan: effectivePlan,
        nextPlan: nextPlan ?? null,
        cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
        closeAtPeriodEnd: closeAtPeriodEnd ?? false,
        cancelledAt: cancelledAt?.toISOString() ?? null,
      }
    }
    return { allowed: false, reason: 'Abonimi ka skaduar', subStatus: 'active', plan: effectivePlan, nextPlan: nextPlan ?? null }
  }

  return { allowed: false, reason: 'Abonimi ka skaduar', subStatus: status ?? null, plan: effectivePlan, nextPlan: nextPlan ?? null }
}
