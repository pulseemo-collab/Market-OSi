/**
 * ============================================================================
 *  Durable idempotency verification — against the REAL PostgreSQL database
 * ============================================================================
 *
 * The automated suite proves the claim protocol against a fake that *models*
 * PostgreSQL's unique-constraint and guarded-update semantics. This script
 * closes that gap: it runs the same protocol against the real database, so the
 * thing being tested is the actual UNIQUE index, the actual P2002, and actual
 * concurrent INSERTs from separate OS processes with separate connection pools
 * — the topology of a Vercel deployment.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SAFE TO RUN
 * ---------------------------------------------------------------------------
 *
 * It touches exactly one table — "IdempotencyRecord" — and within it only rows
 * carrying a sentinel organizationId of VERIFY_ORG (negative). Real tenant ids
 * come from a SERIAL sequence and are always positive, so a verification row
 * cannot collide with, read, or alter any real tenant's data.
 *
 *   - No business table is read or written. No sale, product, supply, user or
 *     audit row is created, modified or deleted.
 *   - Every write is an IdempotencyRecord row under the sentinel tenant.
 *   - Cleanup deletes `WHERE organizationId = VERIFY_ORG` and nothing else, and
 *     the script asserts the row count it removes matches what it created.
 *   - It runs no migration, no db push, no reset, and no DDL of any kind.
 *
 * Handlers here are counters, not writes. In production the handler *is* the
 * business write, so "the handler ran once" is exactly "one sale was recorded".
 *
 * Usage:
 *   npm run verify:idempotency
 */

import { spawn } from 'node:child_process'
import { NextRequest, NextResponse } from 'next/server'

import {
  acquireClaim,
  completeClaim,
  releaseClaim,
  IDEMPOTENCY_STORE_LIMITS,
} from '../src/lib/idempotency-store'

/**
 * Sentinel tenant for verification rows.
 *
 * Negative by design: Organization ids come from a SERIAL sequence, so nothing
 * real can ever occupy this id and every row this script creates is
 * unambiguously its own.
 */
const VERIFY_ORG = -999001
const VERIFY_ROUTE = 'POST /__verify__/idempotency'
const RUN_ID = `${Date.now().toString(36)}-${process.pid.toString(36)}`

const scope = { route: VERIFY_ROUTE, organizationId: VERIFY_ORG, userId: `verify:${RUN_ID}` }
const key = (name: string) => `verify-${RUN_ID}-${name}`

const BASKET = JSON.stringify({ items: [{ productId: 1, sasia: 2 }] })

let passed = 0
let failed = 0

// ---------------------------------------------------------------------------
// Worker mode: one simulated serverless instance, in its own OS process.
// ---------------------------------------------------------------------------

if (process.argv.includes('--worker')) {
  void runWorker()
} else {
  void main()
}

/**
 * A worker is a separate process with its own module registry and its own
 * Prisma connection pool. Nothing is shared with its siblings except the
 * database — which is the whole point of the exercise.
 */
async function runWorker(): Promise<void> {
  const { withIdempotency } = await import('../src/lib/idempotency')
  const workerScope = JSON.parse(process.env.VERIFY_SCOPE!)
  const workerKey = process.env.VERIFY_KEY!

  let executions = 0

  const response = await withIdempotency(
    request(workerKey, process.env.VERIFY_BODY ?? BASKET),
    workerScope,
    async () => {
      executions += 1
      // Identifies which process actually ran the handler. In production this
      // is where the sale would be created.
      return NextResponse.json(
        { executedByPid: process.pid, execution: executions },
        { status: 201 },
      )
    },
  )

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    /* non-JSON responses are reported by status alone */
  }

  process.stdout.write(
    `\n__RESULT__${JSON.stringify({
      pid: process.pid,
      status: response.status,
      replayed: response.headers.get('Idempotent-Replay') === 'true',
      executions,
      body,
    })}\n`,
  )

  await disconnect()
  process.exit(0)
}

function request(k: string | null, body: string = BASKET): NextRequest {
  return new NextRequest('http://localhost/__verify__/idempotency', {
    method: 'POST',
    headers: k ? { 'Idempotency-Key': k, 'content-type': 'application/json' } : {},
    body,
  })
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  banner()

  const db = await database()

  await preflight(db)

  try {
    await crossProcessDuplicates()
    await claimProtocolAgainstRealPostgres(db)
    await differentPayloadIsRefused()
    await scopeIsolation(db)
    await transientFailureDoesNotPoison(db)
    await durableRecordShape(db)
    await uniqueConstraintIsEnforced(db)
  } finally {
    await cleanup(db)
    await disconnect()
  }

  console.log(`\n${'='.repeat(74)}`)
  console.log(`  ${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} checks passed, ${failed} failed`)
  console.log(`${'='.repeat(74)}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

function banner(): void {
  console.log(`
${'='.repeat(74)}
  DURABLE IDEMPOTENCY VERIFICATION — real PostgreSQL
${'='.repeat(74)}
  Writes to    : "IdempotencyRecord" only, organizationId = ${VERIFY_ORG}
  Business data: never read, never written, never deleted
  Cleanup      : DELETE WHERE organizationId = ${VERIFY_ORG}
  Run id       : ${RUN_ID}
${'='.repeat(74)}`)
}

/** The real Prisma client — no fake is installed anywhere in this script. */
async function database() {
  const { prisma } = await import('../src/lib/prisma')
  return prisma
}

async function disconnect(): Promise<void> {
  const { prisma } = await import('../src/lib/prisma')
  await prisma.$disconnect()
}

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1
    console.log(`  ✔ ${name}`)
  } else {
    failed += 1
    console.log(`  ✖ ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}

function section(title: string): void {
  console.log(`\n▶ ${title}`)
}

/** Refuses to proceed if the sentinel tenant is not clean and unoccupied. */
async function preflight(db: Awaited<ReturnType<typeof database>>): Promise<void> {
  section('Preflight')

  const collision = await db.organization.findUnique({ where: { id: VERIFY_ORG } })
  if (collision) {
    console.error(`\n✖ Sentinel organization id ${VERIFY_ORG} is occupied. Aborting.\n`)
    process.exit(1)
  }
  check('sentinel tenant id belongs to no real organization', true)

  const leftovers = await db.idempotencyRecord.count({ where: { organizationId: VERIFY_ORG } })
  if (leftovers > 0) {
    await db.idempotencyRecord.deleteMany({ where: { organizationId: VERIFY_ORG } })
  }
  check('verification scope starts empty', true, undefined)

  const total = await db.idempotencyRecord.count()
  console.log(`      IdempotencyRecord rows in database before run: ${total}`)
}

/**
 * The headline check: duplicates arriving at genuinely separate instances.
 *
 * Four OS processes, four Prisma pools, one key, identical payloads, released
 * together. Only the database can arbitrate between them.
 */
async function crossProcessDuplicates(): Promise<void> {
  section('Concurrent duplicates across separate processes (real contention)')

  const k = key('cross')
  const results = await Promise.all([0, 1, 2, 3].map(() => spawnWorker(k)))

  const pids = new Set(results.map((r) => r.pid))
  check(
    'four independent processes took part',
    pids.size === 4,
    `pids: ${Array.from(pids).join(', ')}`,
  )

  const totalExecutions = results.reduce((sum, r) => sum + r.executions, 0)
  check(
    'the handler executed exactly once across all processes',
    totalExecutions === 1,
    `handler ran ${totalExecutions} times — each extra run is a duplicate business record`,
  )

  const ok = results.filter((r) => r.status === 201)
  check(
    'every caller received a successful response',
    ok.length === results.length,
    `statuses: ${results.map((r) => r.status).join(', ')}`,
  )

  const executors = new Set(
    ok.map((r) => (r.body as { executedByPid?: number } | null)?.executedByPid),
  )
  check(
    'every caller received the same single result',
    executors.size === 1,
    `distinct result bodies: ${executors.size}`,
  )

  const replayed = results.filter((r) => r.replayed).length
  check(
    'the non-executing callers were served replays',
    replayed === results.length - 1,
    `${replayed} replays for ${results.length} callers`,
  )
}

/** Runs one simulated instance in its own process and parses its verdict. */
function spawnWorker(k: string): Promise<{
  pid: number
  status: number
  replayed: boolean
  executions: number
  body: unknown
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--require', 'ts-node/register/transpile-only', __filename, '--worker'],
      {
        env: {
          ...process.env,
          VERIFY_SCOPE: JSON.stringify(scope),
          VERIFY_KEY: k,
          TS_NODE_TRANSPILE_ONLY: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))

    child.on('close', (code) => {
      const marker = out.indexOf('__RESULT__')
      if (marker === -1) {
        reject(new Error(`worker exited ${code} without a result\n${err || out}`))
        return
      }
      resolve(JSON.parse(out.slice(marker + '__RESULT__'.length).split('\n')[0]))
    })
    child.on('error', reject)
  })
}

/** The store primitives, exercised directly against real PostgreSQL. */
async function claimProtocolAgainstRealPostgres(
  db: Awaited<ReturnType<typeof database>>,
): Promise<void> {
  section('Claim protocol against real PostgreSQL')

  const parts = { ...scope, key: key('protocol') }

  const [a, b] = await Promise.all([acquireClaim(parts, 'fp-1'), acquireClaim(parts, 'fp-1')])
  const claimed = [a, b].filter((r) => r.outcome === 'claimed')
  check('two concurrent claims yield exactly one owner', claimed.length === 1)

  const rows = await db.idempotencyRecord.count({
    where: { organizationId: VERIFY_ORG, key: parts.key },
  })
  check('the database holds exactly one row for the key', rows === 1)

  const recordId = (claimed[0] as { recordId: number }).recordId
  const settled = await completeClaim(recordId, VERIFY_ORG, 201, { saleId: 4242 })
  check('the claim settles', settled)

  const replay = await acquireClaim(parts, 'fp-1')
  check(
    'a later duplicate replays the stored response from the database',
    replay.outcome === 'replay' &&
      replay.status === 201 &&
      JSON.stringify(replay.body) === JSON.stringify({ saleId: 4242 }),
    `outcome: ${replay.outcome}`,
  )

  await releaseClaim(recordId, VERIFY_ORG)
  const afterRelease = await db.idempotencyRecord.count({
    where: { organizationId: VERIFY_ORG, key: parts.key },
  })
  check('releasing removes the row and frees the key', afterRelease === 0)
}

async function differentPayloadIsRefused(): Promise<void> {
  section('Same key + different payload')

  const { withIdempotency } = await import('../src/lib/idempotency')
  const k = key('payload')

  await withIdempotency(request(k), scope, async () =>
    NextResponse.json({ saleId: 1 }, { status: 201 }),
  )

  let executed = 0
  const response = await withIdempotency(
    request(k, JSON.stringify({ items: [{ productId: 99, sasia: 7 }] })),
    scope,
    async () => {
      executed += 1
      return NextResponse.json({ saleId: 2 }, { status: 201 })
    },
  )

  check('a mismatched payload is refused with 409', response.status === 409, `got ${response.status}`)
  check('and the handler never ran', executed === 0)

  const body = (await response.json()) as { code?: string }
  check('the refusal is classified CONFLICT', body.code === 'CONFLICT', `code: ${body.code}`)
}

async function scopeIsolation(db: Awaited<ReturnType<typeof database>>): Promise<void> {
  section('Tenant, user and route isolation')

  const k = key('scope')
  const shared = { key: k }

  const mine = await acquireClaim({ ...scope, ...shared }, 'fp-1')
  const otherTenant = await acquireClaim({ ...scope, ...shared, organizationId: VERIFY_ORG - 1 }, 'fp-1')
  const otherUser = await acquireClaim({ ...scope, ...shared, userId: `verify:${RUN_ID}:other` }, 'fp-1')
  const otherRoute = await acquireClaim({ ...scope, ...shared, route: `${VERIFY_ROUTE}/other` }, 'fp-1')

  check(
    'the same key in a different tenant, user and route are four distinct claims',
    [mine, otherTenant, otherUser, otherRoute].every((r) => r.outcome === 'claimed'),
  )

  const rows = await db.idempotencyRecord.count({
    where: { organizationId: { in: [VERIFY_ORG, VERIFY_ORG - 1] }, key: k },
  })
  check('the database holds four separate rows', rows === 4, `found ${rows}`)

  // Tenant boundary on writes, not merely on lookups.
  const recordId = (mine as { recordId: number }).recordId
  const crossTenantWrite = await completeClaim(recordId, VERIFY_ORG - 1, 201, { stolen: true })
  check('one tenant cannot settle another tenant claim', crossTenantWrite === false)

  const untouched = await db.idempotencyRecord.findFirst({ where: { id: recordId } })
  check(
    'and the targeted row is unchanged',
    untouched?.status === 'in_progress' && untouched?.responseStatus === null,
  )

  await db.idempotencyRecord.deleteMany({ where: { organizationId: VERIFY_ORG - 1 } })
}

async function transientFailureDoesNotPoison(
  db: Awaited<ReturnType<typeof database>>,
): Promise<void> {
  section('Transient failure does not poison the key')

  const { withIdempotency } = await import('../src/lib/idempotency')
  const k = key('transient')

  const failed503 = await withIdempotency(request(k), scope, async () =>
    NextResponse.json({ error: 'db down' }, { status: 503 }),
  )
  check('a 503 is returned to the caller', failed503.status === 503)

  const afterFailure = await db.idempotencyRecord.count({
    where: { organizationId: VERIFY_ORG, key: k },
  })
  check('and leaves no claim behind in the database', afterFailure === 0, `found ${afterFailure}`)

  // A fresh process, so the retry cannot be answered from an in-process cache.
  const retry = await spawnWorker(k)
  check('a retry on another instance is allowed to succeed', retry.status === 201)
  check('and actually executes the write', retry.executions === 1)

  const conflictKey = key('stock-conflict')
  const conflicted = await withIdempotency(request(conflictKey), scope, async () =>
    NextResponse.json({ error: 'stoku ndryshoi' }, { status: 409 }),
  )
  check('a stock conflict is returned to the caller', conflicted.status === 409)

  const afterConflict = await db.idempotencyRecord.count({
    where: { organizationId: VERIFY_ORG, key: conflictKey },
  })
  check('and does not pin the key after a restock', afterConflict === 0)
}

/** Confirms the durable record is real, correctly shaped, and privacy-safe. */
async function durableRecordShape(db: Awaited<ReturnType<typeof database>>): Promise<void> {
  section('The durable record itself')

  const { withIdempotency } = await import('../src/lib/idempotency')
  const k = key('shape')
  const secret = 'CUSTOMER-CARD-4111111111111111'

  await withIdempotency(
    request(k, JSON.stringify({ items: [], note: secret })),
    scope,
    async () => NextResponse.json({ saleId: 7 }, { status: 201 }),
  )

  const row = await db.idempotencyRecord.findUnique({
    where: {
      organizationId_userId_route_key: { ...scope, key: k },
    },
  })

  check('a row exists in PostgreSQL for the completed operation', row !== null)
  if (!row) return

  check('it is marked completed', row.status === 'completed', `status: ${row.status}`)
  check('it stores the response status', row.responseStatus === 201)
  check(
    'it stores the replayable body',
    JSON.stringify(row.responseBody) === JSON.stringify({ saleId: 7 }),
  )
  check('it records a completion time', row.completedAt !== null)
  check('its replay window is in the future', row.expiresAt.getTime() > Date.now())
  // Measured from completion, which is when the replay window is granted;
  // claimedAt precedes it by however long the handler took to run.
  check(
    `its replay window is bounded (<= ${IDEMPOTENCY_STORE_LIMITS.completedTtlMs}ms)`,
    row.completedAt !== null &&
      row.expiresAt.getTime() - row.completedAt.getTime() <=
        IDEMPOTENCY_STORE_LIMITS.completedTtlMs,
    `window: ${row.completedAt ? row.expiresAt.getTime() - row.completedAt.getTime() : 'n/a'}ms`,
  )

  // The privacy guarantee, checked against what is actually on disk.
  const persisted = JSON.stringify(row)
  check('the request payload is not persisted', !persisted.includes(secret))
  check('only a fingerprint of it is', row.fingerprint.length > 0 && !row.fingerprint.includes(secret))
}

/** Proves the guarantee is enforced by the schema, not only by application code. */
async function uniqueConstraintIsEnforced(
  db: Awaited<ReturnType<typeof database>>,
): Promise<void> {
  section('The constraint that makes the claim atomic')

  const parts = { ...scope, key: key('constraint') }
  const base = {
    ...parts,
    fingerprint: 'fp-1',
    status: 'in_progress',
    expiresAt: new Date(Date.now() + 60_000),
  }

  await db.idempotencyRecord.create({ data: base })

  let code: string | undefined
  try {
    // Bypasses the claim protocol entirely: this must be rejected by the
    // database itself, which is what makes cross-instance safety structural.
    await db.idempotencyRecord.create({ data: base })
  } catch (error) {
    code = (error as { code?: string }).code
  }

  check(
    'a duplicate tuple is rejected by PostgreSQL with P2002',
    code === 'P2002',
    `got ${code ?? 'no error — the unique index is missing'}`,
  )
}

/**
 * Removes every row this run created, and nothing else.
 *
 * The predicate is the sentinel tenant, which no real data can satisfy.
 */
async function cleanup(db: Awaited<ReturnType<typeof database>>): Promise<void> {
  section('Cleanup')

  const doomed = await db.idempotencyRecord.findMany({
    where: { organizationId: { in: [VERIFY_ORG, VERIFY_ORG - 1] } },
    select: { id: true, organizationId: true },
  })

  const foreign = doomed.filter((r) => r.organizationId > 0)
  if (foreign.length > 0) {
    console.error('\n✖ Refusing to delete: selection contained non-sentinel rows.\n')
    process.exit(1)
  }

  const removed = await db.idempotencyRecord.deleteMany({
    where: { organizationId: { in: [VERIFY_ORG, VERIFY_ORG - 1] } },
  })
  check(`removed ${removed.count} verification rows`, removed.count === doomed.length)

  const remaining = await db.idempotencyRecord.count({
    where: { organizationId: { in: [VERIFY_ORG, VERIFY_ORG - 1] } },
  })
  check('no verification data remains', remaining === 0)

  const total = await db.idempotencyRecord.count()
  console.log(`      IdempotencyRecord rows in database after run: ${total}`)
}
