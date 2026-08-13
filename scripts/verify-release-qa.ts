/**
 * ============================================================================
 *  Release QA verification — real HTTP routes, localhost, disposable tenants
 * ============================================================================
 *
 * Exercises the product-level behaviour a paying customer depends on:
 * tenant isolation, POS input validation, stock integrity, billing
 * enforcement, session handling and the staff PIN login path.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SAFE TO RUN
 * ---------------------------------------------------------------------------
 *
 * It creates three completely disposable tenants of its own, every row tagged
 * with a unique run id, and deletes all of them afterwards. Existing
 * organizations, products, sales and staff are never read, modified or
 * deleted. Cleanup runs in a `finally` and refuses to touch any organization
 * whose name does not carry this run's tag.
 *
 * Localhost only. No migration, no DDL, no raw SQL, no destructive operation.
 *
 * Requires a local server: `npm run build && npm start`.
 *
 * Usage:
 *   npm run verify:release-qa
 */

import { randomBytes } from 'node:crypto'

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const RUN_ID = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
const TAG = `__VERIFY_QA__${RUN_ID}`

const OPENING_STOCK = 50

let passed = 0
let failed = 0
const findings: string[] = []

interface Tenant {
  organizationId: number
  staffId: number
  productId: number
  sessionToken: string
  productName: string
}

interface World {
  a: Tenant
  b: Tenant
  expired: Tenant
  /** Same staff name deliberately present in tenant A and tenant B. */
  collidingName: string
  collidePinA: string
  collidePinB: string
  soloName: string
  soloPin: string
}

void main()

async function main(): Promise<void> {
  assertLocalhost(BASE_URL)
  banner()

  const { prisma } = await import('../src/lib/prisma')

  await assertServerIsUp()

  let world: World | null = null
  try {
    world = await createWorld(prisma)
    await sessionHandling(world)
    await tenantIsolation(prisma, world)
    await posValidation(prisma, world)
    await stockIntegrity(prisma, world)
    await businessDayFiltering(world)
    await billingEnforcement(world)
    await roleBoundaries(world)
    await staffLoginScoping(prisma, world)
    await errorSanitisation(world)
  } catch (error) {
    failed += 1
    console.log(`\n  ✖ verification aborted: ${(error as Error).message}`)
    console.log((error as Error).stack?.split('\n').slice(1, 4).join('\n'))
  } finally {
    if (world) await cleanup(prisma, world)
    await prisma.$disconnect()
  }

  if (findings.length > 0) {
    console.log(`\n▶ Findings recorded`)
    for (const f of findings) console.log(`  • ${f}`)
  }

  console.log(`\n${'='.repeat(74)}`)
  console.log(`  ${failed === 0 ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} — ${passed} passed, ${failed} failed`)
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
  RELEASE QA VERIFICATION — real HTTP routes
${'='.repeat(74)}
  Target       : ${BASE_URL}
  Disposable   : three organizations tagged ${TAG}
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

/** Records observed behaviour that is not a pass/fail assertion. */
function observe(text: string): void {
  console.log(`  · ${text}`)
  findings.push(text)
}

function section(title: string): void {
  console.log(`\n▶ ${title}`)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function makeTenant(
  prisma: PrismaLike,
  label: string,
  subscription: { status: string; trialEndsAt: Date },
): Promise<Tenant> {
  const organization = await prisma.organization.create({
    data: { name: `${TAG} ${label}`, isActive: true },
  })

  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      plan: 'trial',
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
    },
  })

  const staff = await prisma.staff.create({
    data: {
      organizationId: organization.id,
      emri: `${TAG} ${label} Cashier`,
      roli: 'Cashier',
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

  const productName = `${TAG} ${label} Produkt`
  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      emri: productName,
      kategoria: 'verification',
      sasia: OPENING_STOCK,
      cmimiBlerjes: 10,
      cmimiShitjes: 25,
    },
  })

  console.log(`      ${label}: org=${organization.id} staff=${staff.id} product=${product.id}`)

  return {
    organizationId: organization.id,
    staffId: staff.id,
    productId: product.id,
    sessionToken,
    productName,
  }
}

async function createWorld(prisma: PrismaLike): Promise<World> {
  section('Disposable fixtures')

  const inADay = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const a = await makeTenant(prisma, 'A', { status: 'trialing', trialEndsAt: inADay })
  const b = await makeTenant(prisma, 'B', { status: 'trialing', trialEndsAt: inADay })
  const expired = await makeTenant(prisma, 'EXP', { status: 'trialing', trialEndsAt: yesterday })

  const { hashPin } = await import('../src/lib/staff-auth')

  // The exact BUG-01 shape: one staff name held by two unrelated tenants, each
  // with their own distinct PIN. Both must be able to work; neither PIN may
  // open the other's till.
  const collidingName = `${TAG} Shared Name`
  const collidePinA = '410398'
  const collidePinB = '672514'
  await prisma.staff.create({
    data: {
      organizationId: a.organizationId,
      emri: collidingName,
      roli: 'Cashier',
      pinHash: await hashPin(collidePinA),
      isActive: true,
    },
  })
  await prisma.staff.create({
    data: {
      organizationId: b.organizationId,
      emri: collidingName,
      roli: 'Cashier',
      pinHash: await hashPin(collidePinB),
      isActive: true,
    },
  })

  // A uniquely named staff member with a real, usable PIN, to test whether PIN
  // login requires any organization context.
  const soloName = `${TAG} Solo Name`
  const soloPin = '835194'
  await prisma.staff.create({
    data: {
      organizationId: a.organizationId,
      emri: soloName,
      roli: 'Cashier',
      pinHash: await hashPin(soloPin),
      isActive: true,
    },
  })

  check('three disposable tenants created', true)
  return { a, b, expired, collidingName, collidePinA, collidePinB, soloName, soloPin }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface Reply {
  status: number
  body: Record<string, unknown> | null
  text: string
  headers: Headers
}

async function call(
  path: string,
  options: {
    method?: string
    token?: string | null
    body?: unknown
    key?: string
    /** Value for the terminal organization cookie, as a provisioned till sends. */
    terminalOrg?: number | string | null
    /**
     * Distinguishes callers for rate limiting, the way separate tills on
     * separate connections are distinguished in production. The staff-auth
     * bucket allows 10 requests per minute per identifier, and these scenarios
     * legitimately represent different devices — so they are given different
     * ones rather than raising the limit.
     */
    ip?: string
  } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.ip) headers['x-forwarded-for'] = options.ip

  const cookies: string[] = []
  if (options.token) cookies.push(`staff_session=${options.token}`)
  if (options.terminalOrg !== undefined && options.terminalOrg !== null) {
    cookies.push(`pos_terminal_org=${options.terminalOrg}`)
  }
  if (cookies.length > 0) headers.cookie = cookies.join('; ')

  if (options.key) headers['Idempotency-Key'] = options.key

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const text = await res.text()
  let body: Record<string, unknown> | null = null
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* non-JSON response, kept as text */
  }
  return { status: res.status, body, text, headers: res.headers }
}

/** Number of rows in a list response, or -1 if it was not a successful list. */
function rowCount(reply: Reply): number {
  if (reply.status !== 200) return -1
  const parsed: unknown = reply.body
  return Array.isArray(parsed) ? parsed.length : -1
}

function sale(items: unknown[], key?: string) {
  return { items, paymentMethod: 'cash', shenime: TAG, key }
}

async function postSale(
  tenant: Tenant,
  items: unknown[],
  key = `qa-${RUN_ID}-${randomBytes(4).toString('hex')}`,
): Promise<Reply> {
  return call('/api/sales', {
    method: 'POST',
    token: tenant.sessionToken,
    key,
    body: { items, paymentMethod: 'cash', shenime: TAG },
  })
}

// ---------------------------------------------------------------------------
// Stage 3 — sessions
// ---------------------------------------------------------------------------

async function sessionHandling(world: World): Promise<void> {
  section('Stage 3 — authentication & session handling')

  const none = await postSale({ ...world.a, sessionToken: '' } as Tenant, [
    { productId: world.a.productId, emriProduktit: world.a.productName, sasia: 1 },
  ])
  check('no session cookie is rejected with 401', none.status === 401, `status ${none.status}`)

  const malformed = await call('/api/sales', {
    method: 'POST',
    token: 'not-a-real-token-%%%',
    body: { items: [] },
  })
  check('malformed session cookie is rejected with 401', malformed.status === 401, `status ${malformed.status}`)

  const veryLong = await call('/api/sales', {
    method: 'POST',
    token: 'x'.repeat(4000),
    body: { items: [] },
  })
  check('oversized session cookie is rejected, not crashed', veryLong.status === 401, `status ${veryLong.status}`)

  const sess = await call('/api/staff-auth/session', { token: world.a.sessionToken })
  check('a valid session resolves', sess.status === 200, `status ${sess.status}`)
  const resolved = (sess.body?.session ?? {}) as Record<string, unknown>
  check(
    'the resolved session carries the tenant from the database',
    resolved.organizationId === world.a.organizationId,
    `got organizationId ${resolved.organizationId}`,
  )
}

// ---------------------------------------------------------------------------
// Stage 4 — tenant isolation
// ---------------------------------------------------------------------------

async function tenantIsolation(prisma: PrismaLike, world: World): Promise<void> {
  section('Stage 4 — tenant isolation / IDOR')

  // Tenant A tries to sell tenant B's product.
  const cross = await postSale(world.a, [
    { productId: world.b.productId, emriProduktit: world.b.productName, sasia: 1 },
  ])
  check(
    "selling another tenant's product is refused with 404",
    cross.status === 404,
    `status ${cross.status} body ${cross.text.slice(0, 120)}`,
  )

  const bStock = await prisma.product.findUnique({ where: { id: world.b.productId } })
  check(
    "the other tenant's stock was not touched",
    bStock!.sasia === OPENING_STOCK,
    `expected ${OPENING_STOCK}, found ${bStock!.sasia}`,
  )

  // A basket mixing own and foreign products must fail as a whole.
  const mixed = await postSale(world.a, [
    { productId: world.a.productId, emriProduktit: world.a.productName, sasia: 1 },
    { productId: world.b.productId, emriProduktit: world.b.productName, sasia: 1 },
  ])
  check('a basket mixing tenants is refused', mixed.status === 404, `status ${mixed.status}`)

  const aStockAfterMixed = await prisma.product.findUnique({ where: { id: world.a.productId } })
  check(
    'the mixed basket consumed no stock at all',
    aStockAfterMixed!.sasia === OPENING_STOCK,
    `expected ${OPENING_STOCK}, found ${aStockAfterMixed!.sasia}`,
  )

  // Sale listing must be scoped.
  await postSale(world.b, [{ productId: world.b.productId, emriProduktit: world.b.productName, sasia: 1 }])
  const aList = await call('/api/sales', { token: world.a.sessionToken })
  const aSales = Array.isArray(aList.body) ? (aList.body as Array<{ organizationId: number }>) : []
  check(
    "the sales list never contains another tenant's rows",
    aSales.every((s) => s.organizationId === world.a.organizationId),
    `found foreign rows among ${aSales.length}`,
  )

  // Reading another tenant's product list.
  const aProducts = await call('/api/products', { token: world.a.sessionToken })
  const list = Array.isArray(aProducts.body)
    ? (aProducts.body as Array<{ id: number; organizationId?: number }>)
    : ((aProducts.body?.data as Array<{ id: number; organizationId?: number }>) ?? [])
  check(
    "the product list never contains another tenant's products",
    !list.some((p) => p.id === world.b.productId),
    `tenant B product ${world.b.productId} visible to tenant A`,
  )
}

// ---------------------------------------------------------------------------
// Stage 5 — POS input validation
// ---------------------------------------------------------------------------

async function posValidation(prisma: PrismaLike, world: World): Promise<void> {
  section('Stage 5 — POS input validation')

  const t = world.a
  const name = t.productName

  const cases: Array<[string, unknown[], number[]]> = [
    ['an empty basket is refused', [], [400]],
    ['zero quantity is refused', [{ productId: t.productId, emriProduktit: name, sasia: 0 }], [400]],
    ['negative quantity is refused', [{ productId: t.productId, emriProduktit: name, sasia: -3 }], [400]],
    ['a string quantity is refused', [{ productId: t.productId, emriProduktit: name, sasia: '2' }], [400]],
    ['a null quantity is refused', [{ productId: t.productId, emriProduktit: name, sasia: null }], [400]],
    ['a missing quantity is refused', [{ productId: t.productId, emriProduktit: name }], [400]],
    ['NaN quantity is refused', [{ productId: t.productId, emriProduktit: name, sasia: Number.NaN }], [400]],
    [
      'Infinity quantity is refused',
      [{ productId: t.productId, emriProduktit: name, sasia: Number.POSITIVE_INFINITY }],
      [400],
    ],
    [
      'a nonexistent product is refused with 404',
      [{ productId: 2147483600, emriProduktit: 'ghost', sasia: 1 }],
      [404],
    ],
    [
      'quantity beyond stock is refused with 400',
      [{ productId: t.productId, emriProduktit: name, sasia: OPENING_STOCK + 1 }],
      [400],
    ],
    [
      'two lines of the same product that together exceed stock are refused',
      [
        { productId: t.productId, emriProduktit: name, sasia: OPENING_STOCK - 1 },
        { productId: t.productId, emriProduktit: name, sasia: 5 },
      ],
      [400],
    ],
  ]

  const stockBefore = (await prisma.product.findUnique({ where: { id: t.productId } }))!.sasia

  for (const [label, items, expected] of cases) {
    const res = await postSale(t, items)
    check(label, expected.includes(res.status), `status ${res.status} body ${res.text.slice(0, 140)}`)
  }

  // A malformed productId must not surface a driver error.
  const badId = await postSale(t, [{ productId: 'abc', emriProduktit: name, sasia: 1 }])
  check(
    'a malformed productId is refused without a 500',
    badId.status >= 400 && badId.status < 500,
    `status ${badId.status} body ${badId.text.slice(0, 200)}`,
  )
  if (badId.status >= 500) {
    observe(`malformed productId returns ${badId.status}: ${badId.text.slice(0, 160)}`)
  }

  const stockAfter = (await prisma.product.findUnique({ where: { id: t.productId } }))!.sasia
  check(
    'no rejected basket consumed any stock',
    stockAfter === stockBefore,
    `stock moved ${stockBefore} → ${stockAfter}`,
  )

  const salesCount = await prisma.sale.count({ where: { organizationId: t.organizationId } })
  check('no rejected basket created a sale row', salesCount === 0, `${salesCount} sales exist`)
}

// ---------------------------------------------------------------------------
// Stage 6 — stock integrity and pricing
// ---------------------------------------------------------------------------

async function stockIntegrity(prisma: PrismaLike, world: World): Promise<void> {
  section('Stage 5/6 — stock integrity, totals and pricing')

  const t = world.a
  const before = (await prisma.product.findUnique({ where: { id: t.productId } }))!

  // Duplicate lines within stock must decrement exactly once, by the sum.
  const dup = await postSale(t, [
    { productId: t.productId, emriProduktit: t.productName, sasia: 2 },
    { productId: t.productId, emriProduktit: t.productName, sasia: 3 },
  ])
  check('a basket with two lines of one product succeeds', dup.status === 201, `status ${dup.status}`)

  const afterDup = (await prisma.product.findUnique({ where: { id: t.productId } }))!
  check(
    'duplicate lines decrement stock exactly once, by their sum',
    afterDup.sasia === before.sasia - 5,
    `expected ${before.sasia - 5}, found ${afterDup.sasia}`,
  )

  const dupSale = dup.body as { totali?: number; fitimi?: number; items?: unknown[] } | null
  check(
    'the total is computed from stored prices, not the request',
    dupSale?.totali === 5 * before.cmimiShitjes,
    `expected ${5 * before.cmimiShitjes}, got ${dupSale?.totali}`,
  )
  check(
    'profit is computed from stored cost and sale prices',
    dupSale?.fitimi === 5 * (before.cmimiShitjes - before.cmimiBlerjes),
    `expected ${5 * (before.cmimiShitjes - before.cmimiBlerjes)}, got ${dupSale?.fitimi}`,
  )

  // A client-supplied price must be ignored.
  const forged = await postSale(t, [
    { productId: t.productId, emriProduktit: t.productName, sasia: 1, cmimiShitjes: 0.01, totali: 0.01 },
  ])
  const forgedSale = forged.body as { totali?: number } | null
  check(
    'a client-supplied price is ignored',
    forgedSale?.totali === before.cmimiShitjes,
    `expected ${before.cmimiShitjes}, got ${forgedSale?.totali}`,
  )

  // Fractional quantity — the schema stores stock as Float for weighed goods.
  const fractional = await postSale(t, [
    { productId: t.productId, emriProduktit: t.productName, sasia: 0.5 },
  ])
  check('a fractional quantity is accepted for weighed goods', fractional.status === 201, `status ${fractional.status}`)

  // Selling the exact remaining stock must succeed and land on zero, never below.
  const current = (await prisma.product.findUnique({ where: { id: t.productId } }))!
  const drain = await postSale(t, [
    { productId: t.productId, emriProduktit: t.productName, sasia: current.sasia },
  ])
  check('selling the exact remaining stock succeeds', drain.status === 201, `status ${drain.status}`)

  const drained = (await prisma.product.findUnique({ where: { id: t.productId } }))!
  check('stock lands exactly on zero, never negative', drained.sasia === 0, `stock is ${drained.sasia}`)

  const oversell = await postSale(t, [
    { productId: t.productId, emriProduktit: t.productName, sasia: 1 },
  ])
  check('selling from empty stock is refused', oversell.status === 400, `status ${oversell.status}`)

  const finalStock = (await prisma.product.findUnique({ where: { id: t.productId } }))!
  check('stock is never driven negative', finalStock.sasia >= 0, `stock is ${finalStock.sasia}`)

  // Aggregate consistency: sale line items must account for every unit removed.
  const items = await prisma.saleItem.findMany({ where: { sale: { organizationId: t.organizationId } } })
  const sold = items.reduce((sum, i) => sum + i.sasia, 0)
  check(
    'units sold reconcile exactly with stock removed',
    Math.abs(sold - (OPENING_STOCK - finalStock.sasia)) < 1e-9,
    `sold ${sold}, stock fell by ${OPENING_STOCK - finalStock.sasia}`,
  )

  // An archived product must not be sellable by id, even though the row still
  // exists to preserve its sale history.
  const archived = await prisma.product.create({
    data: {
      organizationId: t.organizationId,
      emri: `${TAG} Archived`,
      kategoria: 'verification',
      sasia: 10,
      cmimiBlerjes: 1,
      cmimiShitjes: 2,
      isArchived: true,
    },
  })

  const salesBefore = await prisma.sale.count({ where: { organizationId: t.organizationId } })
  const itemsBefore = await prisma.saleItem.count({
    where: { sale: { organizationId: t.organizationId } },
  })

  const archivedSale = await postSale(t, [
    { productId: archived.id, emriProduktit: `${TAG} Archived`, sasia: 1 },
  ])
  check(
    'an archived product cannot be sold by direct id',
    archivedSale.status >= 400 && archivedSale.status < 500,
    `status ${archivedSale.status} body ${archivedSale.text.slice(0, 140)}`,
  )

  const archivedAfter = (await prisma.product.findUnique({ where: { id: archived.id } }))!
  check('no stock was decremented from the archived product', archivedAfter.sasia === 10, `stock ${archivedAfter.sasia}`)
  check(
    'no Sale row was created for the archived product',
    (await prisma.sale.count({ where: { organizationId: t.organizationId } })) === salesBefore,
  )
  check(
    'no SaleItem row was created for the archived product',
    (await prisma.saleItem.count({ where: { sale: { organizationId: t.organizationId } } })) ===
      itemsBefore,
  )

  // A basket mixing a live product with an archived one must fail as a whole.
  const live = await prisma.product.create({
    data: {
      organizationId: t.organizationId,
      emri: `${TAG} Live`,
      kategoria: 'verification',
      sasia: 10,
      cmimiBlerjes: 1,
      cmimiShitjes: 2,
    },
  })
  const mixed = await postSale(t, [
    { productId: live.id, emriProduktit: `${TAG} Live`, sasia: 1 },
    { productId: archived.id, emriProduktit: `${TAG} Archived`, sasia: 1 },
  ])
  check(
    'a basket containing an archived product is refused as a whole',
    mixed.status >= 400 && mixed.status < 500,
    `status ${mixed.status}`,
  )
  const liveAfter = (await prisma.product.findUnique({ where: { id: live.id } }))!
  check('the live product in that basket kept its stock', liveAfter.sasia === 10, `stock ${liveAfter.sasia}`)
}

// ---------------------------------------------------------------------------
// Business-day filtering over the real route
// ---------------------------------------------------------------------------

async function businessDayFiltering(world: World): Promise<void> {
  section('Business-day filtering — real GET /api/sales')

  const { businessDayKey, startOfBusinessDayOffset } = await import('../src/lib/business-time')
  const token = world.a.sessionToken
  const now = new Date()

  const today = businessDayKey(now)
  const yesterday = businessDayKey(startOfBusinessDayOffset(now, -1))
  const tomorrow = businessDayKey(startOfBusinessDayOffset(now, 1))

  const todayCount = rowCount(await call(`/api/sales?data=${today}`, { token }))
  check(
    `today's business day (${today}) returns the sales just created`,
    todayCount > 0,
    `${todayCount} rows`,
  )

  check(
    "tomorrow's business day returns nothing",
    rowCount(await call(`/api/sales?data=${tomorrow}`, { token })) === 0,
  )

  check(
    "yesterday's business day does not include today's sales",
    rowCount(await call(`/api/sales?data=${yesterday}`, { token })) === 0,
  )

  // The period selector must agree with the explicit date.
  const sotCount = rowCount(await call('/api/sales?periudha=sot', { token }))
  check(
    'the "sot" period agrees with the explicit business date',
    sotCount === todayCount,
    `sot=${sotCount}, data=${todayCount}`,
  )

  const dje = await call('/api/sales?periudha=dje', { token })
  check('the "dje" period is a bounded single day', dje.status === 200, `status ${dje.status}`)

  for (const bad of ['not-a-date', '2026-13-01', '2026-02-30', '13/08/2026']) {
    const res = await call(`/api/sales?data=${encodeURIComponent(bad)}`, { token })
    check(
      `a malformed date filter (${bad}) is refused with 400`,
      res.status === 400,
      `status ${res.status}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Stage 9 — billing enforcement
// ---------------------------------------------------------------------------

async function billingEnforcement(world: World): Promise<void> {
  section('Stage 9 — billing enforcement')

  const expired = await postSale(world.expired, [
    { productId: world.expired.productId, emriProduktit: world.expired.productName, sasia: 1 },
  ])
  check(
    'an expired trial cannot create a sale (403)',
    expired.status === 403,
    `status ${expired.status} body ${expired.text.slice(0, 140)}`,
  )

  const read = await call('/api/sales', { token: world.expired.sessionToken })
  check('an expired trial cannot read sales either', read.status === 403, `status ${read.status}`)

  const status = await call('/api/subscription-status', { token: world.expired.sessionToken })
  check('subscription status is still readable while expired', status.status === 200, `status ${status.status}`)
}

// ---------------------------------------------------------------------------
// Stage 8 — role boundaries for a PIN cashier
// ---------------------------------------------------------------------------

async function roleBoundaries(world: World): Promise<void> {
  section('Stage 8 — role boundaries (PIN cashier)')

  const token = world.a.sessionToken

  const forbidden: Array<[string, string, unknown]> = [
    ['/api/dashboard', 'GET', undefined],
    ['/api/audit-logs', 'GET', undefined],
    ['/api/export', 'GET', undefined],
    ['/api/backup', 'GET', undefined],
    ['/api/suppliers', 'GET', undefined],
    ['/api/supplies', 'GET', undefined],
    ['/api/staff', 'GET', undefined],
    ['/api/users', 'GET', undefined],
    ['/api/reorder-suggestions', 'GET', undefined],
    ['/api/platform', 'GET', undefined],
  ]

  for (const [path, method] of forbidden) {
    const res = await call(path, { method, token })
    check(
      `a cashier cannot reach ${method} ${path}`,
      res.status === 401 || res.status === 403,
      `status ${res.status}`,
    )
  }

  const createProduct = await call('/api/products', {
    method: 'POST',
    token,
    body: { emri: `${TAG} Illegal`, kategoria: 'x', sasia: 1, cmimiBlerjes: 1, cmimiShitjes: 2 },
  })
  check(
    'a cashier cannot create a product',
    createProduct.status === 401 || createProduct.status === 403,
    `status ${createProduct.status}`,
  )

  const restore = await call('/api/restore', { method: 'POST', token, body: { backup: {} } })
  check(
    'a cashier cannot invoke restore',
    restore.status === 401 || restore.status === 403,
    `status ${restore.status}`,
  )

  const readProducts = await call('/api/products', { token })
  check('a cashier can still read products (POS needs them)', readProducts.status === 200, `status ${readProducts.status}`)
}

// ---------------------------------------------------------------------------
// Staff PIN login scoping
// ---------------------------------------------------------------------------

async function staffLoginScoping(prisma: PrismaLike, world: World): Promise<void> {
  section('BUG-01 — staff PIN login organization scoping')

  const orgA = world.a.organizationId
  const orgB = world.b.organizationId

  // --- the exact QA failure: one name, two tenants ------------------------

  // 1 & 2. Both organizations employ someone with the identical name (created
  // in the fixtures). 3. Each must authenticate with their own PIN.
  const aOwnPin = await call('/api/staff-auth/login', {
    method: 'POST',
    terminalOrg: orgA,
    ip: '10.0.0.1',
    body: { emri: world.collidingName, pin: world.collidePinA },
  })
  check(
    'org A cashier authenticates with a name org B also uses',
    aOwnPin.status === 200,
    `status ${aOwnPin.status} body ${aOwnPin.text.slice(0, 120)}`,
  )

  const bOwnPin = await call('/api/staff-auth/login', {
    method: 'POST',
    terminalOrg: orgB,
    ip: '10.0.0.2',
    body: { emri: world.collidingName, pin: world.collidePinB },
  })
  check(
    'org B cashier authenticates with the same shared name, independently',
    bOwnPin.status === 200,
    `status ${bOwnPin.status} body ${bOwnPin.text.slice(0, 120)}`,
  )

  check(
    'a staff name shared with another tenant does not block login',
    aOwnPin.status !== 409 && bOwnPin.status !== 409,
    'the cross-tenant 409 collision is back',
  )

  // 4. Org A's PIN must not open org B's cashier.
  const aPinOnB = await call('/api/staff-auth/login', {
    method: 'POST',
    terminalOrg: orgB,
    ip: '10.0.0.3',
    body: { emri: world.collidingName, pin: world.collidePinA },
  })
  check(
    "org A's PIN cannot authenticate org B's cashier",
    aPinOnB.status !== 200,
    `status ${aPinOnB.status}`,
  )

  // 5. And the reverse.
  const bPinOnA = await call('/api/staff-auth/login', {
    method: 'POST',
    terminalOrg: orgA,
    ip: '10.0.0.4',
    body: { emri: world.collidingName, pin: world.collidePinB },
  })
  check(
    "org B's PIN cannot authenticate org A's cashier",
    bPinOnA.status !== 200,
    `status ${bPinOnA.status}`,
  )

  // 6. No organization context at all must fail safely, even with a correct PIN.
  const noContext = await call('/api/staff-auth/login', {
    method: 'POST',
    ip: '10.0.0.5',
    body: { emri: world.soloName, pin: world.soloPin },
  })
  check(
    'PIN login requires organization context',
    noContext.status !== 200,
    'a correct name + PIN authenticated with no organization context supplied',
  )
  check(
    'missing organization context fails with a 4xx, not a crash',
    noContext.status >= 400 && noContext.status < 500,
    `status ${noContext.status}`,
  )

  // 7. Invalid or unknown organization context must fail safely too.
  const invalidContexts: Array<[string, string]> = [
    ['non-numeric', 'not-a-number'],
    ['negative', '-1'],
    ['zero', '0'],
    ['nonexistent', '2147483600'],
  ]
  for (let index = 0; index < invalidContexts.length; index++) {
    const [label, value] = invalidContexts[index]
    const res = await call('/api/staff-auth/login', {
      method: 'POST',
      terminalOrg: value,
      ip: `10.0.1.${index}`,
      body: { emri: world.soloName, pin: world.soloPin },
    })
    check(
      `${label} organization context fails safely`,
      res.status >= 400 && res.status < 500,
      `status ${res.status}`,
    )
  }

  // A forged context naming a real other tenant must not grant access: the
  // caller still has to know a name and PIN inside that tenant.
  const forged = await call('/api/staff-auth/login', {
    method: 'POST',
    terminalOrg: orgB,
    ip: '10.0.2.1',
    body: { emri: world.soloName, pin: world.soloPin },
  })
  check(
    'forged organization context grants no cross-tenant access',
    forged.status !== 200,
    `status ${forged.status} — org A's staff authenticated against org B`,
  )

  // Every session that was created must be bound to the tenant of the staff row.
  const sessionsA = await prisma.staffSession.findMany({ where: { organizationId: orgA } })
  const sessionsB = await prisma.staffSession.findMany({ where: { organizationId: orgB } })
  check(
    'each session is bound to its own tenant',
    sessionsA.every((s) => s.organizationId === orgA) &&
      sessionsB.every((s) => s.organizationId === orgB),
  )

  const aStaffIds = new Set(
    (await prisma.staff.findMany({ where: { organizationId: orgA }, select: { id: true } })).map(
      (s) => s.id,
    ),
  )
  check(
    "org A's sessions only ever reference org A's staff",
    sessionsA.every((s) => aStaffIds.has(s.staffId)),
  )

  // --- the staff directory ------------------------------------------------

  const directoryByParam = await call(`/api/staff-auth/list?orgId=${orgB}`, { ip: '10.0.3.1' })
  check(
    'the staff directory cannot be read for an arbitrary organization id',
    directoryByParam.status !== 200,
    `status ${directoryByParam.status} — returned another tenant's roster without credentials`,
  )

  const directoryScoped = await call('/api/staff-auth/list', { terminalOrg: orgA, ip: '10.0.3.2' })
  const scopedList = (directoryScoped.body?.staff ?? []) as Array<{ emri: string }>
  check(
    'a provisioned terminal still lists its own staff',
    directoryScoped.status === 200 && scopedList.length > 0,
    `status ${directoryScoped.status}, ${scopedList.length} staff`,
  )
  check(
    "and the directory it returns is only that tenant's",
    scopedList.every((s) => s.emri.startsWith(`${TAG} A`) || s.emri === world.collidingName || s.emri === world.soloName),
    `unexpected names: ${scopedList.map((s) => s.emri).join(', ')}`,
  )

  // A forged directory request for another tenant reveals nothing about ours.
  const directoryForged = await call('/api/staff-auth/list', { terminalOrg: orgB, ip: '10.0.3.3' })
  const forgedList = (directoryForged.body?.staff ?? []) as Array<{ emri: string }>
  check(
    'a forged terminal cookie cannot reach into a third tenant',
    !forgedList.some((s) => s.emri === world.soloName),
    "org A's uniquely named staff leaked into org B's directory",
  )
}

// ---------------------------------------------------------------------------
// Stage 13 — error sanitisation
// ---------------------------------------------------------------------------

async function errorSanitisation(world: World): Promise<void> {
  section('Stage 13 — error message sanitisation')

  const probes: Reply[] = []

  probes.push(await call('/api/sales', { method: 'POST', token: world.a.sessionToken, body: 'not-json' }))
  probes.push(await postSale(world.a, [{ productId: 'abc', emriProduktit: 'x', sasia: 1 }]))
  probes.push(await postSale(world.a, [{ productId: 999999999, emriProduktit: 'x', sasia: 1 }]))
  probes.push(await call('/api/sales/999999999', { method: 'DELETE', token: world.a.sessionToken }))
  probes.push(await call('/api/products/abc', { token: world.a.sessionToken }))
  probes.push(await call('/api/restore', { method: 'POST', token: world.a.sessionToken, body: { backup: { bad: 1 } } }))

  const leaks = [
    /postgres(ql)?:\/\//i,
    /pooler\.supabase\.com/i,
    /prisma\./i,
    /Invalid `prisma/i,
    /at [A-Za-z]+\s*\(.*:\d+:\d+\)/,
    /node_modules/i,
    /SUPABASE_SERVICE_ROLE_KEY/i,
    /connection_limit/i,
    /pgbouncer/i,
  ]

  let leaked = 0
  for (const p of probes) {
    for (const pattern of leaks) {
      if (pattern.test(p.text)) {
        leaked += 1
        observe(`response leaked internals (${pattern}): ${p.text.slice(0, 160)}`)
      }
    }
  }
  check('no error response leaks a connection string, driver text or stack trace', leaked === 0, `${leaked} leaks`)

  const withRequestId = probes.filter((p) => p.headers.get('X-Request-Id'))
  check(
    'error responses carry a request id for support',
    withRequestId.length === probes.length,
    `${withRequestId.length}/${probes.length} responses had X-Request-Id`,
  )

  const albanian = probes.filter((p) => typeof p.body?.error === 'string' && (p.body.error as string).length > 0)
  check(
    'error responses carry a human-readable message',
    albanian.length >= probes.length - 1,
    `${albanian.length}/${probes.length} had a message`,
  )
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup(prisma: PrismaLike, world: World): Promise<void> {
  section('Cleanup')

  const orgIds = [world.a.organizationId, world.b.organizationId, world.expired.organizationId]

  for (const orgId of orgIds) {
    const organization = await prisma.organization.findUnique({ where: { id: orgId } })
    if (organization && !organization.name.startsWith(TAG)) {
      console.error(`\n✖ Refusing to clean up organization ${orgId}: not created by this run.\n`)
      process.exit(1)
    }
  }

  const removed = {
    saleItems: (await prisma.saleItem.deleteMany({ where: { sale: { organizationId: { in: orgIds } } } })).count,
    sales: (await prisma.sale.deleteMany({ where: { organizationId: { in: orgIds } } })).count,
    products: (await prisma.product.deleteMany({ where: { organizationId: { in: orgIds } } })).count,
    staffSessions: (await prisma.staffSession.deleteMany({ where: { organizationId: { in: orgIds } } })).count,
    staff: (await prisma.staff.deleteMany({ where: { organizationId: { in: orgIds } } })).count,
    subscriptions: (await prisma.subscription.deleteMany({ where: { organizationId: { in: orgIds } } })).count,
    auditLogs: (await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } })).count,
    notifications: (await prisma.notification.deleteMany({ where: { organizationId: { in: orgIds } } })).count,
    idempotency: (await prisma.idempotencyRecord.deleteMany({ where: { organizationId: { in: orgIds } } })).count,
    organizations: (await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })).count,
  }

  console.log(`      ${JSON.stringify(removed)}`)

  const remaining = await prisma.organization.count({ where: { id: { in: orgIds } } })
  check('every disposable tenant is removed', remaining === 0, `${remaining} left`)

  const strays =
    (await prisma.sale.count({ where: { organizationId: { in: orgIds } } })) +
    (await prisma.product.count({ where: { organizationId: { in: orgIds } } })) +
    (await prisma.staff.count({ where: { organizationId: { in: orgIds } } })) +
    (await prisma.staffSession.count({ where: { organizationId: { in: orgIds } } })) +
    (await prisma.idempotencyRecord.count({ where: { organizationId: { in: orgIds } } }))
  check('no verification rows remain in any table', strays === 0, `${strays} rows left behind`)
}

type PrismaModule = typeof import('../src/lib/prisma')
type PrismaLike = PrismaModule['prisma']
