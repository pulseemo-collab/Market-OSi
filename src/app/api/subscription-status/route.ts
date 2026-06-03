import { NextResponse } from 'next/server'
import { getAuthUserAndRole } from '@/lib/auth-helpers'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId, userEmail, role, organizationId, error } = await getAuthUserAndRole()
  if (error) return error

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

  return NextResponse.json({ allowed: check.allowed })
}
