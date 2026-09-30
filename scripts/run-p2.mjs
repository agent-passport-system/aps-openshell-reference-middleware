// P2 hardening suite. One case per scenario, all through the same harness. Every
// deny case asserts the decision and zero upstream bytes.
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { runCase } from './run-case.mjs'

const DECISION_LOG = '/tmp/aps-mw-p2-decisions.jsonl'

const CASES = [
  {
    id: 'p2-1-static-narrowing',
    title: 'Static monotonic narrowing: child requests authority outside the signed parent authority',
    test: 'aps_middleware_denies_before_upstream',
    chain: 'widened',
    revocations: 'none',
    expectReason: 'aps_authority_not_narrowed',
    expectApsCode: 'SCOPE_WIDENING',
  },
  {
    id: 'p2-2a-revocation-missing',
    title: 'Revocation state unresolvable: file missing',
    test: 'aps_middleware_denies_before_upstream',
    revocations: 'absent',
    expectReason: 'aps_revocation_unknown',
    expectApsCode: 'REVOCATION_UNKNOWN',
    expectUnresolved: true,
  },
  {
    id: 'p2-2b-revocation-unreadable',
    title: 'Revocation state unresolvable: file unreadable',
    test: 'aps_middleware_denies_before_upstream',
    revocations: 'none',
    unreadableRevocations: true,
    expectReason: 'aps_revocation_unknown',
    expectApsCode: 'REVOCATION_UNKNOWN',
    expectUnresolved: true,
  },
  {
    id: 'p2-2c-revocation-malformed',
    title: 'Revocation state unresolvable: file malformed',
    test: 'aps_middleware_denies_before_upstream',
    revocations: 'malformed',
    expectReason: 'aps_revocation_unknown',
    expectApsCode: 'REVOCATION_UNKNOWN',
    expectUnresolved: true,
  },
  {
    id: 'p2-2d-revocation-stale',
    title: 'Revocation state unresolvable: outside the middleware local freshness rule',
    test: 'aps_middleware_denies_before_upstream',
    revocations: 'stale',
    stampNow: false,
    expectReason: 'aps_revocation_unknown',
    expectApsCode: 'REVOCATION_UNKNOWN',
    expectUnresolved: true,
  },
  {
    id: 'p2-3-expired-link',
    title: 'Expired link in the chain',
    test: 'aps_middleware_denies_before_upstream',
    chain: 'expired',
    expectReason: 'aps_authority_expired',
    expectApsCode: 'EXPIRED',
  },
  {
    id: 'p2-4a-tampered',
    title: 'Tampered chain: one byte changed in a signed field',
    test: 'aps_middleware_denies_before_upstream',
    chain: 'tampered',
    expectReason: 'aps_record_tampered',
    expectApsCode: 'ID_MISMATCH',
  },
  {
    id: 'p2-4b-wrong-signature',
    title: 'Wrong signature: child record signed by a key that is not the issuer',
    test: 'aps_middleware_denies_before_upstream',
    chain: 'wrong-signature',
    expectReason: 'aps_signature_invalid',
    expectApsCode: 'SIGNATURE_INVALID',
  },
  {
    id: 'p2-5-middleware-unreachable',
    title: 'Middleware registered, one request allowed, process killed, next request observed',
    test: 'aps_middleware_registered_but_unreachable_denies_before_upstream',
  },
  {
    id: 'p2-6-upgrade-denied',
    title: 'WebSocket upgrade request reaches the middleware and is denied before upstream',
    test: 'aps_middleware_denies_upgrade_request_before_upstream',
  },
  {
    id: 'p2-6-control-upgrade-reaches-upstream',
    title: 'Control for case 6: with the refusal off, the same upgrade request does reach upstream',
    test: 'aps_upgrade_reaches_upstream_when_middleware_allows_it',
    allowUpgrades: true,
    allowsUpstream: true,
  },
  {
    id: 'p2-7-revoked-between-requests',
    title: 'Revocation between two requests of the same session',
    test: 'aps_middleware_denies_second_request_after_revocation',
    revocations: 'none',
    swapSource: 'parent-grant-revoked',
    swapTo: 'revocations.swap.json',
  },
]

const LATENCY_CASE = {
  id: 'p2-8-latency',
  title: 'Middleware decision latency over 200 allowed requests, as measured on this machine',
  test: 'aps_middleware_latency_over_allowed_requests',
  latencyRequests: Number(process.env.APS_MW_LATENCY_REQUESTS ?? 200),
}

function decisionsFrom(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

function runOne(c, pass) {
  const log = `${DECISION_LOG}.${c.id}.${pass}`
  rmSync(log, { force: true })
  const r = runCase({ ...c, label: c.id, decisionLog: log, tag: `${c.id}-${pass}` })
  const decisions = decisionsFrom(log)
  const problems = []
  if (!r.ok) problems.push(`test did not pass (exit=${r.status} ran=${r.ran})`)
  if (!c.allowsUpstream && /upstream received \d+ bytes/.test(r.stdout)) {
    problems.push('upstream received bytes')
  }
  if (c.expectApsCode) {
    const denied = decisions.filter(d => d.decision === 'deny')
    if (denied.length === 0) problems.push('no deny decision recorded by the middleware')
    else if (denied.at(-1).aps_code !== c.expectApsCode) {
      problems.push(`aps_code ${denied.at(-1).aps_code} != ${c.expectApsCode}`)
    }
  }
  if (c.expectUnresolved) {
    const denied = decisions.filter(d => d.decision === 'deny').at(-1)
    // unknown must stay distinct from revoked: the middleware records why it
    // could not resolve, and APS reports REVOCATION_UNKNOWN, never REVOKED.
    if (!denied || denied.revocation_unresolved === null) {
      problems.push('revocation_unresolved not recorded')
    }
    if (denied && denied.aps_code === 'REVOKED') {
      problems.push('unresolved revocation was recorded as REVOKED')
    }
  }
  return { ...r, id: c.id, title: c.title, decisions, problems, log }
}

const PASSES = Number(process.env.APS_MW_P2_PASSES ?? 10)
const tally = new Map(CASES.map(c => [c.id, 0]))
let firstPassDetail = []

for (let pass = 1; pass <= PASSES; pass++) {
  const line = []
  for (const c of CASES) {
    const r = runOne(c, pass)
    if (r.problems.length === 0) tally.set(c.id, tally.get(c.id) + 1)
    line.push(`${c.id}=${r.problems.length === 0 ? 'ok' : 'FAIL'}`)
    if (r.problems.length > 0) {
      console.error(`\n--- ${c.id} pass ${pass} problems: ${r.problems.join('; ')}`)
      console.error(r.stdout.split('\n').filter(l => /panick|assertion|left|right|^test /.test(l)).join('\n'))
    }
    if (pass === 1) firstPassDetail.push(r)
  }
  console.log(`pass ${String(pass).padStart(2)}/${PASSES}  ${line.join('  ')}`)
}

console.log('\nPer-case tally over all passes:')
let allOk = true
for (const c of CASES) {
  const n = tally.get(c.id)
  if (n !== PASSES) allOk = false
  console.log(`  ${n === PASSES ? 'ok  ' : 'FAIL'}  ${c.id}  ${n}/${PASSES}  ${c.title}`)
}

// Case 8, run once: latency over allowed requests.
console.log(`\n${LATENCY_CASE.id}: ${LATENCY_CASE.title}`)
const latLog = `${DECISION_LOG}.latency`
rmSync(latLog, { force: true })
const lat = runCase({ ...LATENCY_CASE, label: LATENCY_CASE.id, decisionLog: latLog, tag: 'latency' })
const latDecisions = decisionsFrom(latLog)
const allowed = latDecisions.filter(d => d.decision === 'allow').map(d => d.decision_us).sort((a, b) => a - b)
const q = (p) => allowed.length === 0 ? NaN : allowed[Math.min(allowed.length - 1, Math.floor(p * allowed.length))]
const latOk = lat.ok && allowed.length === LATENCY_CASE.latencyRequests
console.log(`  ${latOk ? 'ok  ' : 'FAIL'}  exit=${lat.status} ran=${lat.ran} allowed_decisions=${allowed.length}/${LATENCY_CASE.latencyRequests}`)
if (allowed.length > 0) {
  console.log(`  middleware decision time over ${allowed.length} allowed requests, measured on this machine:`)
  console.log(`    median ${q(0.5).toFixed(0)} us   p95 ${q(0.95).toFixed(0)} us   min ${allowed[0].toFixed(0)} us   max ${allowed.at(-1).toFixed(0)} us`)
}
if (!latOk) allOk = false

console.log(`\nP2 SUITE: ${allOk ? 'PASS' : 'FAIL'} (${PASSES} passes of ${CASES.length} cases, plus the latency case once)`)
console.log(`sample command: ${firstPassDetail[0]?.command ?? ''}`)
process.exit(allOk ? 0 : 1)
