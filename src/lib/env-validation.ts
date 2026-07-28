const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'NEXT_PUBLIC_APP_URL',
] as const

const OPTIONAL_VARS = [
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'LARGE_SALE_THRESHOLD',
  'SLOW_QUERY_MS',
] as const

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((k) => !process.env[k])

  if (missing.length > 0) {
    // Fail hard — missing required vars will cause runtime errors later.
    // Never log values, only names.
    throw new Error(
      `[env] Missing required environment variables: ${missing.join(', ')}. ` +
        'Check your .env.local file or deployment environment.',
    )
  }

  const missingOptional = OPTIONAL_VARS.filter((k) => !process.env[k])
  if (missingOptional.length > 0) {
    console.warn(
      `[env] Optional environment variables not set: ${missingOptional.join(', ')}`,
    )
  }

  // Validate URL formats (presence only — values already confirmed non-empty above)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!supabaseUrl.startsWith('https://')) {
    throw new Error('[env] NEXT_PUBLIC_SUPABASE_URL must start with https://')
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  if (!appUrl.startsWith('http://') && !appUrl.startsWith('https://')) {
    throw new Error('[env] NEXT_PUBLIC_APP_URL must start with http:// or https://')
  }
}
