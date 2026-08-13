/**
 * Background-job reliability.
 *
 * The failures under test are the ones that turn a small background problem
 * into an application-wide one: a job that retries forever, a burst of jobs
 * that saturates the connection pool the POS needs, a hung handler that never
 * releases its slot, and a job failure that escapes into the request that
 * enqueued it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { enqueueJob, getJob, jobStats, registerJob } from '../src/lib/jobs'
import { DependencyUnavailableError, ValidationError } from '../src/lib/errors'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Polls until the job reaches a terminal state, or the budget runs out. */
async function settle(jobId: string, budgetMs = 5000): Promise<string> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const status = getJob(jobId)?.status
    if (status === 'succeeded' || status === 'failed') return status
    await sleep(5)
  }
  return getJob(jobId)?.status ?? 'missing'
}

test('a transient job failure is retried and then succeeds', async () => {
  let attempts = 0
  registerJob<null>('t-flaky', async () => {
    attempts += 1
    if (attempts < 3) throw new DependencyUnavailableError('db')
  })

  const id = enqueueJob<null>('t-flaky', null, { maxAttempts: 5, retryDelayMs: 1 })

  assert.equal(await settle(id), 'succeeded')
  assert.equal(attempts, 3)
  assert.equal(getJob(id)?.attempts, 3)
})

test('a permanently failing job stops at its cap instead of retrying forever', async () => {
  let attempts = 0
  registerJob<null>('t-doomed', async () => {
    attempts += 1
    throw new DependencyUnavailableError('gone')
  })

  const id = enqueueJob<null>('t-doomed', null, { maxAttempts: 3, retryDelayMs: 1 })

  assert.equal(await settle(id), 'failed')
  assert.equal(attempts, 3, 'the retry budget must be finite')

  // Terminal means terminal: nothing re-arms the job afterwards.
  await sleep(60)
  assert.equal(attempts, 3)
  assert.equal(getJob(id)?.status, 'failed')
})

test('a deterministic failure goes terminal on the first attempt', async () => {
  let attempts = 0
  registerJob<null>('t-invalid', async () => {
    attempts += 1
    throw new ValidationError('malformed payload')
  })

  const id = enqueueJob<null>('t-invalid', null, { maxAttempts: 5, retryDelayMs: 1 })

  assert.equal(await settle(id), 'failed')
  assert.equal(attempts, 1, 'a bug will fail identically on every attempt')
  assert.match(getJob(id)?.error ?? '', /non-retryable/)
})

test('a hung job handler cannot hold its slot forever', async () => {
  registerJob<null>('t-hung', () => new Promise<void>(() => {}))

  const id = enqueueJob<null>('t-hung', null, {
    maxAttempts: 1,
    retryDelayMs: 1,
    attemptTimeoutMs: 200,
  })

  assert.equal(await settle(id, 3000), 'failed')
  assert.match(getJob(id)?.error ?? '', /timeout/i)
})

test('an unhandled throw inside a job never reaches the enqueuing request', async () => {
  registerJob<null>('t-throws', async () => {
    throw new Error('kaboom')
  })

  // enqueueJob is fire-and-forget by contract: the sale that triggered the
  // low-stock scan must not fail because the scan did.
  const id = enqueueJob<null>('t-throws', null, { maxAttempts: 1, retryDelayMs: 1 })
  assert.equal(typeof id, 'string')

  assert.equal(await settle(id), 'failed')
})

test('an unregistered job name fails immediately and is recorded', () => {
  const id = enqueueJob<null>('t-does-not-exist', null)

  assert.equal(getJob(id)?.status, 'failed')
  assert.equal(getJob(id)?.error, 'No handler registered')
})

test('concurrent execution is capped so a job burst cannot saturate the pool', async () => {
  let active = 0
  let peak = 0

  registerJob<null>('t-parallel', async () => {
    active += 1
    peak = Math.max(peak, active)
    await sleep(30)
    active -= 1
  })

  const ids = Array.from({ length: 20 }, () =>
    enqueueJob<null>('t-parallel', null, { maxAttempts: 1 }),
  )

  for (const id of ids) await settle(id, 10_000)

  const cap = jobStats().maxConcurrent
  assert.ok(peak <= cap, `peak concurrency ${peak} must not exceed the cap ${cap}`)
  assert.ok(peak > 1, 'jobs should still run in parallel up to the cap')
})

test('the wait list is bounded — excess work is refused, not accumulated', async () => {
  registerJob<null>('t-flood', async () => {
    await sleep(20)
  })

  const stats = jobStats()
  const ids = Array.from({ length: stats.maxQueued + stats.maxConcurrent + 25 }, () =>
    enqueueJob<null>('t-flood', null, { maxAttempts: 1 }),
  )

  const rejected = ids.filter((id) => getJob(id)?.error === 'Queue full')
  assert.ok(rejected.length > 0, 'an unbounded in-memory queue is the failure mode being prevented')
  assert.ok(jobStats().queued <= stats.maxQueued)

  for (const id of ids) await settle(id, 20_000)
})
