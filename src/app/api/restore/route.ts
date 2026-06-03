import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import * as Sentry from '@sentry/nextjs'
import { createNotification, NOTIFICATION_TYPES, NOTIFICATION_SEVERITIES } from '@/lib/notifications'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateBackup(data: unknown): data is Record<string, any> {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>

  if (!d.metadata || typeof d.metadata !== 'object') return false
  const meta = d.metadata as Record<string, unknown>
  if (typeof meta.appVersion !== 'string') return false
  if (typeof meta.organizationId !== 'number') return false
  if (typeof meta.organizationName !== 'string') return false
  if (typeof meta.exportedAt !== 'string') return false
  if (typeof meta.exportedBy !== 'string') return false

  const requiredArrays = [
    'suppliers', 'products', 'productBarcodes',
    'supplies', 'supplyItems', 'sales', 'saleItems',
    'userRoles', 'auditLogs',
  ]
  for (const key of requiredArrays) {
    if (!Array.isArray(d[key])) return false
  }

  return true
}

export async function POST(request: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('backup:restore')
  if (error) return error

  const rl = rateLimit(request, 'backups', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Formati i kërkesës është i pavlefshëm' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Të dhënat mungojnë' }, { status: 400 })
  }

  const { backup, confirmCrossOrg } = body as { backup: unknown; confirmCrossOrg?: boolean }

  if (!validateBackup(backup)) {
    return NextResponse.json(
      { error: 'Skedari i backup-it është i pavlefshëm ose i dëmtuar' },
      { status: 400 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = backup as Record<string, any>
  const meta = b.metadata as {
    appVersion: string
    organizationId: number
    organizationName: string
    exportedAt: string
    exportedBy: string
  }

  const orgId = organizationId!

  // Cross-organization guard
  if (meta.organizationId !== orgId && !confirmCrossOrg) {
    return NextResponse.json(
      {
        crossOrgWarning: true,
        backupOrgName: meta.organizationName,
        backupOrgId: meta.organizationId,
        message: `Ky backup i përket organizatës "${meta.organizationName}" (ID: ${meta.organizationId}), jo organizatës suaj aktuale.`,
      },
      { status: 409 },
    )
  }

  try {
    const counts = await prisma.$transaction(
      async (tx) => {
        // Delete in reverse FK order (scoped to this org)
        await tx.auditLog.deleteMany({ where: { organizationId: orgId } })
        await tx.saleItem.deleteMany({ where: { sale: { organizationId: orgId } } })
        await tx.sale.deleteMany({ where: { organizationId: orgId } })
        await tx.supplyItem.deleteMany({ where: { supply: { organizationId: orgId } } })
        await tx.supply.deleteMany({ where: { organizationId: orgId } })
        await tx.productBarcode.deleteMany({ where: { product: { organizationId: orgId } } })
        await tx.product.deleteMany({ where: { organizationId: orgId } })
        await tx.supplier.deleteMany({ where: { organizationId: orgId } })

        // Update org name
        await tx.organization.update({
          where: { id: orgId },
          data: { name: meta.organizationName },
        })

        // 1. Suppliers → build ID map
        const supplierMap = new Map<number, number>()
        for (const s of b.suppliers) {
          const created = await tx.supplier.create({
            data: {
              emri: s.emri,
              telefoni: s.telefoni ?? null,
              email: s.email ?? null,
              adresa: s.adresa ?? null,
              shenime: s.shenime ?? null,
              organizationId: orgId,
              createdAt: new Date(s.createdAt),
              updatedAt: new Date(s.updatedAt),
            },
          })
          supplierMap.set(s.id, created.id)
        }

        // 2. Products → build ID map
        const productMap = new Map<number, number>()
        for (const p of b.products) {
          const created = await tx.product.create({
            data: {
              emri: p.emri,
              kategoria: p.kategoria,
              sasia: p.sasia,
              stokuMinimal: p.stokuMinimal,
              cmimiBlerjes: p.cmimiBlerjes,
              cmimiShitjes: p.cmimiShitjes,
              njesia: p.njesia ?? 'cope',
              furnitorId: p.furnitorId != null ? (supplierMap.get(p.furnitorId) ?? null) : null,
              organizationId: orgId,
              createdAt: new Date(p.createdAt),
              updatedAt: new Date(p.updatedAt),
            },
          })
          productMap.set(p.id, created.id)
        }

        // 3. ProductBarcodes
        let barcodesRestored = 0
        for (const bc of b.productBarcodes) {
          const newProductId = productMap.get(bc.productId)
          if (!newProductId) continue
          await tx.productBarcode.create({
            data: {
              barcode: bc.barcode,
              productId: newProductId,
              createdAt: new Date(bc.createdAt),
            },
          })
          barcodesRestored++
        }

        // 4. Supplies → build ID map
        const supplyMap = new Map<number, number>()
        for (const s of b.supplies) {
          const created = await tx.supply.create({
            data: {
              furnitorId: s.furnitorId != null ? (supplierMap.get(s.furnitorId) ?? null) : null,
              organizationId: orgId,
              data: new Date(s.data),
              shenime: s.shenime ?? null,
              totali: s.totali,
              createdAt: new Date(s.createdAt),
              updatedAt: new Date(s.updatedAt),
            },
          })
          supplyMap.set(s.id, created.id)
        }

        // 5. SupplyItems
        let supplyItemsRestored = 0
        for (const si of b.supplyItems) {
          const newSupplyId = supplyMap.get(si.supplyId)
          const newProductId = productMap.get(si.productId)
          if (!newSupplyId || !newProductId) continue
          await tx.supplyItem.create({
            data: {
              supplyId: newSupplyId,
              productId: newProductId,
              emriProduktit: si.emriProduktit,
              sasia: si.sasia,
              njesia: si.njesia ?? 'cope',
              cmimiBlerjes: si.cmimiBlerjes,
              totali: si.totali,
            },
          })
          supplyItemsRestored++
        }

        // 6. Sales → build ID map
        const saleMap = new Map<number, number>()
        for (const s of b.sales) {
          const created = await tx.sale.create({
            data: {
              totali: s.totali,
              fitimi: s.fitimi,
              shenime: s.shenime ?? null,
              paymentMethod: s.paymentMethod ?? 'cash',
              organizationId: orgId,
              createdAt: new Date(s.createdAt),
            },
          })
          saleMap.set(s.id, created.id)
        }

        // 7. SaleItems
        let saleItemsRestored = 0
        for (const si of b.saleItems) {
          const newSaleId = saleMap.get(si.saleId)
          const newProductId = productMap.get(si.productId)
          if (!newSaleId || !newProductId) continue
          await tx.saleItem.create({
            data: {
              saleId: newSaleId,
              productId: newProductId,
              emriProduktit: si.emriProduktit,
              sasia: si.sasia,
              cmimiBlerjes: si.cmimiBlerjes,
              cmimiShitjes: si.cmimiShitjes,
              fitimi: si.fitimi,
            },
          })
          saleItemsRestored++
        }

        return {
          suppliers: supplierMap.size,
          products: productMap.size,
          productBarcodes: barcodesRestored,
          supplies: supplyMap.size,
          supplyItems: supplyItemsRestored,
          sales: saleMap.size,
          saleItems: saleItemsRestored,
        }
      },
      { timeout: 120_000 },
    )

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: orgId,
      action: AUDIT_ACTIONS.BACKUP_RESTORED,
      entityType: AUDIT_ENTITY_TYPES.BACKUP,
      description: `U rikuperua backup nga "${meta.organizationName}" (eksportuar ${meta.exportedAt.split('T')[0]})`,
      metadata: {
        backupOrgId: meta.organizationId,
        backupOrgName: meta.organizationName,
        exportedAt: meta.exportedAt,
        exportedBy: meta.exportedBy,
        crossOrg: meta.organizationId !== orgId,
        counts,
      },
    })

    await createNotification({
      organizationId: orgId,
      type: NOTIFICATION_TYPES.RESTORE_SUCCESS,
      title: 'Rikuperim i Suksesshëm',
      message: `Të dhënat u rikuperuan me sukses nga "${meta.organizationName}" (${meta.exportedAt.split('T')[0]})`,
      severity: NOTIFICATION_SEVERITIES.HIGH,
      metadata: {
        backupOrgName: meta.organizationName,
        exportedAt: meta.exportedAt,
        counts,
      },
    })

    return NextResponse.json({ success: true, counts })
  } catch (err) {
    console.error('[Restore] Error:', err)

    Sentry.captureException(err, {
      tags: { operation: 'backup_restore', organizationId: String(orgId) },
      extra: {
        backupOrgId: meta.organizationId,
        backupOrgName: meta.organizationName,
      },
    })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: orgId,
      action: AUDIT_ACTIONS.BACKUP_RESTORE_FAILED,
      entityType: AUDIT_ENTITY_TYPES.BACKUP,
      description: `Dështoi rikuperimi i backup-it nga "${meta.organizationName}"`,
      metadata: {
        backupOrgId: meta.organizationId,
        backupOrgName: meta.organizationName,
        error: err instanceof Error ? err.message : 'E panjohur',
      },
    })

    await createNotification({
      organizationId: orgId,
      type: NOTIFICATION_TYPES.RESTORE_FAILED,
      title: 'Rikuperimi Dështoi',
      message: `Dështoi rikuperimi nga "${meta.organizationName}": ${err instanceof Error ? err.message : 'Gabim i panjohur'}`,
      severity: NOTIFICATION_SEVERITIES.CRITICAL,
      metadata: {
        backupOrgName: meta.organizationName,
        error: err instanceof Error ? err.message : 'E panjohur',
      },
    })

    return NextResponse.json({ error: 'Gabim gjatë rikuperimit të të dhënave' }, { status: 500 })
  }
}
