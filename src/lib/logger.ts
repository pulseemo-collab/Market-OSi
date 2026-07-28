import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { headers as nextHeaders } from 'next/headers'
import { recordEndpoint } from './metrics'

export interface RequestContext {
  requestId: string
  method: string
  route: string
  ip: string | null
  userAgent: string | null
  userId?: string | null
  orgId?: number | null
  startedAt: number
}

export function createRequestContext(req: NextRequest, route: string): RequestContext {
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded
    ? forwarded.split(',')[0].trim()
    : (req.headers.get('x-real-ip') ?? null)

  return {
    requestId: req.headers.get('x-request-id') ?? crypto.randomUUID(),
    method: req.method,
    route,
    ip,
    userAgent: req.headers.get('user-agent'),
    startedAt: Date.now(),
  }
}

export function logRequest(
  ctx: RequestContext,
  status: number,
  extra?: Record<string, unknown>,
): void {
  const durationMs = Date.now() - ctx.startedAt
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    requestId: ctx.requestId,
    method: ctx.method,
    route: ctx.route,
    status,
    durationMs,
    userId: ctx.userId ?? null,
    orgId: ctx.orgId ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    ...extra,
  }
  console.log(JSON.stringify(entry))
}

export function logError(
  ctx: RequestContext,
  error: unknown,
  meta?: Record<string, unknown>,
): void {
  const err = error instanceof Error ? error : new Error(String(error))
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    requestId: ctx.requestId,
    route: ctx.route,
    method: ctx.method,
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    userId: ctx.userId ?? null,
    orgId: ctx.orgId ?? null,
    ip: ctx.ip,
    ...meta,
  }
  console.error(JSON.stringify(entry))
}

export function logWarn(
  ctx: RequestContext,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    requestId: ctx.requestId,
    route: ctx.route,
    message,
    userId: ctx.userId ?? null,
    orgId: ctx.orgId ?? null,
    ...meta,
  }
  console.warn(JSON.stringify(entry))
}

/**
 * Wraps a route handler to time it, record per-endpoint metrics and guarantee
 * that every API response carries its request id.
 *
 * Responses slower than SLOW_ENDPOINT_MS produce a `slow_endpoint` log line, the
 * endpoint-level counterpart to Phase A's `slow_query`. Thrown errors are logged
 * with the request context and re-thrown so Next.js and Sentry still see them.
 *
 * `Server-Timing` exposes the same duration to browser devtools.
 */
export function instrumentRoute<C>(
  route: string,
  handler: (req: NextRequest, context: C) => Promise<NextResponse>,
): (req: NextRequest, context: C) => Promise<NextResponse> {
  return async (req: NextRequest, context: C): Promise<NextResponse> => {
    const ctx = createRequestContext(req, route)
    try {
      const response = await handler(req, context)
      const durationMs = Date.now() - ctx.startedAt
      recordEndpoint(route, ctx.method, response.status, durationMs)
      response.headers.set('X-Request-Id', ctx.requestId)
      response.headers.set('Server-Timing', `app;dur=${durationMs}`)
      return response
    } catch (error) {
      recordEndpoint(route, ctx.method, 500, Date.now() - ctx.startedAt)
      logError(ctx, error)
      throw error
    }
  }
}

/**
 * Background jobs run detached from any request, so they have no RequestContext
 * to log against. They get their own structured line instead.
 */
export function logJobFailure(
  jobName: string,
  jobId: string,
  attempt: number,
  message: string,
  organizationId?: number,
): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      type: 'job_failed',
      jobName,
      jobId,
      attempt,
      message,
      orgId: organizationId ?? null,
    }),
  )
}

export function requestIdHeaders(requestId: string): Record<string, string> {
  return { 'X-Request-Id': requestId }
}

// Overload: with req (route handlers that receive NextRequest)
export function errorResponse(req: NextRequest, message: string, status: number): NextResponse
// Overload: without req (GET handlers; reads requestId from Next.js request store)
export function errorResponse(message: string, status: number): NextResponse
export function errorResponse(
  reqOrMessage: NextRequest | string,
  messageOrStatus: string | number,
  status?: number,
): NextResponse {
  let requestId: string
  let message: string
  let statusCode: number

  if (typeof reqOrMessage === 'string') {
    message = reqOrMessage
    statusCode = messageOrStatus as number
    try { requestId = nextHeaders().get('x-request-id') ?? crypto.randomUUID() }
    catch { requestId = crypto.randomUUID() }
  } else {
    requestId = reqOrMessage.headers.get('x-request-id') ?? crypto.randomUUID()
    message = messageOrStatus as string
    statusCode = status!
  }

  return NextResponse.json(
    { error: message, requestId },
    { status: statusCode, headers: { 'X-Request-Id': requestId } },
  )
}
