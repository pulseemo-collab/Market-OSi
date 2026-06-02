import * as Sentry from '@sentry/nextjs'

export interface SentryErrorContext {
  userId?: string | null
  userEmail?: string | null
  role?: string | null
  organizationId?: number | null
  route?: string
  action?: string
}

function isSentryEnabled(): boolean {
  return !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
}

export function captureApiError(error: unknown, context: SentryErrorContext = {}): void {
  if (!isSentryEnabled()) return

  Sentry.withScope((scope) => {
    if (context.userId || context.userEmail) {
      scope.setUser({
        id: context.userId ?? undefined,
        email: context.userEmail ?? undefined,
      })
    }
    if (context.role) scope.setTag('user.role', context.role)
    if (context.organizationId != null) {
      scope.setTag('organization.id', String(context.organizationId))
    }
    if (context.route) scope.setTag('api.route', context.route)
    if (context.action) scope.setTag('api.action', context.action)
    scope.setLevel('error')
    Sentry.captureException(error)
  })
}

export function setUserContext(context: SentryErrorContext): void {
  if (!isSentryEnabled()) return

  if (context.userId || context.userEmail) {
    Sentry.setUser({
      id: context.userId ?? undefined,
      email: context.userEmail ?? undefined,
    })
  }
  if (context.role) Sentry.setTag('user.role', context.role)
  if (context.organizationId != null) {
    Sentry.setTag('organization.id', String(context.organizationId))
  }
}
