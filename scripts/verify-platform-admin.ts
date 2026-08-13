/**
 * ============================================================================
 *  Platform administration verification — real HTTP routes, localhost
 * ============================================================================
 *
 * Covers the operator-facing half of the product: organization suspension and
 * reactivation, the difference between a customer cancelling their renewal and
 * the platform suspending a tenant, platform-owner authorization, and the
 * tenant scoping of organization-user management and notifications.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SAFE TO RUN
 * ---------------------------------------------------------------------------
 *
 * It creates its own disposable organizations and Supabase auth users, every
 * one tagged with a unique run id, and deletes all of them afterwards. Existing
 * organizations, users, products and sales are never read, modified or deleted.
 * Cleanup runs in a `finally` and refuses to touch any organization whose name
 * does not carry this run's tag.
 *
 * Localhost only. No migration, no DDL, no raw SQL, no destructive operation.
 *
 * Requires a local server (`npm run build && npm start`) and, because it must
 * sign real users in, SUPABASE_SERVICE_ROLE_KEY in .env.
 *
 * Usage:
 *   npm run verify:platform-admin
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createServerClient } from '@supabase/ssr'

// Next.js loads .env itself; a standalone script has to do it explicitly.
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const RUN_ID = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
const TAG = `__VERIFY_PLATFORM__${RUN_ID}`

const DAY = 86_400_000

let passed = 0
let failed = 0

interface Actor {
  email: string
  password: string
  authUserId: string
  cookie: string
}

interface Tenant {
  organizationId: number
  admin: Actor
  productId: number
  notificationId: number
}

interface World {
  owner: Actor
  /** Paid, renewing. */
  a: Tenant
  /** Paid, but the customer cancelled renewal mid-period. */
  cancelling: Tenant
  /** Second tenant, used for isolation checks. */
  b: Tenant
}

void main()

async function main(): Promise<void> {
  assertLocalhost(BASE_URL)
  banner()

  const { prisma } = await import('../src/lib/prisma')
  const { createAdminClient } = await import('../src/lib/supabase/admin')
  const admin = createAdminClient()

  await assertServerIsUp()

  let world: World | null = null
  try {
    world = await createWorld(prisma, admin)
    await subscriptionStateVisibility(world)
    await suspensionBlocksAccess(prisma, world)
    await reactivationRestoresAccess(world)
    await cancellationIsNotSuspension(prisma, world)
    await platformAuthorization(world)
    await orgUserManagementScoping(world)
    await notificationScoping(world)
    await organizationListing(world)
    await organizationControlCenter(world)
    await globalDirectories(world)
    await platformAuditAndHealth(world)
    await roleChangeSafety(prisma, world)
    await suspensionReasonIsRecorded(world)
  } catch (error) {
    failed += 1
    console.log(`\n  ✖ verification aborted: ${(error as Error).message}`)
    console.log((error as Error).stack?.split('\n').slice(1, 4).join('\n'))
  } finally {
    if (world) await cleanup(prisma, admin, world)
    await prisma.$disconnect()
  }

  console.log(`\n${'='.repeat(74)}`)
  console.log(`  ${failed === 0 ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} — ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(74)}\n`)
  process.exit(failed === 0 ? 0 : 1)
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
  PLATFORM ADMINISTRATION VERIFICATION — real HTTP routes
${'='.repeat(74)}
  Target       : ${BASE_URL}
  Disposable   : organizations and auth users tagged ${TAG}
  Existing data: never read, never written, never deleted
  Run id       : ${RUN_ID}
${'='.repeat(74)}`)
}

function section(title: string): void {
  console.log(`\n▶ ${title}`)
}

/** Distinct values as a readable string for failure messages. */
function uniq(values: unknown[]): string {
  return values.filter((v, i) => values.indexOf(v) === i).map(String).join(',')
}

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✖ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

interface Reply {
  status: number
  body: Record<string, unknown> | null
  text: string
}

/**
 * A single operator making hundreds of platform calls in one minute is exactly
 * what the rate limiter exists to stop, and this suite is that operator. Rather
 * than raise the production limit to accommodate a test, the harness honours the
 * limiter: on a 429 it waits out the advertised window and tries once more.
 *
 * No assertion in this file expects a 429, so a retry can never hide a result
 * the suite was checking for.
 */
async function call(
  path: string,
  options: { method?: string; actor?: Actor | null; body?: unknown } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.actor) headers.cookie = options.actor.cookie

  const send = () =>
    fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

  let res = await send()

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10)
    const waitMs = (Number.isFinite(retryAfter) ? Math.min(retryAfter, 70) : 60) * 1000 + 1500
    process.stdout.write(`    … rate limit hit, waiting ${Math.round(waitMs / 1000)}s\n`)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    res = await send()
  }

  const text = await res.text()
  let body: Record<string, unknown> | null = null
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* non-JSON response kept as text */
  }
  return { status: res.status, body, text }
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

/**
 * Produces the cookies a browser would hold after signing in, by letting the
 * real Supabase SSR client write into a capture jar.
 */
async function signIn(email: string, password: string): Promise<string> {
  const jar: Record<string, string> = {}
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => { jar[name] = value }),
      },
    },
  )
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return Object.entries(jar).map(([n, v]) => `${n}=${v}`).join('; ')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createActor(admin: any, label: string, roli: string, organizationId: number, prisma: any): Promise<Actor> {
  const email = `verify-${RUN_ID}-${label}@example.invalid`
  const password = `Vf-${randomBytes(9).toString('hex')}!A1`

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`)

  await prisma.userRole.create({
    data: { userId: data.user.id, email, roli, organizationId },
  })

  return { email, password, authUserId: data.user.id, cookie: await signIn(email, password) }
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createWorld(prisma: any, admin: any): Promise<World> {
  section('Building disposable world')

  // The platform owner needs an organization of its own, mirroring production.
  const ownerOrg = await prisma.organization.create({ data: { name: `${TAG} platform` } })
  const owner = await createActor(admin, 'owner', 'platform_owner', ownerOrg.id, prisma)

  const makeTenant = async (label: string, subscription: Record<string, unknown>): Promise<Tenant> => {
    const org = await prisma.organization.create({
      data: { name: `${TAG} ${label}`, subscription: { create: subscription } },
    })
    const tenantAdmin = await createActor(admin, label, 'Administrator', org.id, prisma)
    const product = await prisma.product.create({
      data: {
        emri: `${TAG} produkt`, kategoria: 'Test', sasia: 25,
        cmimiBlerjes: 100, cmimiShitjes: 150, organizationId: org.id,
      },
    })
    const notification = await prisma.notification.create({
      data: {
        organizationId: org.id, type: 'LOW_STOCK',
        title: `${TAG} njoftim`, message: 'test', severity: 'high',
      },
    })
    return { organizationId: org.id, admin: tenantAdmin, productId: product.id, notificationId: notification.id }
  }

  const paid = {
    plan: 'monthly', status: 'active',
    currentPeriodStart: new Date(Date.now() - DAY),
    currentPeriodEnd: new Date(Date.now() + 30 * DAY),
  }

  const a = await makeTenant('a', paid)
  const b = await makeTenant('b', paid)
  const cancelling = await makeTenant('cancelling', paid)

  // Cancel renewal through the customer's own endpoint, so the state under test
  // is produced by the real flow rather than written directly.
  const cancelRes = await call('/api/subscription/cancel', {
    method: 'POST', actor: cancelling.admin, body: { action: 'cancel' },
  })
  check('customer cancellation endpoint schedules cancellation at period end',
    cancelRes.status === 200 && cancelRes.body?.scheduledCancel === true,
    `status ${cancelRes.status} ${cancelRes.text.slice(0, 120)}`)

  check('three disposable tenants and one platform owner created', true)
  return { owner, a, b, cancelling }
}

// ---------------------------------------------------------------------------
// 1. Subscription state visibility  (spec items 1–4)
// ---------------------------------------------------------------------------

async function subscriptionStateVisibility(world: World): Promise<void> {
  section('Subscription state is visible to the platform owner')

  const res = await call('/api/platform', { actor: world.owner })
  check('platform owner can read platform statistics', res.status === 200, `status ${res.status}`)

  const orgs = (res.body?.organizations ?? []) as Array<Record<string, unknown>>
  const row = (id: number) => orgs.find((o) => o.id === id)

  const activeRow = row(world.a.organizationId)
  const cancellingRow = row(world.cancelling.organizationId)

  check('an active tenant appears in the platform table', activeRow !== undefined)
  check('a cancelling tenant appears in the platform table', cancellingRow !== undefined)

  const cancellingSub = cancellingRow?.subscription as Record<string, unknown> | undefined
  const activeSub = activeRow?.subscription as Record<string, unknown> | undefined

  check('platform API exposes cancelAtPeriodEnd',
    cancellingSub !== undefined && 'cancelAtPeriodEnd' in cancellingSub,
    'field missing — the operator cannot see that the customer cancelled')

  check('the customer cancellation is flagged to the platform owner',
    cancellingSub?.cancelAtPeriodEnd === true,
    `cancelAtPeriodEnd=${String(cancellingSub?.cancelAtPeriodEnd)}`)

  check('platform API exposes the cancellation timestamp',
    cancellingSub?.cancelledAt != null)

  check('the paid-through date is available to render',
    typeof cancellingSub?.currentPeriodEnd === 'string')

  check('a cancelling tenant is distinguishable from a plain active one',
    activeSub?.cancelAtPeriodEnd === false && cancellingSub?.cancelAtPeriodEnd === true)

  // The cancelling tenant must still be able to work until the period ends.
  const stillWorking = await call('/api/products', { actor: world.cancelling.admin })
  check('a cancelled-at-period-end tenant retains access until the paid period ends',
    stillWorking.status === 200, `status ${stillWorking.status}`)

  const status = await call('/api/subscription-status', { actor: world.cancelling.admin })
  check('the tenant is reported as allowed with cancelAtPeriodEnd set',
    status.body?.allowed === true && status.body?.cancelAtPeriodEnd === true,
    JSON.stringify(status.body).slice(0, 160))

  const trialStatus = await call('/api/subscription-status', { actor: world.a.admin })
  check('an active tenant is allowed and not flagged as cancelling',
    trialStatus.body?.allowed === true && trialStatus.body?.cancelAtPeriodEnd === false)
}

// ---------------------------------------------------------------------------
// 2. Suspension  (spec items 6, 7)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function suspensionBlocksAccess(prisma: any, world: World): Promise<void> {
  section('Platform suspension blocks access and preserves data')

  const before = await call('/api/products', { actor: world.a.admin })
  check('tenant has normal access before suspension', before.status === 200, `status ${before.status}`)

  const suspend = await call(`/api/platform/organizations/${world.a.organizationId}`, {
    method: 'PATCH', actor: world.owner, body: { isActive: false },
  })
  check('platform owner can suspend an organization', suspend.status === 200, `status ${suspend.status}`)
  check('the response reports the organization as inactive',
    (suspend.body?.organization as Record<string, unknown> | undefined)?.isActive === false)

  const row = await prisma.organization.findUnique({ where: { id: world.a.organizationId } })
  check('isActive is persisted as false', row?.isActive === false)

  // The reported defect: the flag was written but nothing read it.
  const products = await call('/api/products', { actor: world.a.admin })
  check('suspended tenant is blocked from products', products.status === 403, `status ${products.status}`)

  const sales = await call('/api/sales', { actor: world.a.admin })
  check('suspended tenant is blocked from sales', sales.status === 403, `status ${sales.status}`)

  const dashboard = await call('/api/dashboard', { actor: world.a.admin })
  check('suspended tenant is blocked from the dashboard', dashboard.status === 403, `status ${dashboard.status}`)

  const notifications = await call('/api/notifications', { actor: world.a.admin })
  check('suspended tenant is blocked from notifications', notifications.status === 403, `status ${notifications.status}`)

  const status = await call('/api/subscription-status', { actor: world.a.admin })
  check('subscription status reports the tenant as not allowed', status.body?.allowed === false)
  check('suspension is reported distinctly from a billing lapse',
    status.body?.orgSuspended === true,
    `orgSuspended=${String(status.body?.orgSuspended)} — the UI cannot tell the operator's block from an expiry`)

  // Data must survive untouched.
  const product = await prisma.product.findUnique({ where: { id: world.a.productId } })
  const notifCount = await prisma.notification.count({ where: { organizationId: world.a.organizationId } })
  const subscription = await prisma.subscription.findUnique({ where: { organizationId: world.a.organizationId } })
  check('the tenant\'s product still exists after suspension', product !== null)
  check('the product quantity is unchanged', product?.sasia === 25, `sasia=${product?.sasia}`)
  check('notifications survive suspension', notifCount === 1, `count=${notifCount}`)
  check('the subscription row is untouched by suspension',
    subscription?.status === 'active' && subscription?.cancelAtPeriodEnd === false,
    `status=${subscription?.status} cancelAtPeriodEnd=${subscription?.cancelAtPeriodEnd}`)

  // Other tenants must be unaffected.
  const neighbour = await call('/api/products', { actor: world.b.admin })
  check('suspending one tenant does not affect another', neighbour.status === 200, `status ${neighbour.status}`)

  // The suspension must be auditable.
  const auditRows = await prisma.auditLog.count({
    where: { organizationId: world.a.organizationId, action: 'org_suspended' },
  })
  check('the suspension is written to the audit trail', auditRows === 1, `rows=${auditRows}`)
}

// ---------------------------------------------------------------------------
// 3. Reactivation  (spec items 8, 9)
// ---------------------------------------------------------------------------

async function reactivationRestoresAccess(world: World): Promise<void> {
  section('Reactivation restores access without corrupting subscription state')

  const reactivate = await call(`/api/platform/organizations/${world.a.organizationId}`, {
    method: 'PATCH', actor: world.owner, body: { isActive: true },
  })
  check('platform owner can reactivate an organization', reactivate.status === 200, `status ${reactivate.status}`)

  const products = await call('/api/products', { actor: world.a.admin })
  check('reactivated tenant regains access to products', products.status === 200, `status ${products.status}`)

  const status = await call('/api/subscription-status', { actor: world.a.admin })
  check('reactivated tenant is allowed again', status.body?.allowed === true)
  check('the suspended flag is cleared', status.body?.orgSuspended === false)
  check('the subscription is still active after the round trip', status.body?.subStatus === 'active')

  // Idempotency: sending the state it is already in must not flip it back.
  const repeat = await call(`/api/platform/organizations/${world.a.organizationId}`, {
    method: 'PATCH', actor: world.owner, body: { isActive: true },
  })
  check('re-sending the current state is a no-op rather than a toggle',
    repeat.status === 200 && (repeat.body?.organization as Record<string, unknown>)?.isActive === true,
    JSON.stringify(repeat.body).slice(0, 120))

  const invalid = await call(`/api/platform/organizations/${world.a.organizationId}`, {
    method: 'PATCH', actor: world.owner, body: { isActive: 'yes please' },
  })
  check('a non-boolean isActive is rejected', invalid.status === 400, `status ${invalid.status}`)
}

// ---------------------------------------------------------------------------
// 4. Cancellation is not suspension  (spec item 5)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cancellationIsNotSuspension(prisma: any, world: World): Promise<void> {
  section('Customer cancellation and platform suspension stay distinct')

  const org = await prisma.organization.findUnique({ where: { id: world.cancelling.organizationId } })
  check('a customer cancellation leaves the organization active',
    org?.isActive === true,
    'cancelling a subscription must never suspend the organization')

  const sub = await prisma.subscription.findUnique({ where: { organizationId: world.cancelling.organizationId } })
  check('the subscription keeps its active status while inside the paid period',
    sub?.status === 'active' && sub?.cancelAtPeriodEnd === true,
    `status=${sub?.status} cancelAtPeriodEnd=${sub?.cancelAtPeriodEnd}`)

  const access = await call('/api/products', { actor: world.cancelling.admin })
  check('the cancelling customer still has access', access.status === 200, `status ${access.status}`)

  // The platform's own cancel action is a different, immediate operation.
  const platformCancel = await call(`/api/platform/subscriptions/${world.cancelling.organizationId}`, {
    method: 'POST', actor: world.owner, body: { action: 'cancel' },
  })
  check('platform owner can cancel a subscription outright', platformCancel.status === 200, `status ${platformCancel.status}`)

  const afterCancel = await prisma.organization.findUnique({ where: { id: world.cancelling.organizationId } })
  check('a platform cancellation still does not suspend the organization',
    afterCancel?.isActive === true,
    'the two controls must remain independent')

  const blocked = await call('/api/products', { actor: world.cancelling.admin })
  check('an outright cancellation ends access immediately', blocked.status === 403, `status ${blocked.status}`)

  const blockedStatus = await call('/api/subscription-status', { actor: world.cancelling.admin })
  check('a billing block is not reported as a suspension',
    blockedStatus.body?.allowed === false && blockedStatus.body?.orgSuspended === false,
    JSON.stringify(blockedStatus.body).slice(0, 160))
}

// ---------------------------------------------------------------------------
// 5. Authorization  (spec items 10, 11)
// ---------------------------------------------------------------------------

async function platformAuthorization(world: World): Promise<void> {
  section('Platform endpoints reject non-platform-owner callers')

  const tenantAdmin = world.a.admin
  const target = world.b.organizationId

  const cases: { label: string; path: string; method: string; body?: unknown }[] = [
    { label: 'read platform statistics', path: '/api/platform', method: 'GET' },
    { label: 'list another org\'s users', path: `/api/platform/organizations/${target}/users`, method: 'GET' },
    { label: 'add a user to another org', path: `/api/platform/organizations/${target}/users`, method: 'POST', body: { email: 'x@example.invalid', roli: 'Cashier' } },
    { label: 'suspend another organization', path: `/api/platform/organizations/${target}`, method: 'PATCH', body: { isActive: false } },
    { label: 'read another org\'s subscription', path: `/api/platform/subscriptions/${target}`, method: 'GET' },
    { label: 'change another org\'s subscription', path: `/api/platform/subscriptions/${target}`, method: 'PUT', body: { status: 'active' } },
    { label: 'run a subscription action on another org', path: `/api/platform/subscriptions/${target}`, method: 'POST', body: { action: 'cancel' } },
    { label: 'create an organization', path: '/api/platform/organizations', method: 'POST', body: { name: 'should not exist' } },
    // Platform Owner V2 surfaces. Each one reads across tenants, so each one is
    // checked against the same two unauthorized callers.
    { label: 'list every organization', path: '/api/platform/organizations', method: 'GET' },
    { label: 'read another org\'s profile', path: `/api/platform/organizations/${target}`, method: 'GET' },
    { label: 'read another org\'s staff', path: `/api/platform/organizations/${target}/staff`, method: 'GET' },
    { label: 'read another org\'s activity', path: `/api/platform/organizations/${target}/activity`, method: 'GET' },
    { label: 'change a role in another org', path: `/api/platform/organizations/${target}/users/1`, method: 'PATCH', body: { roli: 'Administrator' } },
    { label: 'read the global user directory', path: '/api/platform/users', method: 'GET' },
    { label: 'read the cross-tenant audit log', path: '/api/platform/audit', method: 'GET' },
    { label: 'read the platform alert queue', path: '/api/platform/alerts', method: 'GET' },
    { label: 'search across tenants', path: '/api/platform/search?q=market', method: 'GET' },
  ]

  for (const c of cases) {
    const res = await call(c.path, { method: c.method, actor: tenantAdmin, body: c.body })
    check(`an org Administrator cannot ${c.label}`, res.status === 403, `status ${res.status}`)
  }

  for (const c of cases) {
    const res = await call(c.path, { method: c.method, actor: null, body: c.body })
    check(`an anonymous caller cannot ${c.label}`, res.status === 401, `status ${res.status}`)
  }

  // Tenant B must be genuinely untouched by all of the above.
  const bStill = await call('/api/products', { actor: world.b.admin })
  check('the targeted organization was not affected by the rejected calls', bStill.status === 200)
}

// ---------------------------------------------------------------------------
// 6. Organization-user management  (spec item 12)
// ---------------------------------------------------------------------------

async function orgUserManagementScoping(world: World): Promise<void> {
  section('Organization-user management is tenant-correct')

  const aUsers = await call(`/api/platform/organizations/${world.a.organizationId}/users`, { actor: world.owner })
  check('platform owner can list an organization\'s users', aUsers.status === 200, `status ${aUsers.status}`)

  const listed = (aUsers.body?.users ?? []) as Array<Record<string, unknown>>
  check('the listing returns only that organization\'s members',
    listed.length === 1 && listed[0]?.email === world.a.admin.email,
    `returned ${listed.length}: ${listed.map((u) => u.email).join(', ')}`)

  const bUsers = await call(`/api/platform/organizations/${world.b.organizationId}/users`, { actor: world.owner })
  const bListed = (bUsers.body?.users ?? []) as Array<Record<string, unknown>>
  check('a different organization returns a disjoint set',
    bListed.length === 1 && bListed[0]?.email === world.b.admin.email,
    `returned ${bListed.map((u) => u.email).join(', ')}`)

  check('no user appears in both organizations',
    !listed.some((u) => bListed.some((v) => v.email === u.email)))

  const missing = await call('/api/platform/organizations/99999999/users', { actor: world.owner })
  check('listing users of a non-existent organization returns an empty set, not an error',
    missing.status === 200 && ((missing.body?.users ?? []) as unknown[]).length === 0,
    `status ${missing.status}`)

  const badId = await call('/api/platform/organizations/not-a-number/users', { actor: world.owner })
  check('a malformed organization id is rejected', badId.status === 400, `status ${badId.status}`)
}

// ---------------------------------------------------------------------------
// 7. Notifications  (spec items 13, 14, 16)
// ---------------------------------------------------------------------------

async function notificationScoping(world: World): Promise<void> {
  section('Notifications are tenant-scoped and degrade cleanly')

  const aNotifs = await call('/api/notifications?limit=100', { actor: world.a.admin })
  check('an organization can read its notifications', aNotifs.status === 200, `status ${aNotifs.status}`)

  const rows = (aNotifs.body?.notifications ?? []) as Array<Record<string, unknown>>
  check('exactly the organization\'s own notifications are returned',
    rows.length === 1 && rows[0]?.id === world.a.notificationId,
    `returned ${rows.length}`)
  check('no notification from another tenant leaks in',
    rows.every((n) => n.organizationId === world.a.organizationId))

  const bNotifs = await call('/api/notifications?limit=100', { actor: world.b.admin })
  const bRows = (bNotifs.body?.notifications ?? []) as Array<Record<string, unknown>>
  check('a second tenant sees only its own notification',
    bRows.length === 1 && bRows[0]?.id === world.b.notificationId)

  const count = await call('/api/notifications?countOnly=true', { actor: world.a.admin })
  check('the unread count is scoped to the tenant', count.body?.unreadCount === 1, JSON.stringify(count.body))

  // Marking read, then the empty state for the unread filter.
  const mark = await call(`/api/notifications/${world.a.notificationId}`, { method: 'PATCH', actor: world.a.admin })
  check('a notification can be marked read', mark.status === 200, `status ${mark.status}`)

  const unreadAfter = await call('/api/notifications?limit=100&unreadOnly=true', { actor: world.a.admin })
  const unreadRows = (unreadAfter.body?.notifications ?? []) as unknown[]
  check('the unread filter returns an empty list once everything is read',
    unreadAfter.status === 200 && unreadRows.length === 0,
    `status ${unreadAfter.status}, rows ${unreadRows.length}`)
  check('an empty result is a success, not an error',
    unreadAfter.status === 200 && unreadAfter.body?.unreadCount === 0)

  // Cross-tenant write must fail.
  const crossMark = await call(`/api/notifications/${world.b.notificationId}`, {
    method: 'PATCH', actor: world.a.admin,
  })
  check('one tenant cannot mark another tenant\'s notification read',
    crossMark.status === 404, `status ${crossMark.status}`)

  const markAll = await call('/api/notifications/mark-all-read', { method: 'POST', actor: world.a.admin })
  check('mark-all-read succeeds', markAll.status === 200, `status ${markAll.status}`)

  const bAfter = await call('/api/notifications?countOnly=true', { actor: world.b.admin })
  check('mark-all-read did not touch the other tenant', bAfter.body?.unreadCount === 1,
    `other tenant unread=${bAfter.body?.unreadCount}`)

  const anon = await call('/api/notifications', { actor: null })
  check('an unauthenticated notifications read is a clean 401, not a hang',
    anon.status === 401, `status ${anon.status}`)
}

// ---------------------------------------------------------------------------
// 8. Organization listing — search, filters, sorting, paging
// ---------------------------------------------------------------------------

async function organizationListing(world: World): Promise<void> {
  section('Organization listing filters and sorts correctly')

  const all = await call('/api/platform/organizations?pageSize=100', { actor: world.owner })
  check('platform owner can list organizations', all.status === 200, `status ${all.status}`)

  const rows = (all.body?.organizations ?? []) as Array<Record<string, unknown>>
  const mine = rows.filter((r) => String(r.name).startsWith(TAG))
  check('the disposable tenants appear in the listing', mine.length >= 3, `found ${mine.length}`)

  check('rows carry the counts the table renders',
    mine.every((r) => typeof r.usersCount === 'number' && typeof r.staffCount === 'number'
      && typeof r.productsCount === 'number' && typeof r.salesCount === 'number'))

  check('the response reports a portfolio-wide state tally',
    typeof all.body?.stateCounts === 'object' && all.body?.stateCounts !== null)

  // Search
  const search = await call(
    `/api/platform/organizations?q=${encodeURIComponent(`${TAG} cancelling`)}`,
    { actor: world.owner },
  )
  const found = (search.body?.organizations ?? []) as Array<Record<string, unknown>>
  check('search narrows the listing to matching names',
    found.length === 1 && found[0]?.id === world.cancelling.organizationId,
    `returned ${found.length}`)

  const noMatch = await call('/api/platform/organizations?q=__nothing_matches_this__', { actor: world.owner })
  check('a search with no matches returns an empty list and total 0',
    noMatch.status === 200 && noMatch.body?.total === 0
      && ((noMatch.body?.organizations ?? []) as unknown[]).length === 0,
    `status ${noMatch.status}, total ${noMatch.body?.total}`)

  // State filtering must agree with the badge each row would render.
  const cancelledFilter = await call('/api/platform/organizations?state=cancelled&pageSize=100', { actor: world.owner })
  const cancelledIds = ((cancelledFilter.body?.organizations ?? []) as Array<Record<string, unknown>>).map((r) => r.id)
  check('the cancelled filter contains the outright-cancelled tenant',
    cancelledIds.includes(world.cancelling.organizationId),
    `ids ${cancelledIds.join(',')}`)

  const activeFilter = await call('/api/platform/organizations?state=active&pageSize=100', { actor: world.owner })
  const activeIds = ((activeFilter.body?.organizations ?? []) as Array<Record<string, unknown>>).map((r) => r.id)
  check('the active filter excludes the cancelled tenant',
    !activeIds.includes(world.cancelling.organizationId))
  check('the active filter includes a healthy paying tenant',
    activeIds.includes(world.b.organizationId), `ids ${activeIds.join(',')}`)

  const attention = await call('/api/platform/organizations?state=attention&pageSize=100', { actor: world.owner })
  const attentionIds = ((attention.body?.organizations ?? []) as Array<Record<string, unknown>>).map((r) => r.id)
  check('the attention filter surfaces the cancelled tenant',
    attentionIds.includes(world.cancelling.organizationId))
  check('the attention filter leaves healthy tenants alone',
    !attentionIds.includes(world.b.organizationId))

  // Paging
  const paged = await call('/api/platform/organizations?pageSize=1&page=1', { actor: world.owner })
  check('a page returns at most pageSize rows',
    ((paged.body?.organizations ?? []) as unknown[]).length <= 1)
  check('paging reports the unpaged total and a page count',
    typeof paged.body?.total === 'number' && typeof paged.body?.totalPages === 'number'
      && (paged.body!.total as number) >= 3)

  // Hostile input must be clamped, not executed or crashed on.
  const hostile = await call(
    '/api/platform/organizations?sort=;DROP%20TABLE&dir=sideways&page=-9&pageSize=999999',
    { actor: world.owner },
  )
  check('unknown sort keys and out-of-range paging are clamped, not rejected with a 500',
    hostile.status === 200 && (hostile.body?.pageSize as number) <= 100 && hostile.body?.page === 1,
    `status ${hostile.status}, pageSize ${hostile.body?.pageSize}`)
}

// ---------------------------------------------------------------------------
// 9. Organization Control Center
// ---------------------------------------------------------------------------

async function organizationControlCenter(world: World): Promise<void> {
  section('Organization Control Center loads and stays scoped')

  const detail = await call(`/api/platform/organizations/${world.a.organizationId}`, { actor: world.owner })
  check('platform owner can open an organization', detail.status === 200, `status ${detail.status}`)

  const org = detail.body?.organization as Record<string, unknown> | undefined
  check('the profile identifies the organization it was asked for',
    org?.id === world.a.organizationId, `got ${String(org?.id)}`)
  check('the profile carries aggregate counts', typeof org?.counts === 'object' && org?.counts !== null)
  check('the profile carries revenue totals', typeof org?.totals === 'object' && org?.totals !== null)
  check('the profile carries the subscription needed to resolve state',
    org !== undefined && 'subscription' in org && 'isActive' in org)

  const counts = (org?.counts ?? {}) as Record<string, number>
  check('the product count matches the tenant\'s own data', counts.products === 1, `products=${counts.products}`)
  check('the user count matches the tenant\'s own data', counts.users === 1, `users=${counts.users}`)

  const missing = await call('/api/platform/organizations/99999999', { actor: world.owner })
  check('a non-existent organization returns 404, not an empty shell',
    missing.status === 404, `status ${missing.status}`)

  const badId = await call('/api/platform/organizations/not-a-number', { actor: world.owner })
  check('a malformed organization id is rejected on the detail route',
    badId.status === 400, `status ${badId.status}`)

  // Staff
  const staff = await call(`/api/platform/organizations/${world.a.organizationId}/staff`, { actor: world.owner })
  check('the staff endpoint answers', staff.status === 200, `status ${staff.status}`)
  check('a tenant with no PIN staff returns an empty list, not an error',
    ((staff.body?.staff ?? []) as unknown[]).length === 0)
  check('the staff payload never mentions a PIN hash',
    !staff.text.includes('pinHash'), 'pinHash present in the staff response')

  // Activity
  const activity = await call(`/api/platform/organizations/${world.a.organizationId}/activity`, { actor: world.owner })
  check('the activity feed answers', activity.status === 200, `status ${activity.status}`)

  const events = (activity.body?.events ?? []) as Array<Record<string, unknown>>
  check('the activity feed contains the suspension recorded earlier',
    events.some((e) => String(e.stream) === 'audit' && String(e.title).includes('pezullua')),
    `${events.length} events, streams: ${uniq(events.map((e) => e.stream))}`)
  check('every activity event is dated and labelled',
    events.every((e) => typeof e.at === 'string' && typeof e.title === 'string' && e.title !== ''))

  const filtered = await call(
    `/api/platform/organizations/${world.a.organizationId}/activity?stream=sale`,
    { actor: world.owner },
  )
  const saleEvents = (filtered.body?.events ?? []) as Array<Record<string, unknown>>
  check('the stream filter returns only that stream',
    saleEvents.every((e) => e.stream === 'sale'),
    `streams: ${uniq(saleEvents.map((e) => e.stream))}`)

  const badActivity = await call('/api/platform/organizations/oops/activity', { actor: world.owner })
  check('a malformed id is rejected on the activity route', badActivity.status === 400, `status ${badActivity.status}`)
}

// ---------------------------------------------------------------------------
// 10. Global directories: users, search, alerts
// ---------------------------------------------------------------------------

async function globalDirectories(world: World): Promise<void> {
  section('Global directories are complete and leak nothing')

  const dir = await call(`/api/platform/users?q=verify-${RUN_ID}`, { actor: world.owner })
  check('platform owner can read the global user directory', dir.status === 200, `status ${dir.status}`)

  const users = (dir.body?.users ?? []) as Array<Record<string, unknown>>
  check('the directory finds this run\'s disposable accounts', users.length >= 3, `found ${users.length}`)
  check('every directory row names its organization',
    users.every((u) => typeof u.organizationId === 'number' && typeof u.organizationName === 'string'),
    'a row is missing its organization')
  check('the directory never returns a credential field',
    !dir.text.includes('pinHash') && !dir.text.includes('password'),
    'credential-looking field present')

  const scoped = await call(`/api/platform/users?organizationId=${world.b.organizationId}`, { actor: world.owner })
  const scopedUsers = (scoped.body?.users ?? []) as Array<Record<string, unknown>>
  check('filtering the directory by organization returns only that organization',
    scopedUsers.length > 0 && scopedUsers.every((u) => u.organizationId === world.b.organizationId),
    `returned ${scopedUsers.length}`)

  const badDir = await call('/api/platform/users?organizationId=abc', { actor: world.owner })
  check('a malformed organization filter is rejected', badDir.status === 400, `status ${badDir.status}`)

  // Search
  const search = await call(`/api/platform/search?q=${encodeURIComponent(TAG)}`, { actor: world.owner })
  check('global search answers', search.status === 200, `status ${search.status}`)
  const foundOrgs = (search.body?.organizations ?? []) as Array<Record<string, unknown>>
  check('global search finds the disposable organizations', foundOrgs.length >= 3, `found ${foundOrgs.length}`)
  const foundProducts = (search.body?.products ?? []) as Array<Record<string, unknown>>
  check('product hits carry the organization they belong to',
    foundProducts.every((p) => typeof p.organizationId === 'number' && typeof p.organizationName === 'string'))
  check('search results never include a PIN hash', !search.text.includes('pinHash'))

  const tooShort = await call('/api/platform/search?q=a', { actor: world.owner })
  check('a one-character query short-circuits instead of scanning every table',
    tooShort.status === 200 && tooShort.body?.tooShort === true,
    `status ${tooShort.status}`)

  // Alerts
  const alerts = await call('/api/platform/alerts', { actor: world.owner })
  check('the alert queue answers', alerts.status === 200, `status ${alerts.status}`)

  const rows = (alerts.body?.alerts ?? []) as Array<Record<string, unknown>>
  check('the cancelled tenant appears in the attention queue',
    rows.some((a) => a.organizationId === world.cancelling.organizationId),
    `${rows.length} alerts`)
  check('every alert names an organization and a severity',
    rows.every((a) => typeof a.organizationId === 'number'
      && ['high', 'medium', 'low'].includes(String(a.severity))))
  check('alert counts are reported per severity',
    typeof (alerts.body?.counts as Record<string, unknown>)?.high === 'number')

  const highOnly = await call('/api/platform/alerts?severity=high', { actor: world.owner })
  const highRows = (highOnly.body?.alerts ?? []) as Array<Record<string, unknown>>
  check('the severity filter returns only that severity',
    highRows.every((a) => a.severity === 'high'),
    `severities: ${uniq(highRows.map((a) => a.severity))}`)
}

// ---------------------------------------------------------------------------
// 11. Platform audit and system health
// ---------------------------------------------------------------------------

async function platformAuditAndHealth(world: World): Promise<void> {
  section('Platform audit and system health are operator-only')

  const audit = await call('/api/platform/audit?pageSize=50', { actor: world.owner })
  check('platform owner can read the cross-tenant audit log', audit.status === 200, `status ${audit.status}`)

  const logs = (audit.body?.logs ?? []) as Array<Record<string, unknown>>
  check('audit rows name the organization they belong to',
    logs.every((l) => typeof l.organizationId === 'number' && typeof l.organizationName === 'string'))
  check('audit rows omit the free-form metadata blob',
    logs.every((l) => !('metadata' in l)),
    'metadata is being published in the cross-tenant view')
  check('filter vocabularies are returned for the UI',
    Array.isArray(audit.body?.actions) && Array.isArray(audit.body?.entityTypes))

  const scoped = await call(
    `/api/platform/audit?organizationId=${world.a.organizationId}&pageSize=50`,
    { actor: world.owner },
  )
  const scopedLogs = (scoped.body?.logs ?? []) as Array<Record<string, unknown>>
  check('narrowing the audit view to one organization returns only its rows',
    scopedLogs.length > 0 && scopedLogs.every((l) => l.organizationId === world.a.organizationId),
    `returned ${scopedLogs.length}`)
  check('the suspension recorded earlier is present in that organization\'s audit',
    scopedLogs.some((l) => l.action === 'org_suspended'))
  check('the reactivation is present too',
    scopedLogs.some((l) => l.action === 'org_reactivated'))

  const actionFilter = await call('/api/platform/audit?action=org_suspended&pageSize=50', { actor: world.owner })
  const actionLogs = (actionFilter.body?.logs ?? []) as Array<Record<string, unknown>>
  check('the action filter returns only that action',
    actionLogs.every((l) => l.action === 'org_suspended'),
    `actions: ${uniq(actionLogs.map((l) => l.action))}`)

  const badOrg = await call('/api/platform/audit?organizationId=abc', { actor: world.owner })
  check('a malformed organization filter on audit is rejected', badOrg.status === 400, `status ${badOrg.status}`)

  // System health metrics are cross-tenant performance data.
  const ownerMetrics = await call('/api/health?metrics=true', { actor: world.owner })
  check('platform owner can read system metrics',
    ownerMetrics.status === 200 && ownerMetrics.body?.metrics !== undefined,
    `status ${ownerMetrics.status}`)

  const tenantMetrics = await call('/api/health?metrics=true', { actor: world.a.admin })
  check('an org Administrator cannot read system metrics', tenantMetrics.status === 403, `status ${tenantMetrics.status}`)

  const anonMetrics = await call('/api/health?metrics=true', { actor: null })
  check('an anonymous caller cannot read system metrics', anonMetrics.status === 401, `status ${anonMetrics.status}`)

  const publicHealth = await call('/api/health?probe=liveness', { actor: null })
  check('the liveness probe stays public and carries no metrics',
    publicHealth.status === 200 && publicHealth.body?.metrics === undefined,
    `status ${publicHealth.status}`)
  check('health never publishes a configuration value',
    !ownerMetrics.text.includes('postgresql://') && !ownerMetrics.text.includes('DATABASE_URL'),
    'a configuration value leaked into the health payload')
}

// ---------------------------------------------------------------------------
// 12. Role changes from the platform side
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function roleChangeSafety(prisma: any, world: World): Promise<void> {
  section('Platform-side role changes are guarded')

  // A second member of tenant B, created directly so no Supabase auth user is
  // left behind. The endpoint under test only touches the UserRole table.
  const extra = await prisma.userRole.create({
    data: {
      userId: `${TAG}-extra-${randomBytes(4).toString('hex')}`,
      email: `verify-${RUN_ID}-extra@example.invalid`,
      roli: 'Cashier',
      organizationId: world.b.organizationId,
    },
  })

  const base = `/api/platform/organizations/${world.b.organizationId}/users/${extra.id}`

  const invalid = await call(base, { method: 'PATCH', actor: world.owner, body: { roli: 'Superuser' } })
  check('an unknown role is rejected', invalid.status === 400, `status ${invalid.status}`)

  const noBody = await call(base, { method: 'PATCH', actor: world.owner, body: {} })
  check('a missing role is rejected', noBody.status === 400, `status ${noBody.status}`)

  // The important scoping check: a real user id, but the wrong organization.
  const wrongOrg = await call(
    `/api/platform/organizations/${world.a.organizationId}/users/${extra.id}`,
    { method: 'PATCH', actor: world.owner, body: { roli: 'Manager' } },
  )
  check('a user id from another organization does not resolve',
    wrongOrg.status === 404, `status ${wrongOrg.status}`)

  const promoted = await call(base, { method: 'PATCH', actor: world.owner, body: { roli: 'Manager' } })
  check('a valid role change succeeds', promoted.status === 200, `status ${promoted.status}`)

  const stored = await prisma.userRole.findUnique({ where: { id: extra.id } })
  check('the new role is persisted', stored?.roli === 'Manager', `roli=${stored?.roli}`)

  const repeat = await call(base, { method: 'PATCH', actor: world.owner, body: { roli: 'Manager' } })
  check('repeating the same change is a no-op rather than a second write',
    repeat.status === 200 && repeat.body?.unchanged === true,
    `status ${repeat.status}`)

  // Tenant B's only Administrator must not be demotable.
  const bAdminRow = await prisma.userRole.findFirst({
    where: { organizationId: world.b.organizationId, roli: 'Administrator' },
  })
  const demote = await call(
    `/api/platform/organizations/${world.b.organizationId}/users/${bAdminRow.id}`,
    { method: 'PATCH', actor: world.owner, body: { roli: 'Cashier' } },
  )
  check('the last Administrator of an organization cannot be demoted',
    demote.status === 409, `status ${demote.status}`)

  const stillAdmin = await prisma.userRole.findUnique({ where: { id: bAdminRow.id } })
  check('the refused demotion changed nothing', stillAdmin?.roli === 'Administrator')

  const auditRow = await prisma.auditLog.findFirst({
    where: { organizationId: world.b.organizationId, action: 'change_role' },
    orderBy: { createdAt: 'desc' },
  })
  check('the role change is written to the tenant\'s audit trail', auditRow != null)
}

// ---------------------------------------------------------------------------
// 13. Suspension reason
// ---------------------------------------------------------------------------

async function suspensionReasonIsRecorded(world: World): Promise<void> {
  section('Suspension reason is captured without a schema change')

  const reason = `mospagesë e konfirmuar ${RUN_ID}`

  const suspend = await call(`/api/platform/organizations/${world.a.organizationId}`, {
    method: 'PATCH', actor: world.owner, body: { isActive: false, reason },
  })
  check('a suspension accepts an operator reason', suspend.status === 200, `status ${suspend.status}`)

  const detail = await call(`/api/platform/organizations/${world.a.organizationId}`, { actor: world.owner })
  const accessLog = (detail.body?.accessLog ?? []) as Array<Record<string, unknown>>
  const latest = accessLog[0]

  check('the access log surfaces the most recent suspension first',
    latest?.action === 'org_suspended', `action ${String(latest?.action)}`)
  check('the reason is stored in the audit metadata',
    (latest?.metadata as Record<string, unknown> | null)?.reason === reason,
    `metadata ${JSON.stringify(latest?.metadata)}`)
  check('the reason also appears in the human-readable description',
    String(latest?.description ?? '').includes(reason))

  const badReason = await call(`/api/platform/organizations/${world.a.organizationId}`, {
    method: 'PATCH', actor: world.owner, body: { isActive: true, reason: 12345 },
  })
  check('a non-string reason is rejected', badReason.status === 400, `status ${badReason.status}`)

  const restore = await call(`/api/platform/organizations/${world.a.organizationId}`, {
    method: 'PATCH', actor: world.owner, body: { isActive: true, reason: 'pagesa u rregullua' },
  })
  check('the tenant can be reinstated with its own reason', restore.status === 200, `status ${restore.status}`)

  const after = await call('/api/products', { actor: world.a.admin })
  check('access is restored after the reinstatement', after.status === 200, `status ${after.status}`)
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanup(prisma: any, admin: any, world: World): Promise<void> {
  section('Cleanup')

  const orgIds = await prisma.organization.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true, name: true },
  })

  let removed = 0
  for (const org of orgIds) {
    // Refuse to delete anything not carrying this run's tag.
    if (!org.name.startsWith(TAG)) continue
    await prisma.saleItem.deleteMany({ where: { sale: { organizationId: org.id } } })
    await prisma.sale.deleteMany({ where: { organizationId: org.id } })
    await prisma.supplyItem.deleteMany({ where: { supply: { organizationId: org.id } } })
    await prisma.supply.deleteMany({ where: { organizationId: org.id } })
    await prisma.productBarcode.deleteMany({ where: { product: { organizationId: org.id } } })
    await prisma.product.deleteMany({ where: { organizationId: org.id } })
    await prisma.supplier.deleteMany({ where: { organizationId: org.id } })
    await prisma.staffSession.deleteMany({ where: { organizationId: org.id } })
    await prisma.staff.deleteMany({ where: { organizationId: org.id } })
    await prisma.notification.deleteMany({ where: { organizationId: org.id } })
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } })
    await prisma.billingAuditLog.deleteMany({ where: { organizationId: org.id } })
    await prisma.idempotencyRecord.deleteMany({ where: { organizationId: org.id } })
    await prisma.userRole.deleteMany({ where: { organizationId: org.id } })
    await prisma.subscription.deleteMany({ where: { organizationId: org.id } })
    await prisma.organization.delete({ where: { id: org.id } })
    removed += 1
  }

  let authRemoved = 0
  for (const actor of [world.owner, world.a.admin, world.b.admin, world.cancelling.admin]) {
    try {
      await admin.auth.admin.deleteUser(actor.authUserId)
      authRemoved += 1
    } catch {
      /* already gone */
    }
  }

  const residue = await prisma.organization.count({ where: { name: { startsWith: TAG } } })
  check(`removed ${removed} disposable organizations and ${authRemoved} auth users`, residue === 0,
    `${residue} tagged organizations remain`)
}
