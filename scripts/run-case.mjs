// Runs one harness case: builds the state directory, then runs the named
// OpenShell relay test in a fresh `cargo test` process with the environment the
// harness reads. The middleware process is spawned by the test itself.
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, FIXTURES, buildStateDir } from './state.mjs'

export const OPENSHELL = process.env.APS_OPENSHELL_DIR ?? '/tmp/aps-os/openshell'
export const SANDBOX_ID = 'sbx-aps-case-a-child'
const RUNS_DIR = process.env.APS_MW_RUNS_DIR ?? '/tmp/aps-mw-runs'

export function runCase({
  label,
  test,
  chain = 'valid',
  revocations = 'none',
  stampNow = true,
  expectReason = null,
  swapTo = null,
  swapSource = null,
  unreadableRevocations = false,
  allowUpgrades = false,
  latencyRequests = null,
  decisionLog = null,
  tag = '',
}) {
  mkdirSync(RUNS_DIR, { recursive: true })
  const stateDir = join(RUNS_DIR, `state-${test}-${tag || 'x'}-${process.pid}-${Date.now()}`)
  buildStateDir(stateDir, { chain, revocations, stampNow, swapSource, unreadableRevocations })

  const env = {
    ...process.env,
    APS_MW_NODE: process.execPath,
    APS_MW_SCRIPT: join(REPO, 'src', 'server.mjs'),
    APS_MW_STATE: stateDir,
    APS_MW_SANDBOX_ID: SANDBOX_ID,
  }
  if (expectReason !== null) env.APS_MW_EXPECT_REASON = expectReason
  if (swapTo !== null) {
    // A plain file copy the harness performs between two requests.
    env.APS_MW_SWAP_FROM = join(stateDir, swapTo)
    env.APS_MW_SWAP_TO = join(stateDir, 'revocations.json')
  }
  if (latencyRequests !== null) env.APS_MW_LATENCY_REQUESTS = String(latencyRequests)
  if (decisionLog !== null) env.APS_MW_DECISION_LOG = decisionLog
  if (allowUpgrades) env.APS_MW_ALLOW_UPGRADES = '1'

  const fullName = `l7::relay::tests::${test}`
  const args = [
    'test', '-p', 'openshell-supervisor-network', '--lib',
    fullName, '--', '--exact', '--nocapture', '--test-threads=1',
  ]
  const result = spawnSync('cargo', args, { cwd: OPENSHELL, env, encoding: 'utf8' })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  // A run that selected no test is a failure, never a pass. cargo exits 0 when
  // a filter matches nothing, which would otherwise read as green.
  const ran = /test result: ok\. 1 passed/.test(stdout)
  const selectedNone = /0 passed; 0 failed/.test(stdout) && !ran
  return {
    label,
    test,
    fullName,
    status: result.status,
    ran,
    selectedNone,
    ok: result.status === 0 && ran && !selectedNone,
    stdout,
    stderr,
    stateDir,
    command: `cargo ${args.join(' ')}`,
  }
}

/** Prepare the "revoked after the first request" swap source inside the state dir. */
export function withRevokedSwapSource(stateDir) {
  return stateDir
}

/**
 * Every `APS_UPSTREAM_BYTES_AFTER_DENY=<n>` value the harness printed, in order.
 * The harness prints exactly one per post-denial read of the upstream pipe, and
 * nothing else prints that key, so the count of matches is the count of
 * observations that actually happened. A deny case with no match observed
 * nothing: callers must treat that as a failure, never as a zero. Matched
 * anywhere in the line, because the Rust test harness prefixes the first line of
 * a test's output with "test <name> ... ".
 */
export function upstreamBytesAfterDeny(stdout) {
  return [...(stdout ?? '').matchAll(/APS_UPSTREAM_BYTES_AFTER_DENY=(\d+)/g)].map(m => Number(m[1]))
}

export { FIXTURES }
