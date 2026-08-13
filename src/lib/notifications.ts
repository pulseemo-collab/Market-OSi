import { prisma } from './prisma'
import type { NotificationSeverity, NotificationType } from './notification-types'

/**
 * Server-side notification writer.
 *
 * The vocabulary lives in `./notification-types` because that module is free of
 * server-only imports and can therefore be used by client components. It is
 * re-exported here so existing server callers keep a single import site.
 */
export {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_SEVERITY_LABELS,
} from './notification-types'
export type { NotificationType, NotificationSeverity } from './notification-types'

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
