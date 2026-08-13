/**
 * Failure-injection tests for the timeout, retry and circuit-breaker
 * primitives, and for the concurrency limiter.
 *
 * These simulate the dependency behaviours the primitives exist to survive:
 * hanging, failing transiently, failing permanently, and arriving all at once.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { CircuitBreaker, withRetry, withTimeout } from '../src/lib/reliability'
import { withConcurrencyLimit } from '../src/lib/overload'
import {
  AppError,
  DependencyUnavailableError,
  OverloadedError,
  TimeoutError,
  ValidationError,
  classifyError,
} from '../src/lib/errors'

const never = () => new Promise<never>(() => {})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

test('a dependency that never responds fails as a bounded TimeoutError', async () => {
  const started = Date.now()

  await assert.rejects(
    () => withTimeout(never, { operation: 'hanging-dep', timeoutMs: 50 }),
    (error: unknown) => {
      assert.ok(error instanceof TimeoutError)
      assert.equal(error.status, 504)
      assert.equal(error.retryable, true)
      // The client message names no host, driver or internal path.
      assert.equal(error.clientMessage, 'Veprimi zgjati shumë. Ju lutem provoni përsëri.')
      return true
    },
  )

  assert.ok(Date.now() - started < 1000, 'must not wait for the dependency')
})

test('a fast operation is untouched by its timeout', async () => {
  const result = await withTimeout(async () => 'ok', { operation: 'fast', timeoutMs: 1000 })
  assert.equal(result, 'ok')
})

test('timeout aborts the signal handed to the task, so the work can cancel itself', async () => {
  let aborted = false

  await assert.rejects(() =>
    withTimeout(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('cancelled'))
          })
        }),
      { operation: 'cancellable', timeoutMs: 30 },
    ),
  )

  assert.equal(aborted, true)
})

test('caller cancellation propagates into the task', async () => {
  const controller = new AbortController()
  let aborted = false

  const pending = withTimeout(
    (signal) =>
      new Promise<never>(() => {
        signal.addEventListener('abort', () => {
          aborted = true
        })
      }),
    { operation: 'abandoned', timeoutMs: 5000, signal: controller.signal },
  )

  controller.abort()
  await sleep(10)

  assert.equal(aborted, true, 'an abandoned request must not keep the work running')
  void pending.catch(() => {})
})

test('a timer is not left behind on the success path', async () => {
  // A leaked timer per request keeps the event loop alive and leaks memory in a
  // long-lived process. If one leaked, this test would not exit.
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  await withTimeout(async () => 'done', { operation: 'clean', timeoutMs: 10_000 })
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length

  assert.ok(after <= before, 'the timeout timer must be cleared when the task settles first')
})

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

test('a transient failure followed by success is retried and succeeds', async () => {
  let attempts = 0

  const result = await withRetry(
    async () => {
      attempts += 1
      if (attempts < 3) throw new DependencyUnavailableError('flaky')
      return 'recovered'
    },
    { operation: 'flaky-dep', attempts: 5, baseDelayMs: 1 },
  )

  assert.equal(result, 'recovered')
  assert.equal(attempts, 3)
})

test('a permanently failing dependency exhausts a bounded budget and then stops', async () => {
  let attempts = 0

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1
          throw new DependencyUnavailableError('down')
        },
        { operation: 'dead-dep', attempts: 4, baseDelayMs: 1 },
      ),
    DependencyUnavailableError,
  )

  assert.equal(attempts, 4, 'the retry loop must terminate at the configured cap')
})

test('a deterministic failure is not retried at all', async () => {
  let attempts = 0

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1
          throw new ValidationError('Sasia duhet të jetë pozitive')
        },
        { operation: 'bad-input', attempts: 5, baseDelayMs: 1 },
      ),
    ValidationError,
  )

  // Retrying a validation error cannot change the outcome; it only spends the
  // dependency's capacity to fail again.
  assert.equal(attempts, 1)
})

test('retry backoff is jittered rather than a fixed schedule', async () => {
  const observed = new Set<number>()

  for (let run = 0; run < 12; run++) {
    let last = Date.now()
    let attempts = 0
    await withRetry(
      async () => {
        const now = Date.now()
        if (attempts > 0) observed.add(now - last)
        last = now
        attempts += 1
        if (attempts < 2) throw new DependencyUnavailableError('flaky')
        return 'ok'
      },
      { operation: 'jitter-check', attempts: 2, baseDelayMs: 40 },
    )
  }

  // Full jitter samples uniformly from [0, ceiling); a fixed schedule would
  // collapse to a single value and re-synchronise every retrying client.
  assert.ok(observed.size > 1, 'delays must vary between runs')
})

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

test('repeated dependency failure opens the circuit and then fails fast', async () => {
  const breaker = new CircuitBreaker({
    name: 'test-dep',
    failureThreshold: 3,
    resetTimeoutMs: 10_000,
  })

  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => breaker.execute(() => Promise.reject(new DependencyUnavailableError('x'))))
  }

  assert.equal(breaker.getState(), 'OPEN')

  // Once open, the dependency is not called at all — this is what stops a
  // failing dependency from consuming every request slot.
  let called = false
  await assert.rejects(
    () =>
      breaker.execute(async () => {
        called = true
        return 'unused'
      }),
    DependencyUnavailableError,
  )
  assert.equal(called, false)
})

test('a deterministic error from a healthy dependency does not open the circuit', async () => {
  const breaker = new CircuitBreaker({ name: 'picky-dep', failureThreshold: 2 })

  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => breaker.execute(() => Promise.reject(new ValidationError('nope'))))
  }

  // A dependency that rejects malformed input is working correctly. Tripping on
  // that would take it away from every other caller.
  assert.equal(breaker.getState(), 'CLOSED')
})

test('the circuit half-opens after its reset window and closes on sustained success', async () => {
  const breaker = new CircuitBreaker({
    name: 'recovering-dep',
    failureThreshold: 2,
    resetTimeoutMs: 30,
    successThreshold: 2,
  })

  for (let i = 0; i < 2; i++) {
    await assert.rejects(() => breaker.execute(() => Promise.reject(new DependencyUnavailableError('x'))))
  }
  assert.equal(breaker.getState(), 'OPEN')

  await sleep(50)
  assert.equal(breaker.getState(), 'HALF_OPEN')

  assert.equal(await breaker.execute(async () => 'probe-1'), 'probe-1')
  assert.equal(await breaker.execute(async () => 'probe-2'), 'probe-2')
  assert.equal(breaker.getState(), 'CLOSED')
})

test('a failed probe re-opens the circuit immediately', async () => {
  const breaker = new CircuitBreaker({
    name: 'still-broken-dep',
    failureThreshold: 2,
    resetTimeoutMs: 30,
    successThreshold: 2,
  })

  for (let i = 0; i < 2; i++) {
    await assert.rejects(() => breaker.execute(() => Promise.reject(new DependencyUnavailableError('x'))))
  }
  await sleep(50)
  assert.equal(breaker.getState(), 'HALF_OPEN')

  await assert.rejects(() => breaker.execute(() => Promise.reject(new DependencyUnavailableError('x'))))
  assert.equal(breaker.getState(), 'OPEN', 'one failed probe is enough evidence')
})

// ---------------------------------------------------------------------------
// Concurrency limiting
// ---------------------------------------------------------------------------

test('an expensive operation past its ceiling is rejected, not queued', async () => {
  const options = { name: 'test-restore', maxConcurrent: 1 }
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })

  const first = withConcurrencyLimit(options, 1, () => held)
  await sleep(5)

  await assert.rejects(
    () => withConcurrencyLimit(options, 1, async () => 'second'),
    (error: unknown) => {
      assert.ok(error instanceof OverloadedError)
      assert.equal(error.status, 503)
      return true
    },
  )

  release()
  await first
})

test('the ceiling is per tenant, so one organization cannot lock out another', async () => {
  const options = { name: 'test-per-org', maxConcurrent: 1 }
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })

  const busy = withConcurrencyLimit(options, 1, () => held)
  await sleep(5)

  assert.equal(await withConcurrencyLimit(options, 2, async () => 'ok'), 'ok')

  release()
  await busy
})

test('a slot is released even when the operation throws', async () => {
  const options = { name: 'test-release', maxConcurrent: 1 }

  await assert.rejects(() => withConcurrencyLimit(options, 1, () => Promise.reject(new Error('boom'))))

  // If the slot leaked, this call would be rejected as overloaded and the
  // operation would be permanently unavailable on this instance.
  assert.equal(await withConcurrencyLimit(options, 1, async () => 'ok'), 'ok')
})

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('an unreachable database is classified as retryable 503, not a 500', () => {
  const classified = classifyError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'P1001' }))

  assert.equal(classified.status, 503)
  assert.equal(classified.code, 'DATABASE_UNAVAILABLE')
  assert.equal(classified.retryable, true)
})

test('an exhausted connection pool is a capacity signal, not a defect', () => {
  const classified = classifyError(Object.assign(new Error('pool timeout'), { code: 'P2024' }))

  assert.equal(classified.status, 503)
  assert.equal(classified.retryable, true)
})

test('a unique-constraint violation becomes a 409 with no driver detail', () => {
  const raw = Object.assign(
    new Error('Unique constraint failed on the fields: (`barcode`) in table `ProductBarcode`'),
    { code: 'P2002' },
  )
  const classified = classifyError(raw)

  assert.equal(classified.status, 409)
  assert.equal(classified.retryable, false)
  assert.ok(!/ProductBarcode|constraint/i.test(classified.clientMessage))
})

test('an unrecognised error keeps its detail server-side and says nothing to the client', () => {
  const classified = classifyError(
    new Error('SELECT * FROM "Sale" WHERE password=... at /var/task/src/db.js:42'),
  )

  assert.equal(classified.status, 500)
  assert.equal(classified.code, 'INTERNAL')
  assert.equal(classified.clientMessage, 'Gabim në server')
  assert.ok(classified.detail?.includes('SELECT'), 'the original is kept for the server log')
})

test('an already-classified error passes through unchanged', () => {
  const original = new ValidationError('Sasia duhet të jetë pozitive')
  assert.equal(classifyError(original), original)
})

test('every taxonomy member maps to its documented status', () => {
  const cases: Array<[AppError, number]> = [
    [new ValidationError('x'), 400],
    [new OverloadedError('x'), 503],
    [new DependencyUnavailableError('x'), 503],
    [new TimeoutError('x', 1), 504],
  ]

  for (const [error, status] of cases) {
    assert.equal(error.status, status, `${error.code} must map to ${status}`)
  }
})
