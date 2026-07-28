export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./lib/env-validation')
    try {
      validateEnv()
    } catch (err) {
      // Log the error but don't crash the server — the specific routes that need
      // the missing var will fail with their own errors, which is more debuggable.
      console.error((err as Error).message)
    }

    await import('../sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}
