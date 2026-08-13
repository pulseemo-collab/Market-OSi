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
import { classifyError } from './errors'
import { withTimeout } from './reliability'
import { recordJobOutcome } from './metrics'

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
  /** Ceiling on one attempt. Defaults to JOB_ATTEMPT_TIMEOUT_MS. */
  attemptTimeoutMs?: number
}

const MAX_HISTORY = 200
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 500

/**
 * Ceiling on jobs executing at once, and on jobs waiting to.
 *
 * Without the first, a burst of sales starts a burst of background scans that
 * compete with the POS requests that created them for the same connection pool
 * — the load spike amplifies itself. Without the second, the wait list is an
 * unbounded in-memory queue; past the cap, work is refused and logged rather
 * than silently accumulating.
 */
const MAX_CONCURRENT = parseInt(process.env.JOB_MAX_CONCURRENT ?? '4')
const MAX_QUEUED = parseInt(process.env.JOB_MAX_QUEUED ?? '100')
/** Ceiling on a single attempt, so a hung handler cannot occupy a slot forever. */
const JOB_ATTEMPT_TIMEOUT_MS = parseInt(process.env.JOB_ATTEMPT_TIMEOUT_MS ?? '30000')

const handlers = new Map<string, JobHandler<never>>()
const history = new Map<string, JobRecord>()

interface QueuedJob {
  run: () => Promise<void>
}

const queue: QueuedJob[] = []

let running = 0
let totalSucceeded = 0
let totalFailed = 0
let totalRejected = 0

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
 * Exponential backoff with full jitter.
 *
 * Jobs enqueued by the same traffic spike fail at the same moment for the same
 * reason; retrying them all on an identical schedule reproduces the spike that
 * caused the failure. Randomising the interval spreads the second wave.
 */
function backoff(attempt: number, baseDelayMs: number): number {
  const ceiling = Math.min(30_000, baseDelayMs * 2 ** (attempt - 1))
  return Math.floor(Math.random() * ceiling)
}

/** Starts queued work while a slot is free. */
function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift()!
    void next.run()
  }
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
  attemptTimeoutMs: number,
): Promise<void> {
  running += 1
  record.status = 'running'
  record.startedAt = Date.now()

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      record.attempts = attempt
      try {
        await withTimeout(() => handler(payload, { jobId: record.id, attempt }), {
          operation: `job:${record.name}`,
          timeoutMs: attemptTimeoutMs,
        })
        record.status = 'succeeded'
        record.finishedAt = Date.now()
        totalSucceeded += 1
        recordJobOutcome(record.name, 'succeeded')
        return
      } catch (err) {
        const error = classifyError(err)
        record.error = error.message

        // A deterministic failure — a validation error, a missing row, a bug —
        // will fail identically on every attempt. Burning the retry budget on
        // it only delays the terminal state and adds load, so it ends here.
        const lastAttempt = attempt === maxAttempts
        if (lastAttempt || !error.retryable) {
          // Record *why* it stopped, not just what failed: "stopped early
          // because the error was deterministic" and "exhausted three attempts"
          // call for different responses from whoever reads the job history.
          record.error = error.retryable
            ? error.message
            : `${error.message} (non-retryable, ${error.code})`
          record.status = 'failed'
          record.finishedAt = Date.now()
          totalFailed += 1
          recordJobOutcome(record.name, 'failed')
          logJobFailure(record.name, record.id, attempt, record.error, organizationId)
          return
        }

        await sleep(backoff(attempt, retryDelayMs))
      }
    }
  } finally {
    running -= 1
    // Hand the slot to whatever is waiting, on the next tick so a long queue
    // cannot monopolise the current one.
    setImmediate(pump)
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

  if (queue.length >= MAX_QUEUED) {
    record.status = 'failed'
    record.finishedAt = Date.now()
    record.error = 'Queue full'
    totalRejected += 1
    recordJobOutcome(name, 'rejected')
    logJobFailure(name, id, 0, `queue full (${queue.length}/${MAX_QUEUED})`, options.organizationId)
    return id
  }

  queue.push({
    run: () =>
      dispatch(
        record,
        payload,
        handler,
        options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
        options.organizationId,
        options.attemptTimeoutMs ?? JOB_ATTEMPT_TIMEOUT_MS,
      ),
  })

  // Start on the next tick so the HTTP response is already on its way out.
  setImmediate(pump)

  return id
}

export function getJob(id: string): JobRecord | undefined {
  return history.get(id)
}

/** Queue health — surfaced through /api/health. */
export function jobStats(): {
  registered: number
  running: number
  queued: number
  maxConcurrent: number
  maxQueued: number
  succeeded: number
  failed: number
  rejected: number
} {
  return {
    registered: handlers.size,
    running,
    queued: queue.length,
    maxConcurrent: MAX_CONCURRENT,
    maxQueued: MAX_QUEUED,
    succeeded: totalSucceeded,
    failed: totalFailed,
    rejected: totalRejected,
  }
}
