/**
 * ============================================================================
 *  End-to-end duplicate-sale verification — REAL POST /api/sales, localhost
 * ============================================================================
 *
 * `verify-idempotency.ts` proves the claim protocol against real PostgreSQL.
 * This script proves the thing that actually matters to the business: that two
 * concurrent POSTs to the real sales route, with one idempotency key, create
 * one sale and consume stock once. It goes through the real HTTP handler, real
 * auth, real rate limiting, real billing enforcement, the real transaction and
 * the real guarded stock decrement — nothing is stubbed.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SAFE TO RUN
 * ---------------------------------------------------------------------------
 *
 * It never touches existing business data. Instead it creates a completely
 * disposable tenant of its own — organization, trial subscription, cashier,
 * session, product — every row tagged with a unique run id, and deletes all of
 * it afterwards. Existing organizations, products and sales are never read,
 * modified or deleted.
 *
 *   - Every created row's id is recorded as it is created; cleanup deletes by
 *     those exact ids, in foreign-key-safe order.
 *   - Cleanup runs in a `finally`, so it happens even if a check fails.
 *   - It asserts afterwards that the disposable tenant is gone.
 *   - HTTP target is hard-locked to localhost. No migration, no DDL, no raw SQL.
 *
 * Requires a local server: `npm run build && npm start`.
 *
 * Usage:
 *   npm run verify:sales-e2e
 */

import { randomBytes } from 'node:crypto'

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const RUN_ID = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
const TAG = `__VERIFY_E2E__${RUN_ID}`

/** Stock the disposable product starts with. */
const OPENING_STOCK = 100
/** Units per sale line in the duplicated basket. */
const SALE_QTY = 3

let passed = 0
let failed = 0

interface Fixtures {
  organizationId: number
  staffId: number
  productId: number
  sessionToken: string
}

void main()

async function main(): Promise<void> {
  assertLocalhost(BASE_URL)
  banner()

  const { prisma } = await import('../src/lib/prisma')

  await assertServerIsUp()

  let fixtures: Fixtures | null = null
  try {
    fixtures = await createFixtures(prisma)
    await concurrentDuplicates(prisma, fixtures)
    await differentPayloadIsRefused(prisma, fixtures)
  } catch (error) {
    failed += 1
    console.log(`\n  ✖ verification aborted: ${(error as Error).message}`)
  } finally {
    if (fixtures) await cleanup(prisma, fixtures)
    await prisma.$disconnect()
  }

  console.log(`\n${'='.repeat(74)}`)
  console.log(`  ${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} checks passed, ${failed} failed`)
  console.log(`${'='.repeat(74)}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

function assertLocalhost(url: string): void {
  const host = new URL(url).hostname
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`\n✖ This verification is localhost-only. Refusing target ${host}.\n`)
    process.exit(1)
  }
}

function banner(): void {
  console.log(`
${'='.repeat(74)}
  END-TO-END DUPLICATE SALE VERIFICATION — real POST /api/sales
${'='.repeat(74)}
  Target       : ${BASE_URL}
  Disposable   : one organization tagged ${TAG}
  Existing data: never read, never written, never deleted
  Run id       : ${RUN_ID}
${'='.repeat(74)}`)
}

async function assertServerIsUp(): Promise<void> {
  section('Preflight')
  try {
    const res = await fetch(`${BASE_URL}/api/health?probe=liveness`)
    check(`server is reachable at ${BASE_URL}`, res.status === 200, `status ${res.status}`)
  } catch {
    console.error(`\n✖ No server at ${BASE_URL}. Run: npm run build && npm start\n`)
    process.exit(1)
  }
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

/**
 * Builds a disposable tenant.
 *
 * A dedicated organization rather than a test product inside a real one: it
 * means no existing tenant's stock, sales or audit trail is involved at all,
 * and cleanup is a closed set of known ids.
 */
async function createFixtures(prisma: PrismaLike): Promise<Fixtures> {
  section('Disposable fixtures')

  const organization = await prisma.organization.create({
    data: { name: `${TAG} Market`, isActive: true },
  })

  // Billing gates every business route; a live trial is what makes the sale
  // reach the handler at all.
  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      plan: 'trial',
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  })

  const staff = await prisma.staff.create({
    data: {
      organizationId: organization.id,
      emri: `${TAG} Cashier`,
      roli: 'Cashier',
      // Never used for login here; the session row below is created directly.
      pinHash: 'verification-only:not-a-usable-pin',
      isActive: true,
    },
  })

  const sessionToken = randomBytes(32).toString('hex')
  await prisma.staffSession.create({
    data: {
      token: sessionToken,
      staffId: staff.id,
      organizationId: organization.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })

  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      emri: `${TAG} Produkt`,
      kategoria: 'verification',
      sasia: OPENING_STOCK,
      cmimiBlerjes: 10,
      cmimiShitjes: 25,
    },
  })

  console.log(
    `      organization=${organization.id} staff=${staff.id} product=${product.id} stock=${OPENING_STOCK}`,
  )
  check('disposable tenant created', true)

  return {
    organizationId: organization.id,
    staffId: staff.id,
    productId: product.id,
    sessionToken,
  }
}

function saleBody(productId: number, sasia: number = SALE_QTY): string {
  return JSON.stringify({
    items: [{ productId, emriProduktit: `${TAG} Produkt`, sasia }],
    paymentMethod: 'cash',
    shenime: TAG,
  })
}

async function postSale(
  fixtures: Fixtures,
  idempotencyKey: string,
  body: string,
): Promise<{ status: number; replayed: boolean; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE_URL}/api/sales`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      cookie: `staff_session=${fixtures.sessionToken}`,
    },
    body,
  })

  let parsed: Record<string, unknown> | null = null
  try {
    parsed = (await res.json()) as Record<string, unknown>
  } catch {
    /* reported by status alone */
  }

  return {
    status: res.status,
    replayed: res.headers.get('Idempotent-Replay') === 'true',
    body: parsed,
  }
}

/** The headline check: two concurrent identical POSTs must yield one sale. */
async function concurrentDuplicates(prisma: PrismaLike, fixtures: Fixtures): Promise<void> {
  section('Concurrent duplicate POST /api/sales')

  const before = await prisma.product.findUnique({ where: { id: fixtures.productId } })
  const stockBefore = before!.sasia
  console.log(`      stock before: ${stockBefore}`)

  const key = `e2e-${RUN_ID}-dup`
  const body = saleBody(fixtures.productId)

  const CALLERS = 3
  const responses = await Promise.all(
    Array.from({ length: CALLERS }, () => postSale(fixtures, key, body)),
  )

  console.log(`      requests sent: ${CALLERS}`)
  console.log(`      status codes : ${responses.map((r) => r.status).join(', ')}`)
  console.log(
    `      sale ids     : ${responses.map((r) => (r.body?.id as number) ?? '—').join(', ')}`,
  )

  const successful = responses.filter((r) => r.status === 201 || r.status === 200)
  check(
    'every caller received a successful response',
    successful.length === CALLERS,
    `statuses: ${responses.map((r) => r.status).join(', ')}`,
  )

  const saleIds = new Set(successful.map((r) => r.body?.id as number))
  check(
    'every caller received the same sale id',
    saleIds.size === 1,
    `distinct sale ids: ${Array.from(saleIds).join(', ')}`,
  )

  const sales = await prisma.sale.findMany({
    where: { organizationId: fixtures.organizationId },
    include: { items: true },
  })
  check(
    'exactly ONE sale row exists in the database',
    sales.length === 1,
    `found ${sales.length} sale rows — each extra one is a double-charged customer`,
  )

  if (sales.length === 1) {
    check(
      'the sale has exactly one line item, not duplicated',
      sales[0].items.length === 1,
      `found ${sales[0].items.length} sale items`,
    )
    check(
      'the line item records the requested quantity once',
      sales[0].items[0]?.sasia === SALE_QTY,
      `sasia: ${sales[0].items[0]?.sasia}`,
    )
    check(
      'the returned sale id matches the persisted row',
      Array.from(saleIds)[0] === sales[0].id,
      `returned ${Array.from(saleIds)[0]}, stored ${sales[0].id}`,
    )
  }

  const after = await prisma.product.findUnique({ where: { id: fixtures.productId } })
  const stockAfter = after!.sasia
  console.log(`      stock after : ${stockAfter}`)
  check(
    `exactly ONE stock decrement occurred (${stockBefore} → ${stockBefore - SALE_QTY})`,
    stockAfter === stockBefore - SALE_QTY,
    `expected ${stockBefore - SALE_QTY}, found ${stockAfter} — a second decrement means stock was consumed twice`,
  )

  const replays = responses.filter((r) => r.replayed).length
  check(
    'the non-executing callers were served replays',
    replays === CALLERS - 1,
    `${replays} replays across ${CALLERS} callers`,
  )

  // The durable record must be what carried the guarantee.
  const records = await prisma.idempotencyRecord.findMany({
    where: { organizationId: fixtures.organizationId },
  })
  check('a durable IdempotencyRecord was written', records.length === 1, `found ${records.length}`)

  if (records.length === 1) {
    const record = records[0]
    console.log(
      `      record       : status=${record.status} responseStatus=${record.responseStatus} route=${record.route}`,
    )
    check('it is scoped to the sales route', record.route === 'POST /api/sales')
    check('it is scoped to the acting cashier', record.userId === `staff:${fixtures.staffId}`)
    check('it is marked completed', record.status === 'completed')
    check('it stored the replayable response', record.responseStatus === 201)
    check(
      'the stored body is the one sale that was created',
      (record.responseBody as { id?: number } | null)?.id === sales[0]?.id,
    )
  }
}

async function differentPayloadIsRefused(prisma: PrismaLike, fixtures: Fixtures): Promise<void> {
  section('Same key + different payload')

  const key = `e2e-${RUN_ID}-mismatch`

  const first = await postSale(fixtures, key, saleBody(fixtures.productId, 1))
  check('the first sale succeeds', first.status === 201, `status ${first.status}`)

  const stockBefore = (await prisma.product.findUnique({ where: { id: fixtures.productId } }))!.sasia
  const salesBefore = await prisma.sale.count({ where: { organizationId: fixtures.organizationId } })

  // Same key, a different basket — a client bug, and the dangerous half of key
  // reuse: replaying here would discard a genuine second sale.
  const second = await postSale(fixtures, key, saleBody(fixtures.productId, 5))

  check('the mismatched payload is refused with 409', second.status === 409, `status ${second.status}`)
  check('it is classified CONFLICT', second.body?.code === 'CONFLICT', `code: ${second.body?.code}`)

  const salesAfter = await prisma.sale.count({ where: { organizationId: fixtures.organizationId } })
  check('no sale was created for the refused request', salesAfter === salesBefore)

  const stockAfter = (await prisma.product.findUnique({ where: { id: fixtures.productId } }))!.sasia
  check('and no stock was consumed', stockAfter === stockBefore, `${stockBefore} → ${stockAfter}`)
}

/**
 * Deletes every row this run created, by id, in foreign-key-safe order.
 *
 * AuditLog and Notification hold ON DELETE RESTRICT references to Organization,
 * so the sale's own audit trail has to go before the tenant can.
 */
async function cleanup(prisma: PrismaLike, fixtures: Fixtures): Promise<void> {
  section('Cleanup')

  const orgId = fixtures.organizationId

  // Guard: never run cleanup against a tenant this script did not create.
  const organization = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!organization || !organization.name.startsWith(TAG)) {
    console.error(`\n✖ Refusing to clean up organization ${orgId}: not created by this run.\n`)
    process.exit(1)
  }

  const removed = {
    saleItems: (await prisma.saleItem.deleteMany({ where: { sale: { organizationId: orgId } } })).count,
    sales: (await prisma.sale.deleteMany({ where: { organizationId: orgId } })).count,
    products: (await prisma.product.deleteMany({ where: { organizationId: orgId } })).count,
    staffSessions: (await prisma.staffSession.deleteMany({ where: { organizationId: orgId } })).count,
    staff: (await prisma.staff.deleteMany({ where: { organizationId: orgId } })).count,
    subscriptions: (await prisma.subscription.deleteMany({ where: { organizationId: orgId } })).count,
    auditLogs: (await prisma.auditLog.deleteMany({ where: { organizationId: orgId } })).count,
    notifications: (await prisma.notification.deleteMany({ where: { organizationId: orgId } })).count,
    idempotency: (await prisma.idempotencyRecord.deleteMany({ where: { organizationId: orgId } })).count,
    organizations: (await prisma.organization.deleteMany({ where: { id: orgId } })).count,
  }

  console.log(`      ${JSON.stringify(removed)}`)

  const orgGone = await prisma.organization.findUnique({ where: { id: orgId } })
  check('the disposable tenant is fully removed', orgGone === null)

  const strays =
    (await prisma.sale.count({ where: { organizationId: orgId } })) +
    (await prisma.product.count({ where: { organizationId: orgId } })) +
    (await prisma.idempotencyRecord.count({ where: { organizationId: orgId } })) +
    (await prisma.staff.count({ where: { organizationId: orgId } }))
  check('no verification rows remain in any table', strays === 0, `${strays} rows left behind`)
}

/** The Prisma client's type, without importing it as a value at module load. */
type PrismaModule = typeof import('../src/lib/prisma')
type PrismaLike = PrismaModule['prisma']
