const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
}

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  hideSourceMaps: true,
})
