// Runs the neutral Case A vector against the APS SDK. No OpenShell, no
// middleware, no relay. Another verifier of the same profile can replace the
// import with its own implementation.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAuthorityDelegationChain } from 'agent-passport-system'

const HERE = dirname(fileURLToPath(import.meta.url))
const vector = JSON.parse(readFileSync(join(HERE, 'case-a-neutral-vector.CANDIDATE.json'), 'utf8'))

let failed = 0
for (const c of vector.cases) {
  const result = verifyAuthorityDelegationChain(vector.chain, {
    now: vector.evaluated_at,
    trustRoot: (root) =>
      vector.trust_anchors.roots.some(a => a.issuer === root.issuer && a.subject === root.subject) &&
      root.parent_delegation_id === null,
    resolveVerificationKey: (_issuer, vm) => vector.trust_anchors.verification_keys[vm] ?? null,
    resolveRevocation: (d) =>
      c.revocation_state.revoked_delegation_ids.includes(d.delegation_id) ? 'revoked' : 'active',
  })
  const codes = result.failures.map(f => f.code)
  const ok = result.state === c.expected.state &&
    result.valid === c.expected.valid &&
    JSON.stringify(codes) === JSON.stringify(c.expected.failure_codes) &&
    (c.expected.failure_index === undefined || result.failures[0]?.index === c.expected.failure_index)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.case_id}: state=${result.state} codes=[${codes}]` +
    (ok ? '' : ` want state=${c.expected.state} codes=[${c.expected.failure_codes}]`))
}
console.log(failed === 0 ? `\n${vector.vector_id}: all ${vector.cases.length} cases match` : `\n${failed} case(s) failed`)
process.exit(failed === 0 ? 0 : 1)
