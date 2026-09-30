// GATE G1. The GREEN and RED pair, 25 times each, every run in a fresh cargo
// test process with a freshly built state directory and a freshly spawned
// middleware process.
import { runCase, upstreamBytesAfterDeny } from './run-case.mjs'

const RUNS = Number(process.env.APS_MW_G1_RUNS ?? 25)
const results = { green: [], red: [] }
const started = Date.now()

for (let i = 1; i <= RUNS; i++) {
  const green = runCase({
    label: `GREEN ${i}/${RUNS}`,
    test: 'aps_middleware_allows_valid_chain_and_forwards',
    chain: 'valid',
    revocations: 'none',
    tag: `g1-green-${i}`,
  })
  results.green.push(green)
  const red = runCase({
    label: `RED ${i}/${RUNS}`,
    test: 'aps_middleware_denies_before_upstream',
    chain: 'valid',
    revocations: 'parent-grant-revoked',
    expectReason: 'aps_authority_revoked',
    tag: `g1-red-${i}`,
  })
  results.red.push(red)
  // One RED run makes exactly one post-denial read of the upstream pipe. The
  // metric is that read's own byte count. A run with no line observed nothing.
  const redBytes = upstreamBytesAfterDeny(red.stdout)
  const zeroBytes = redBytes.length === 1 && redBytes[0] === 0
  const observed = redBytes.length === 0 ? 'MISSING' : redBytes.join(',')
  process.stdout.write(
    `run ${String(i).padStart(2)}  green exit=${green.status} ran=${green.ran}  ` +
    `red exit=${red.status} ran=${red.ran} ` +
    `APS_UPSTREAM_BYTES_AFTER_DENY=${observed} zero_upstream_bytes=${zeroBytes}\n`,
  )
  if (!green.ok) { console.error(green.stdout + green.stderr); }
  if (!red.ok) { console.error(red.stdout + red.stderr); }
}

const greenOk = results.green.filter(r => r.ok).length
const redOk = results.red.filter(r => r.ok).length
// "Zero upstream bytes" comes from one place: the harness's own post-denial read
// of the upstream pipe, printed as APS_UPSTREAM_BYTES_AFTER_DENY before any
// assertion runs. A RED run that printed no such line made no observation and is
// counted as a failure of this metric, not as a zero.
const redZeroBytes = results.red.filter(r => {
  const bytes = upstreamBytesAfterDeny(r.stdout)
  return bytes.length === 1 && bytes[0] === 0
}).length
const redMissingMetric = results.red.filter(r => upstreamBytesAfterDeny(r.stdout).length === 0).length
const elapsed = ((Date.now() - started) / 1000).toFixed(1)

console.log(`\nGREEN passed ${greenOk}/${RUNS}`)
console.log(`RED   passed ${redOk}/${RUNS}`)
console.log(`RED runs with zero upstream bytes: ${redZeroBytes}/${RUNS}   (observation missing in ${redMissingMetric})`)
console.log(`total runs: ${greenOk + redOk}/${RUNS * 2}   elapsed ${elapsed}s`)
const pass = greenOk === RUNS && redOk === RUNS && redZeroBytes === RUNS
console.log(`\nGATE G1: ${pass ? 'PASS' : 'FAIL'}`)
console.log(`command per GREEN run: ${results.green[0].command}`)
console.log(`command per RED run:   ${results.red[0].command}`)
process.exit(pass ? 0 : 1)
