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
  /**
   * True when the platform operator has deactivated the organization. Distinct
   * from every billing outcome: the customer cannot clear it by paying, so the
   * UI must not send them to the subscription page.
   */
  orgSuspended?: boolean
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

interface CachedOrgAccess {
  isActive: boolean
  subscription: CachedSubscription | null
}

/**
 * Reads the organization's activation flag and subscription row, cached briefly.
 *
 * This lookup used to run on every products, sales, supplies, dashboard and
 * export request — one database round trip per API call, per user, forever.
 * Only the row is cached; the access decision itself is recomputed on every
 * call, so trial countdowns and period expiry stay exact to the second.
 *
 * Any write to a Subscription row evicts this entry from inside the Prisma
 * client, so plan changes, cancellations and top-ups take effect on the very
 * next request no matter which route performed them. Suspension is a write to
 * Organization rather than Subscription, so that route evicts the tenant's
 * whole cache scope explicitly.
 *
 * The organization is the outer query so that a suspended tenant with no
 * subscription row is still reported as suspended rather than unbilled.
 */
function loadOrgAccess(organizationId: number): Promise<CachedOrgAccess | null> {
  return cached(
    {
      namespace: 'subscription',
      organizationId,
      ttlMs: CACHE_TTL.subscription,
      tags: [orgTag(organizationId, 'subscription')],
    },
    () =>
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          isActive: true,
          subscription: {
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
          },
        },
      }),
  )
}

export async function checkSubscriptionAccess(
  organizationId: number,
  role: string
): Promise<SubscriptionAccessResult> {
  if (role === 'platform_owner') return { allowed: true }

  const org = await loadOrgAccess(organizationId)

  if (!org) return { allowed: false, reason: 'Organizata nuk u gjet' }

  // Administrative suspension outranks every billing consideration: a suspended
  // tenant is blocked even with a fully paid, in-period subscription.
  if (!org.isActive) {
    return {
      allowed: false,
      reason: 'Organizata është pezulluar nga platforma',
      orgSuspended: true,
      subStatus: org.subscription?.status ?? null,
      plan: org.subscription?.plan ?? null,
    }
  }

  const subscription = org.subscription

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
