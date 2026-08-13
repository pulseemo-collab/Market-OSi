/**
 * Timeout, retry and circuit-breaker primitives.
 *
 * These exist to bound the blast radius of a slow or failing dependency. The
 * failure they prevent is the cascade: one dependency stops answering, requests
 * pile up waiting on it, the runtime runs out of concurrent executions, and an
 * outage in something optional becomes an outage in everything.
 *
 * Deliberate non-goals:
 *
 *   - The primary database is not wrapped in a circuit breaker. Breaker state
 *     lives in one process; on a serverless platform each instance would learn
 *     the database is down independently and then, once open, would refuse
 *     requests the database could actually serve. Database protection is
 *     timeouts plus classification, which need no shared state.
 *   - Nothing here retries a write that is not idempotent. `withRetry` consults
 *     `AppError.retryable`, and every write path that uses it is either
 *     protected by an idempotency key or is a pure read.
 */

import {
  AppError,
  DependencyUnavailableError,
  TimeoutError,
  classifyError,
} from './errors'
import {
  recordCircuitState,
  recordDependencyFailure,
  recordRetry,
  recordRetryExhausted,
  recordTimeout,
} from './metrics'

/**
 * Timeout tiers, in milliseconds.
 *
 * Chosen so that a healthy operation never trips one: each is well above the
 * observed normal duration of its class, because a timeout that fires on
 * healthy traffic converts a slow request into a failed one and makes things
 * worse.
 */
export const TIMEOUTS = {
  /** In-process work with no I/O. */
  fast: parseInt(process.env.TIMEOUT_FAST_MS ?? '2000'),
  /** A single database query or short transaction. */
  database: parseInt(process.env.TIMEOUT_DATABASE_MS ?? '10000'),
  /** Outbound HTTP to a third party (Supabase Auth admin API). */
  external: parseInt(process.env.TIMEOUT_EXTERNAL_MS ?? '8000'),
  /** Deliberately long-running request work: restore, full export. */
  longRunning: parseInt(process.env.TIMEOUT_LONG_RUNNING_MS ?? '120000'),
} as const

export type TimeoutTier = keyof typeof TIMEOUTS

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

export interface TimeoutOptions {
  operation: string
  timeoutMs: number
  /** Caller-side cancellation; aborting rejects the wrapper immediately. */
  signal?: AbortSignal
}

/**
 * Rejects with `TimeoutError` if `task` has not settled within `timeoutMs`.
 *
 * `task` receives an `AbortSignal` that fires on timeout or on the caller's own
 * signal, so an implementation built on `fetch` can actually cancel the socket
 * rather than being abandoned while it keeps running.
 *
 * The timer is always cleared and the abort listener always removed, including
 * on the success path — a leaked interval or listener per request is a slow
 * memory leak in a long-lived process.
 */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const { operation, timeoutMs, signal: callerSignal } = options

  if (callerSignal?.aborted) {
    throw new TimeoutError(operation, 0, { detail: 'aborted before start' })
  }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onCallerAbort: (() => void) | undefined

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        recordTimeout(operation)
        reject(new TimeoutError(operation, timeoutMs))
      }, timeoutMs)
    })

    if (callerSignal) {
      onCallerAbort = () => controller.abort()
      callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }

    return await Promise.race([task(controller.signal), timeoutPromise])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (callerSignal && onCallerAbort) {
      callerSignal.removeEventListener('abort', onCallerAbort)
    }
  }
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export interface RetryOptions {
  operation: string
  /** Total attempts including the first. Must be >= 1. */
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  /** Overrides classification-based retryability. */
  isRetryable?: (error: AppError) => boolean
  organizationId?: number
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 100
const DEFAULT_MAX_DELAY_MS = 2000

/**
 * Full jitter: a uniform sample from `[0, exponential backoff]`.
 *
 * Plain exponential backoff synchronises retries — every client that failed at
 * the same moment retries at the same moment, and the dependency is hit by the
 * same spike that knocked it over. Randomising the whole interval spreads them.
 */
function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
  return Math.floor(Math.random() * ceiling)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = signal
      ? () => {
          clearTimeout(timer)
          reject(new TimeoutError('retry-wait', ms, { detail: 'aborted during backoff' }))
        }
      : undefined

    if (signal && onAbort) signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Runs `task`, retrying only failures classified as retryable.
 *
 * The loop is bounded by `attempts` and every exit path is terminal: it either
 * returns a value or throws. A non-retryable failure throws on the first
 * attempt rather than consuming the budget.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    operation,
    attempts = DEFAULT_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    signal,
    isRetryable,
    organizationId,
  } = options

  const total = Math.max(1, attempts)
  let lastError: AppError | undefined

  for (let attempt = 1; attempt <= total; attempt++) {
    try {
      return await task(attempt)
    } catch (raw) {
      const error = classifyError(raw)
      lastError = error

      const retryable = isRetryable ? isRetryable(error) : error.retryable

      if (!retryable || attempt === total) {
        if (retryable) {
          recordRetryExhausted(operation)
          logRetry('retry_exhausted', operation, attempt, total, error, organizationId)
        }
        throw error
      }

      const waitMs = backoffDelay(attempt, baseDelayMs, maxDelayMs)
      recordRetry(operation)
      logRetry('retry_attempt', operation, attempt, total, error, organizationId, waitMs)

      await delay(waitMs, signal)
    }
  }

  // Unreachable: the loop either returns or throws on its final attempt.
  throw lastError ?? new AppError('INTERNAL', 500, 'Gabim në server', 'retry loop fell through')
}

/**
 * Retry logging.
 *
 * Records the classified code and the developer-facing message, never the
 * request payload — retried operations routinely carry credentials, PINs and
 * customer data.
 */
function logRetry(
  type: 'retry_attempt' | 'retry_exhausted',
  operation: string,
  attempt: number,
  total: number,
  error: AppError,
  organizationId: number | undefined,
  waitMs?: number,
): void {
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      type,
      operation,
      attempt,
      maxAttempts: total,
      code: error.code,
      reason: error.message,
      waitMs: waitMs ?? null,
      orgId: organizationId ?? null,
    }),
  )
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitBreakerOptions {
  name: string
  /** Consecutive failures that trip the breaker. */
  failureThreshold?: number
  /** How long to stay OPEN before admitting one probe. */
  resetTimeoutMs?: number
  /** Consecutive probe successes needed to close again. */
  successThreshold?: number
}

/**
 * Consecutive-failure circuit breaker for a single optional dependency.
 *
 * CLOSED → OPEN on `failureThreshold` consecutive failures. OPEN rejects
 * immediately, which is the whole point: it converts a slow failure into a fast
 * one and stops the caller from spending a request slot waiting. After
 * `resetTimeoutMs` the next call is admitted as a HALF_OPEN probe; enough
 * consecutive successes close the breaker, any failure re-opens it.
 *
 * Only failures classified as infrastructure count. A dependency that
 * cheerfully returns 400 to a malformed request is healthy, and tripping the
 * breaker on that would take out every other caller.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private consecutiveFailures = 0
  private consecutiveSuccesses = 0
  private openedAt = 0

  private readonly name: string
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number
  private readonly successThreshold: number

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name
    this.failureThreshold = options.failureThreshold ?? 5
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000
    this.successThreshold = options.successThreshold ?? 2
  }

  getState(): CircuitState {
    // Resolve the elapsed-time transition on read so `/api/health` reports the
    // state the next call would actually see, not a stale OPEN.
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      return 'HALF_OPEN'
    }
    return this.state
  }

  async execute<T>(task: () => Promise<T>): Promise<T> {
    const state = this.getState()

    if (state === 'OPEN') {
      throw new DependencyUnavailableError(this.name, {
        detail: `circuit open for ${this.name}`,
      })
    }

    if (state === 'HALF_OPEN' && this.state === 'OPEN') {
      this.transitionTo('HALF_OPEN')
    }

    try {
      const result = await task()
      this.onSuccess()
      return result
    } catch (raw) {
      const error = classifyError(raw)
      // Only infrastructure failures are evidence the dependency is unhealthy.
      if (error.retryable) this.onFailure(error)
      else this.onSuccess()
      throw error
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0

    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses += 1
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.transitionTo('CLOSED')
      }
      return
    }

    this.consecutiveSuccesses = 0
  }

  private onFailure(error: AppError): void {
    recordDependencyFailure(this.name)
    this.consecutiveSuccesses = 0

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN')
      return
    }

    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.transitionTo('OPEN', error)
    }
  }

  private transitionTo(next: CircuitState, error?: AppError): void {
    if (this.state === next) return

    const previous = this.state
    this.state = next
    if (next === 'OPEN') this.openedAt = Date.now()
    if (next === 'CLOSED' || next === 'OPEN') this.consecutiveSuccesses = 0
    if (next === 'CLOSED') this.consecutiveFailures = 0

    recordCircuitState(this.name, next)

    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: next === 'CLOSED' ? 'info' : 'warn',
        type: 'circuit_breaker',
        dependency: this.name,
        from: previous,
        to: next,
        consecutiveFailures: this.consecutiveFailures,
        reason: error?.message ?? null,
      }),
    )
  }

  /** Snapshot for `/api/health`. */
  stats(): { name: string; state: CircuitState; consecutiveFailures: number } {
    return {
      name: this.name,
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
    }
  }
}

const breakers = new Map<string, CircuitBreaker>()

/** Returns the process-wide breaker for a dependency, creating it on first use. */
export function circuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  let breaker = breakers.get(options.name)
  if (!breaker) {
    breaker = new CircuitBreaker(options)
    breakers.set(options.name, breaker)
  }
  return breaker
}

/** State of every registered breaker — surfaced through /api/health. */
export function circuitStats(): Array<{
  name: string
  state: CircuitState
  consecutiveFailures: number
}> {
  return Array.from(breakers.values()).map((b) => b.stats())
}
