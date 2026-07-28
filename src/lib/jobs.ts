/**
 * Background job abstraction.
 *
 * Work that must happen because of a request, but that the caller should not
 * wait for — notification fan-out, report generation, backup preparation — is
 * enqueued here instead of blocking the response.
 *
 * The runner is deliberately in-process: jobs execute on the same Node.js
 * instance, after the response has been handed back. That is enough for the
 * current workload and adds no infrastructure. The seam that matters is the
 * `registerJob` / `enqueueJob` contract: swapping the runner for a durable
 * queue later means reimplementing `dispatch` only, with no changes at any call
 * site.
 *
 * Because execution is in-process, an enqueued job does not survive a restart.
 * Only enqueue work that is safe to lose — anything that must be durable
 * (audit trail, billing) stays on the request path.
 */

import { logJobFailure } from './logger'

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface JobContext {
  jobId: string
  attempt: number
}

export type JobHandler<P> = (payload: P, context: JobContext) => Promise<void>

export interface JobRecord {
  id: string
  name: string
  status: JobStatus
  attempts: number
  enqueuedAt: number
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export interface EnqueueOptions {
  /** Total attempts before the job is marked failed. */
  maxAttempts?: number
  /** Base delay for exponential backoff between attempts. */
  retryDelayMs?: number
  /** Tenant the work belongs to, recorded on failure logs. */
  organizationId?: number
}

const MAX_HISTORY = 200
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 500

const handlers = new Map<string, JobHandler<never>>()
const history = new Map<string, JobRecord>()

let running = 0
let totalSucceeded = 0
let totalFailed = 0

function remember(record: JobRecord): void {
  while (history.size >= MAX_HISTORY) {
    const oldest = history.keys().next()
    if (oldest.done) break
    history.delete(oldest.value)
  }
  history.set(record.id, record)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Registers the handler for a job name. Call at module load, once per name.
 */
export function registerJob<P>(name: string, handler: JobHandler<P>): void {
  handlers.set(name, handler as JobHandler<never>)
}

async function dispatch<P>(
  record: JobRecord,
  payload: P,
  handler: JobHandler<P>,
  maxAttempts: number,
  retryDelayMs: number,
  organizationId: number | undefined,
): Promise<void> {
  running += 1
  record.status = 'running'
  record.startedAt = Date.now()

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      record.attempts = attempt
      try {
        await handler(payload, { jobId: record.id, attempt })
        record.status = 'succeeded'
        record.finishedAt = Date.now()
        totalSucceeded += 1
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        record.error = message
        if (attempt === maxAttempts) {
          record.status = 'failed'
          record.finishedAt = Date.now()
          totalFailed += 1
          logJobFailure(record.name, record.id, attempt, message, organizationId)
          return
        }
        await sleep(retryDelayMs * attempt)
      }
    }
  } finally {
    running -= 1
  }
}

/**
 * Schedules `payload` for the named job and returns immediately.
 *
 * Execution starts on the next tick so the HTTP response is already on its way
 * out. Job failures never propagate to the caller — they are retried, then
 * logged.
 */
export function enqueueJob<P>(name: string, payload: P, options: EnqueueOptions = {}): string {
  const handler = handlers.get(name) as JobHandler<P> | undefined
  const id = crypto.randomUUID()

  const record: JobRecord = {
    id,
    name,
    status: 'pending',
    attempts: 0,
    enqueuedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    error: null,
  }
  remember(record)

  if (!handler) {
    record.status = 'failed'
    record.finishedAt = Date.now()
    record.error = 'No handler registered'
    totalFailed += 1
    logJobFailure(name, id, 0, 'No handler registered', options.organizationId)
    return id
  }

  setImmediate(() => {
    void dispatch(
      record,
      payload,
      handler,
      options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      options.organizationId,
    )
  })

  return id
}

export function getJob(id: string): JobRecord | undefined {
  return history.get(id)
}

/** Queue health — surfaced through /api/health. */
export function jobStats(): {
  registered: number
  running: number
  succeeded: number
  failed: number
} {
  return { registered: handlers.size, running, succeeded: totalSucceeded, failed: totalFailed }
}
