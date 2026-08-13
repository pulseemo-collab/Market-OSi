/**
 * Notification vocabulary — types, severities and their Albanian labels.
 *
 * Deliberately free of any server-only import. These constants are needed by
 * the notifications page, which is a client component, and `./notifications`
 * cannot serve them: that module imports the Prisma client, so bundling it for
 * the browser instantiates PrismaClient there, which throws during module
 * evaluation and takes the whole React tree down with it.
 *
 * Server code keeps importing from `./notifications`, which re-exports
 * everything here, so there is one vocabulary with two safe entry points.
 */

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
