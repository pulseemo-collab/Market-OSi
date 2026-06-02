import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    debug: false,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.05,
    integrations: [Sentry.replayIntegration()],
    beforeSend(event) {
      // Strip any accidentally included credentials from URLs
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/password=[^&]*/gi, 'password=[Filtered]')
      }
      return event
    },
  })
}
