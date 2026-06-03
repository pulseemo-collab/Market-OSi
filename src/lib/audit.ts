import { prisma } from './prisma'

export interface FieldChange {
  label: string
  old: unknown
  new: unknown
}

export function buildFieldChanges(
  candidates: Array<{ label: string; old: unknown; new: unknown }>
): FieldChange[] {
  const normalize = (v: unknown) => (v == null ? '' : String(v)).trim()
  return candidates.filter((c) => normalize(c.old) !== normalize(c.new))
}

export const AUDIT_ACTIONS = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  CHANGE_ROLE: 'change_role',
  EXPORT: 'export',
  BACKUP_EXPORTED: 'backup_exported',
  BACKUP_RESTORED: 'backup_restored',
  BACKUP_RESTORE_FAILED: 'backup_restore_failed',
  BILLING_PLAN_CHANGED: 'billing_plan_changed',
  BILLING_STATUS_CHANGED: 'billing_status_changed',
  BILLING_SUBSCRIPTION_CREATED: 'billing_subscription_created',
  BILLING_ACCESS_BLOCKED: 'billing_access_blocked',
} as const

export const AUDIT_ENTITY_TYPES = {
  PRODUCT: 'product',
  SUPPLIER: 'supplier',
  SUPPLY: 'supply',
  SALE: 'sale',
  USER: 'user',
  EXPORT: 'export',
  BACKUP: 'backup',
  SUBSCRIPTION: 'subscription',
} as const

interface AuditParams {
  userId: string
  userEmail: string
  userRole: string
  organizationId: number
  action: string
  entityType: string
  entityId?: string | number | null
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any> | null
}

export async function logAuditAction(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        userEmail: params.userEmail,
        userRole: params.userRole,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId != null ? String(params.entityId) : null,
        description: params.description,
        // JSON.parse/stringify ensures Prisma-compatible JsonValue
        metadata: params.metadata != null
          ? JSON.parse(JSON.stringify(params.metadata))
          : null,
      },
    })
  } catch (err) {
    console.error('[AuditLog] Failed to write audit log:', err)
  }
}
