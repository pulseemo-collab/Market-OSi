import { prisma } from './prisma'

export const NOTIFICATION_TYPES = {
  LOW_STOCK:       'LOW_STOCK',
  BACKUP_SUCCESS:  'BACKUP_SUCCESS',
  BACKUP_FAILED:   'BACKUP_FAILED',
  RESTORE_SUCCESS: 'RESTORE_SUCCESS',
  RESTORE_FAILED:  'RESTORE_FAILED',
  LARGE_SALE:      'LARGE_SALE',
  SYSTEM_ERROR:    'SYSTEM_ERROR',
} as const

export type NotificationType = typeof NOTIFICATION_TYPES[keyof typeof NOTIFICATION_TYPES]

export const NOTIFICATION_SEVERITIES = {
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
} as const

export type NotificationSeverity = typeof NOTIFICATION_SEVERITIES[keyof typeof NOTIFICATION_SEVERITIES]

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  LOW_STOCK:       'Stok i Ulët',
  BACKUP_SUCCESS:  'Backup i Suksesshëm',
  BACKUP_FAILED:   'Backup Dështoi',
  RESTORE_SUCCESS: 'Rikuperim i Suksesshëm',
  RESTORE_FAILED:  'Rikuperim Dështoi',
  LARGE_SALE:      'Shitje e Madhe',
  SYSTEM_ERROR:    'Gabim Sistemi',
}

export const NOTIFICATION_SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  low:      'E ulët',
  medium:   'Mesatare',
  high:     'E lartë',
  critical: 'Kritike',
}

interface CreateNotificationParams {
  organizationId: number
  userId?: string | null
  type: NotificationType
  title: string
  message: string
  severity: NotificationSeverity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any> | null
}

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        type: params.type,
        title: params.title,
        message: params.message,
        severity: params.severity,
        metadata: params.metadata != null
          ? JSON.parse(JSON.stringify(params.metadata))
          : null,
      },
    })
  } catch (err) {
    console.error('[Notification] Failed to create notification:', err)
  }
}
