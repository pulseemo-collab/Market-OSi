#!/usr/bin/env node
/**
 * ============================================================================
 *  DO NOT RUN AGAINST PRODUCTION WITHOUT EXPLICIT APPROVAL
 * ============================================================================
 *
 * Load and failure-mode probe for a LOCAL Market OS instance.
 *
 * This script is not imported by the application. It talks to a running server
 * over HTTP and nothing else — it opens no database connection and holds no
 * credentials.
 *
 * Guard rails:
 *   - The target must be localhost/127.0.0.1 unless --i-know-what-im-doing is
 *     passed, which also requires --confirm-target to match the host exactly.
 *   - Write scenarios are opt-in (--writes) and refuse to run against a
 *     non-local target under any flag combination, because they create real
 *     sales rows.
 *
 * Usage:
 *   node scripts/load-test.mjs --scenario health --requests 200 --concurrency 20
 *   node scripts/load-test.mjs --scenario duplicates --key abc
 *
 * Scenarios:
 *   health      GET /api/health                 — baseline throughput/latency
 *   liveness    GET /api/health?probe=liveness  — dependency-free path
 *   read        GET <--path>                    — an authenticated read
 *   duplicates  N identical POSTs sharing one Idempotency-Key
 *   burst       All requests released at once, to observe rate limiting
 *
 * Authenticated scenarios need a session cookie: --cookie "sb-...=...".
 *
 * NOTE: the `duplicates` scenario needs a live session and creates real sales,
 * so it verifies idempotency only as far as an authenticated end-to-end smoke
 * test. To verify durable cross-instance idempotency against the real database
 * without touching business data, run `npm run verify:idempotency` instead —
 * it drives the claim protocol from separate processes under a sentinel tenant
 * and cleans up after itself.
 */

const args = parseArgs(process.argv.slice(2))

const target = args.target ?? 'http://localhost:3000'
const scenario = args.scenario ?? 'health'
const requests = Number(args.requests ?? 100)
const concurrency = Number(args.concurrency ?? 10)

assertTargetIsSafe(target, args)

const scenarios = {
  health: () => ({ url: `${target}/api/health`, init: { method: 'GET' } }),
  liveness: () => ({ url: `${target}/api/health?probe=liveness`, init: { method: 'GET' } }),
  read: () => ({
    url: `${target}${args.path ?? '/api/products'}`,
    init: { method: 'GET', headers: authHeaders() },
  }),
  duplicates: () => ({
    url: `${target}${args.path ?? '/api/sales'}`,
    init: {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
        'Idempotency-Key': args.key ?? 'load-test-fixed-key',
      },
      body: args.body ?? JSON.stringify({ items: [] }),
    },
  }),
  burst: () => ({ url: `${target}/api/health`, init: { method: 'GET' } }),
}

if (!scenarios[scenario]) {
  fail(`Unknown scenario "${scenario}". Known: ${Object.keys(scenarios).join(', ')}`)
}

if (scenario === 'duplicates' && !args.writes) {
  fail('The "duplicates" scenario creates real rows. Re-run with --writes to confirm.')
}

console.log(
  `\n▶ ${scenario} — ${requests} requests, concurrency ${scenario === 'burst' ? requests : concurrency}\n  target: ${target}\n`,
)

const results = await run()
report(results)

// ---------------------------------------------------------------------------

async function run() {
  const build = scenarios[scenario]
  const latencies = []
  const statusCounts = new Map()
  let errors = 0
  let next = 0

  const startedAt = Date.now()

  // "burst" releases everything at once to observe overload behaviour; the
  // other scenarios keep a fixed number of requests in flight.
  const workers = scenario === 'burst' ? requests : Math.min(concurrency, requests)

  async function worker() {
    for (;;) {
      const index = next++
      if (index >= requests) return

      const { url, init } = build()
      const t0 = performance.now()
      try {
        const res = await fetch(url, init)
        // Drain the body so the connection is released and latency covers the
        // full response, not just the headers.
        await res.arrayBuffer()
        latencies.push(performance.now() - t0)
        statusCounts.set(res.status, (statusCounts.get(res.status) ?? 0) + 1)
      } catch (err) {
        errors += 1
        latencies.push(performance.now() - t0)
        statusCounts.set(`network:${err.cause?.code ?? err.name}`, (statusCounts.get('network') ?? 0) + 1)
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, worker))

  return { latencies, statusCounts, errors, wallMs: Date.now() - startedAt }
}

function report({ latencies, statusCounts, errors, wallMs }) {
  latencies.sort((a, b) => a - b)

  const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] : 0)
  const round = (n) => Math.round(n * 100) / 100

  console.log('  status codes:')
  for (const [status, count] of [...statusCounts.entries()].sort()) {
    console.log(`    ${status}: ${count}`)
  }

  console.log(`
  requests     ${latencies.length}
  errors       ${errors}
  wall time    ${wallMs} ms
  throughput   ${round((latencies.length / wallMs) * 1000)} req/s
  p50          ${round(pct(50))} ms
  p95          ${round(pct(95))} ms
  p99          ${round(pct(99))} ms
  max          ${round(latencies[latencies.length - 1] ?? 0)} ms
`)

  if (scenario === 'duplicates') {
    const created = statusCounts.get(201) ?? 0
    console.log(
      created <= 1
        ? '  ✔ at most one row created across all duplicates\n'
        : `  ✖ ${created} rows created — idempotency did not hold\n`,
    )
  }
}

function authHeaders() {
  return args.cookie ? { cookie: args.cookie } : {}
}

function assertTargetIsSafe(url, flags) {
  let host
  try {
    host = new URL(url).hostname
  } catch {
    fail(`--target is not a valid URL: ${url}`)
  }

  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (isLocal) return

  if (flags.writes) {
    fail('Write scenarios are refused against a non-local target. No exceptions.')
  }

  if (!flags['i-know-what-im-doing'] || flags['confirm-target'] !== host) {
    fail(
      `Refusing to load-test a non-local host (${host}).\n` +
        `If this is an approved staging target, pass:\n` +
        `  --i-know-what-im-doing --confirm-target ${host}`,
    )
  }

  console.warn(`\n⚠ Running against NON-LOCAL host ${host}. Ensure this is approved.\n`)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const nextArg = argv[i + 1]
    if (nextArg === undefined || nextArg.startsWith('--')) out[key] = true
    else {
      out[key] = nextArg
      i++
    }
  }
  return out
}

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}
