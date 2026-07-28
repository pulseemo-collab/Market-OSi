import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { setManagerOrgCookie, getStaffSession } from '@/lib/staff-auth'
import { errorResponse, instrumentRoute } from '@/lib/logger'

async function handleGet(req: NextRequest) {
  try {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError) {
      console.error('[org-context] auth.getUser error:', authError.message)
    }

    if (user) {
      let userRole: Awaited<ReturnType<typeof prisma.userRole.findUnique<{
        where: { userId: string }
        include: { organization: { select: { name: true; isActive: true } } }
      }>>> | null = null

      try {
        userRole = await prisma.userRole.findUnique({
          where: { userId: user.id },
          include: { organization: { select: { name: true, isActive: true } } },
        })
      } catch (dbErr) {
        console.error('[org-context] userRole query failed:', dbErr)
        return errorResponse(req, 'Gabim në server', 500)
      }

      if (!userRole) {
        console.error('[org-context] no UserRole for userId:', user.id)
        return errorResponse(req, 'UserRole missing', 404)
      }

      // Prisma types this as non-null for a required relation, but guard at runtime
      // in case of a FK integrity issue in the database.
      const organization = userRole.organization as typeof userRole.organization | null

      if (!organization) {
        console.error('[org-context] organization missing for orgId:', userRole.organizationId)
        return errorResponse(req, 'Organizata nuk u gjet', 404)
      }

      if (!organization.isActive) {
        return errorResponse(req, 'Organizata nuk u gjet', 404)
      }

      if (userRole.roli === 'platform_owner') {
        return NextResponse.json({ organizationId: null })
      }

      const res = NextResponse.json({
        organizationId: userRole.organizationId,
        orgName: organization.name,
      })

      setManagerOrgCookie(res, userRole.organizationId)
      return res
    }

    // Try PIN staff session
    const staffSession = await getStaffSession(req)

    if (staffSession) {
      let organization: { name: string; isActive: boolean } | null = null

      try {
        organization = await prisma.organization.findUnique({
          where: { id: staffSession.organizationId },
          select: { name: true, isActive: true },
        })
      } catch (dbErr) {
        console.error('[org-context] org query (staff) failed:', dbErr)
        return errorResponse(req, 'Gabim në server', 500)
      }

      if (!organization || !organization.isActive) {
        return errorResponse(req, 'Organizata nuk u gjet', 404)
      }

      return NextResponse.json({
        organizationId: staffSession.organizationId,
        orgName: organization.name,
      })
    }

    return errorResponse(req, 'Nuk je i autorizuar', 401)
  } catch (err) {
    console.error('[org-context] UNEXPECTED ERROR:', err)
    return errorResponse(req, 'Gabim i brendshëm i serverit', 500)
  }
}

export const GET = instrumentRoute('/api/auth/org-context', handleGet)
