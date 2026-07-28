import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import * as Sentry from '@sentry/nextjs'
import { createNotification, NOTIFICATION_TYPES, NOTIFICATION_SEVERITIES } from '@/lib/notifications'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const APP_VERSION = '1.1.0'

function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'org'
}

async function handleGet(request: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('backup:create')
  if (error) return error

  const rl = rateLimit(request, 'exports', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(request, 'Abonimi ka skaduar', 403)

  try {
    const orgId = organizationId!

    const [
      organization,
      suppliers,
      products,
      productBarcodes,
      supplies,
      supplyItems,
      sales,
      saleItems,
      userRoles,
      auditLogs,
    ] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId } }),
      prisma.supplier.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } }),
      prisma.product.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } }),
      prisma.productBarcode.findMany({
        where: { product: { organizationId: orgId } },
        orderBy: { id: 'asc' },
      }),
      prisma.supply.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } }),
      prisma.supplyItem.findMany({
        where: { supply: { organizationId: orgId } },
        orderBy: { id: 'asc' },
      }),
      prisma.sale.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } }),
      prisma.saleItem.findMany({
        where: { sale: { organizationId: orgId } },
        orderBy: { id: 'asc' },
      }),
      prisma.userRole.findMany({ where: { organizationId: orgId }, orderBy: { id: 'asc' } }),
      prisma.auditLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ])

    if (!organization) {
      return errorResponse(request, 'Organizata nuk u gjet', 404)
    }

    const now = new Date()
    const dateStr = now.toISOString().split('T')[0]

    const counts = {
      suppliers: suppliers.length,
      products: products.length,
      productBarcodes: productBarcodes.length,
      supplies: supplies.length,
      supplyItems: supplyItems.length,
      sales: sales.length,
      saleItems: saleItems.length,
      userRoles: userRoles.length,
      auditLogs: auditLogs.length,
    }

    const backup = {
      metadata: {
        appVersion: APP_VERSION,
        organizationId: orgId,
        organizationName: organization.name,
        exportedAt: now.toISOString(),
        exportedBy: userEmail!,
        counts,
      },
      organization,
      suppliers,
      products,
      productBarcodes,
      supplies,
      supplyItems,
      sales,
      saleItems,
      userRoles,
      auditLogs,
    }

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: orgId,
      action: AUDIT_ACTIONS.BACKUP_EXPORTED,
      entityType: AUDIT_ENTITY_TYPES.BACKUP,
      description: `U eksportua backup për organizatën "${organization.name}"`,
      metadata: { counts },
    })

    await createNotification({
      organizationId: orgId,
      type: NOTIFICATION_TYPES.BACKUP_SUCCESS,
      title: 'Backup i Suksesshëm',
      message: `Backup u eksportua me sukses — ${counts.products} produkte, ${counts.sales} shitje`,
      severity: NOTIFICATION_SEVERITIES.LOW,
      metadata: { counts, exportedBy: userEmail },
    })

    const orgSlug = sanitizeFilename(organization.name)
    const filename = `market-osi-backup-${orgSlug}-${dateStr}.json`

    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[Backup] Export error:', err)
    Sentry.captureException(err, {
      tags: { operation: 'backup_export', organizationId: String(organizationId) },
    })
    return errorResponse(request, 'Gabim gjatë eksportit të backup-it', 500)
  }
}

export const GET = instrumentRoute('/api/backup', handleGet)
