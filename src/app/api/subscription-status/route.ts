import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserAndRole } from '@/lib/auth-helpers'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { getStaffSession } from '@/lib/staff-auth'
import { instrumentRoute } from '@/lib/logger'

export const dynamic = 'force-dynamic'

async function handleGet(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await getAuthUserAndRole()

  if (!error) {
    if (!organizationId || role === 'platform_owner') {
      return NextResponse.json({ allowed: true })
    }

    const check = await checkSubscriptionAccess(organizationId, role!)

    if (!check.allowed && userId && userEmail && role) {
      logAuditAction({
        userId,
        userEmail,
        userRole: role,
        organizationId,
        action: AUDIT_ACTIONS.BILLING_ACCESS_BLOCKED,
        entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
        description: 'Aksesi i bllokuar: abonimi ka skaduar ose është anuluar',
      }).catch(() => {})
    }

    return NextResponse.json({
      allowed: check.allowed,
      subStatus: check.subStatus ?? null,
      trialDaysLeft: check.trialDaysLeft ?? null,
      periodEndsAt: check.periodEndsAt ?? null,
      plan: check.plan ?? null,
      nextPlan: check.nextPlan ?? null,
      cancelAtPeriodEnd: check.cancelAtPeriodEnd ?? false,
      closeAtPeriodEnd: check.closeAtPeriodEnd ?? false,
      cancelledAt: check.cancelledAt ?? null,
    })
  }

  // No Supabase session — check staff PIN session and enforce their org's subscription
  const staffSession = await getStaffSession(req)
  if (staffSession) {
    const check = await checkSubscriptionAccess(staffSession.organizationId, staffSession.staffRole)
    return NextResponse.json({ allowed: check.allowed })
  }

  return NextResponse.json({ allowed: true })
}

export const GET = instrumentRoute('/api/subscription-status', handleGet)
