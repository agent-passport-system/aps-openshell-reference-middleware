// Single-case driver, for wiring up and for quoting one command in evidence.
import { runCase } from './run-case.mjs'
const [, , test, ...rest] = process.argv
const opts = Object.fromEntries(rest.map(a => { const [k, ...v] = a.split('='); return [k, v.join('=')] }))
const r = runCase({
  label: test,
  test,
  chain: opts.chain ?? 'valid',
  revocations: opts.revocations ?? 'none',
  stampNow: opts.stampNow !== 'false',
  expectReason: opts.expectReason ?? null,
  swapTo: opts.swapTo ?? null,
  latencyRequests: opts.latencyRequests ? Number(opts.latencyRequests) : null,
  decisionLog: opts.decisionLog ?? null,
})
process.stdout.write(r.stdout)
process.stderr.write(r.stderr)
console.log(`\n[${r.label}] exit=${r.status} ran=${r.ran} selectedNone=${r.selectedNone} ok=${r.ok}`)
process.exit(r.ok ? 0 : 1)
