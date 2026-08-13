/**
 * Error taxonomy.
 *
 * Phase A standardised the *shape* of an error response; this module
 * standardises its *classification*. Every failure that reaches a client is one
 * of a small set of kinds, each with a fixed HTTP status and a safe Albanian
 * message. Diagnostic detail stays on the server.
 *
 * Two rules hold throughout:
 *
 *   1. A client never sees a driver-level message. Prisma and PostgreSQL errors
 *      are translated here — their text can contain table names, column names,
 *      constraint names and fragments of the failing query.
 *   2. `retryable` is a property of the error, not a guess made at the call
 *      site. Retry helpers consult it instead of re-deriving it.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERNAL'

export interface AppErrorOptions {
  /** Detail for server logs only — never serialised into a response. */
  detail?: string
  cause?: unknown
  /** Overrides the default retryability for this code. */
  retryable?: boolean
}

/**
 * Base class for every classified failure.
 *
 * `message` is developer-facing and logged. `clientMessage` is what the user
 * sees, and is the only part that crosses the network.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly clientMessage: string
  readonly retryable: boolean
  readonly detail?: string

  constructor(
    code: ErrorCode,
    status: number,
    clientMessage: string,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = new.target.name
    this.code = code
    this.status = status
    this.clientMessage = clientMessage
    this.detail = options.detail
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE.has(code)
  }
}

/**
 * Codes where a retry can plausibly succeed without changing the request.
 *
 * Everything absent from this set is deterministic: retrying a validation or
 * authorization failure just spends the dependency's capacity to fail again.
 */
const DEFAULT_RETRYABLE = new Set<ErrorCode>([
  'DEPENDENCY_UNAVAILABLE',
  'DATABASE_UNAVAILABLE',
  'TIMEOUT',
  'OVERLOADED',
])

export class ValidationError extends AppError {
  constructor(clientMessage: string, options?: AppErrorOptions) {
    super('VALIDATION', 400, clientMessage, `validation: ${clientMessage}`, options)
  }
}

export class AuthenticationError extends AppError {
  constructor(clientMessage = 'Nuk jeni i autentikuar', options?: AppErrorOptions) {
    super('UNAUTHENTICATED', 401, clientMessage, 'authentication required', options)
  }
}

export class AuthorizationError extends AppError {
  constructor(clientMessage = 'Akses i mohuar', options?: AppErrorOptions) {
    super('UNAUTHORIZED', 403, clientMessage, 'authorization denied', options)
  }
}

export class NotFoundError extends AppError {
  constructor(clientMessage = 'Burimi nuk u gjet', options?: AppErrorOptions) {
    super('NOT_FOUND', 404, clientMessage, `not found: ${clientMessage}`, options)
  }
}

export class ConflictError extends AppError {
  constructor(clientMessage: string, options?: AppErrorOptions) {
    super('CONFLICT', 409, clientMessage, `conflict: ${clientMessage}`, options)
  }
}

/**
 * A rule of the business domain refused the operation — not a malformed
 * request, and not something a retry can fix.
 */
export class BusinessRuleError extends AppError {
  constructor(clientMessage: string, options?: AppErrorOptions) {
    super('BUSINESS_RULE', 409, clientMessage, `business rule: ${clientMessage}`, options)
  }
}

/**
 * Concurrent demand consumed stock between validation and commit.
 *
 * Distinct from the plain "not enough stock" validation failure: this one is
 * only reachable when another transaction won the race, so the client should
 * re-read stock and let the operator decide, never blind-retry.
 */
export class StockConflictError extends ConflictError {
  constructor(productName: string) {
    super(`Stoku ndryshoi gjatë shitjes për: ${productName}. Rifreskoni dhe provoni përsëri.`, {
      detail: `stock conflict on product "${productName}"`,
      retryable: false,
    })
  }
}

export class RateLimitError extends AppError {
  constructor(clientMessage = 'Shumë kërkesa. Ju lutem provoni përsëri pas pak.') {
    super('RATE_LIMITED', 429, clientMessage, 'rate limited')
  }
}

/** The instance is at its concurrency ceiling for an expensive operation. */
export class OverloadedError extends AppError {
  constructor(operation: string) {
    super(
      'OVERLOADED',
      503,
      'Sistemi është i ngarkuar. Ju lutem provoni përsëri pas pak.',
      `overloaded: ${operation}`,
      { detail: `concurrency limit reached for ${operation}` },
    )
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(dependency: string, options?: AppErrorOptions) {
    super(
      'DEPENDENCY_UNAVAILABLE',
      503,
      'Shërbimi është përkohësisht i padisponueshëm. Provoni përsëri.',
      `dependency unavailable: ${dependency}`,
      options,
    )
  }
}

export class DatabaseUnavailableError extends AppError {
  constructor(options?: AppErrorOptions) {
    super(
      'DATABASE_UNAVAILABLE',
      503,
      'Baza e të dhënave është përkohësisht e padisponueshme.',
      'database unavailable',
      options,
    )
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number, options?: AppErrorOptions) {
    super(
      'TIMEOUT',
      504,
      'Veprimi zgjati shumë. Ju lutem provoni përsëri.',
      `timeout after ${timeoutMs}ms: ${operation}`,
      { ...options, detail: options?.detail ?? `operation=${operation} timeoutMs=${timeoutMs}` },
    )
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Prisma error codes that describe an unreachable or exhausted database rather
 * than a bad query. These are the ones worth retrying and worth reporting as
 * 503 instead of 500.
 *
 * P2024 (connection pool exhausted) is included deliberately: under a traffic
 * spike it is a capacity signal, not a defect.
 */
const PRISMA_INFRASTRUCTURE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])

function prismaCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/**
 * Maps any thrown value onto the taxonomy.
 *
 * Anything unrecognised becomes a generic 500 whose client message says
 * nothing about the cause — the original is preserved in `detail` and `cause`
 * for the server log.
 */
export function classifyError(error: unknown): AppError {
  if (error instanceof AppError) return error

  const code = prismaCodeOf(error)

  if (code !== null) {
    if (PRISMA_INFRASTRUCTURE_CODES.has(code)) {
      return code === 'P1002' || code === 'P1008'
        ? new TimeoutError('database', 0, { cause: error, detail: `prisma ${code}` })
        : new DatabaseUnavailableError({ cause: error, detail: `prisma ${code}` })
    }
    if (code === 'P2002') {
      return new ConflictError('Ky rekord ekziston tashmë', {
        cause: error,
        detail: 'prisma P2002 unique constraint',
      })
    }
    if (code === 'P2025') {
      return new NotFoundError('Burimi nuk u gjet', {
        cause: error,
        detail: 'prisma P2025',
      })
    }
    if (code === 'P2003') {
      return new ConflictError('Veprimi bie ndesh me të dhëna të lidhura', {
        cause: error,
        detail: 'prisma P2003 foreign key',
      })
    }
  }

  // Initialization failures carry no `code` but mean the client never reached
  // the server.
  const name = error instanceof Error ? error.name : ''
  if (name === 'PrismaClientInitializationError') {
    return new DatabaseUnavailableError({ cause: error, detail: name })
  }

  if (name === 'AbortError' || name === 'TimeoutError') {
    return new TimeoutError('external', 0, { cause: error, detail: name })
  }

  return new AppError('INTERNAL', 500, 'Gabim në server', 'unclassified error', {
    cause: error,
    detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

export interface ErrorResponseBody {
  error: string
  code: ErrorCode
  requestId: string
}

/**
 * Renders a classified error as the API's standard error response.
 *
 * The body carries only the safe message, the stable code and the request id —
 * the same three things Phase A already guaranteed, plus the code. Callers that
 * need the diagnostic detail log the `AppError` itself.
 */
export function errorResponseFrom(req: NextRequest, error: AppError): NextResponse {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()

  const headers: Record<string, string> = { 'X-Request-Id': requestId }
  if (error.status === 503 || error.status === 429) headers['Retry-After'] = '5'

  const body: ErrorResponseBody = {
    error: error.clientMessage,
    code: error.code,
    requestId,
  }

  return NextResponse.json(body, { status: error.status, headers })
}
