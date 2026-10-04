// Builds the two CANDIDATE artifacts. Neither is added to the conformance lab
// repo. They are separate on purpose: the neutral vector's expected result is an
// APS decision only, and OpenShell behavior is a separate observation.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyAuthorityDelegationChain } from 'agent-passport-system'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..', 'fixtures')
const read = (p) => JSON.parse(readFileSync(join(FIXTURES, p), 'utf8'))

const anchors = read('trust-anchors.TEST-ONLY.json')
const chain = read('chains/valid.json').chain
const revoked = read('revocations/parent-grant-revoked.json').revoked_delegation_ids

// A pinned evaluation instant inside every member's validity window, so the
// vector is decidable without a clock.
const NOW = '2026-06-01T00:00:00.000Z'

function decide(revokedIds) {
  const r = verifyAuthorityDelegationChain(chain, {
    now: NOW,
    trustRoot: (root) =>
      anchors.roots.some(a => a.issuer === root.issuer && a.subject === root.subject) &&
      root.parent_delegation_id === null,
    resolveVerificationKey: (_i, vm) => anchors.keys[vm] ?? null,
    resolveRevocation: (d) => (revokedIds.includes(d.delegation_id) ? 'revoked' : 'active'),
  })
  return { state: r.state, valid: r.valid, failures: r.failures }
}

const active = decide([])
const ancestorRevoked = decide(revoked)

const neutral = {
  _comment:
    'CANDIDATE. TEST ONLY keys. A neutral APS Case A vector: an authority delegation ' +
    'chain, a revocation state, an evaluation instant, and the expected APS decision. ' +
    'Runnable by any verifier of the APS authority-delegation v1 profile. It needs ' +
    'neither OpenShell nor the APS OpenShell reference enforcement middleware, and it ' +
    'says nothing about either.',
  status: 'CANDIDATE',
  vector_id: 'aps-authority-delegation-case-a-ancestor-revoked',
  profile: 'aps:authority-delegation:v1',
  construction_ref:
    'draft-pidlisnyi-aps-04 Section 4.1 (delegation_id and signature construction, including the ' +
    'APS-AUTHORITY-DELEGATION-ID-V1 and APS-AUTHORITY-DELEGATION-SIGNATURE-V1 domain tags with a 0x00 ' +
    'separator) and Section 4.2 (component orders, including reversibility)',
  evaluated_at: NOW,
  trust_anchors: { roots: anchors.roots, verification_keys: anchors.keys },
  chain,
  cases: [
    {
      case_id: 'ancestor-active',
      description: 'No member is revoked. The root-to-leaf chain is admissible at evaluated_at.',
      revocation_state: { revoked_delegation_ids: [] },
      expected: { state: active.state, valid: active.valid, failure_codes: active.failures.map(f => f.code) },
    },
    {
      case_id: 'ancestor-revoked',
      description:
        "The root principal's grant to the parent agent (chain index 0) is revoked. " +
        'The child record itself is untouched and still verifies on its own terms.',
      revocation_state: { revoked_delegation_ids: revoked },
      expected: {
        state: ancestorRevoked.state,
        valid: ancestorRevoked.valid,
        failure_codes: ancestorRevoked.failures.map(f => f.code),
        failure_index: ancestorRevoked.failures[0]?.index,
      },
    },
  ],
}

const observation = {
  _comment:
    'CANDIDATE. An adapter observation, not an APS conformance vector. It records what ' +
    'the tested OpenShell relay did when the neutral APS decision above was DENY at the ' +
    'supervisor middleware boundary. OpenShell behavior is deliberately not part of the ' +
    'neutral vector s expected APS result.',
  status: 'CANDIDATE',
  observation_id: 'openshell-supervisor-middleware-adapter-case-a',
  refers_to_vector: neutral.vector_id,
  refers_to_case: 'ancestor-revoked',
  host: {
    project: 'NVIDIA/OpenShell',
    commit: 'ba16b9f2c7c59899532628ffa6cd26d37bffd477',
    tested_path: 'relay_with_inspection (relay.rs:853) -> relay_rest (relay.rs:1830), dispatched at relay.rs:877',
    enforcement_point: 'crates/openshell-supervisor-network/src/l7/relay.rs:1988',
    denial_return: 'crates/openshell-supervisor-network/src/l7/relay.rs:2017',
    upstream_write: 'crates/openshell-supervisor-network/src/l7/relay.rs:2088',
    path_not_exercised:
      'relay_with_route_selection (crates/openshell-supervisor-network/src/l7/relay.rs:923) is not ' +
      'exercised by any test behind this observation. Whether it enforces the same way is UNKNOWN.',
  },
  posture: {
    attachment: 'network_middlewares entry, on_error: fail_closed, endpoints.include: ["**"]',
    endpoint: 'host api.example.test port 8080 protocol rest enforcement enforce, L7 rule allows GET /v1/**',
    identity: 'operator-configured sandbox_id -> APS agent_id mapping; not a cryptographic binding',
  },
  observed:
    'When the neutral decision is DENY at the supervisor middleware boundary, the tested ' +
    'relay sends zero HTTP request bytes upstream and returns 403 with ' +
    'error=middleware_denied, middleware=aps-authority, reason_code=aps_authority_revoked. ' +
    'Zero bytes is a single 200 ms read of the upstream pipe, taken after the client ' +
    'already has the denial response.',
  not_observed:
    'Whether a TCP connection to the upstream was created. The zero-bytes result is about ' +
    'HTTP request and application bytes received by the upstream inside the 200 ms window ' +
    'after the denial reached the client, nothing more. A forward that arrived after that ' +
    'window would not be seen, and no test here drives a delayed forward.',
  runs: { green: 25, red: 25, red_runs_with_zero_upstream_bytes: 25 },
}

writeFileSync(join(HERE, 'case-a-neutral-vector.CANDIDATE.json'), JSON.stringify(neutral, null, 2) + '\n')
writeFileSync(join(HERE, 'openshell-adapter-observation.CANDIDATE.json'), JSON.stringify(observation, null, 2) + '\n')
console.log(`neutral vector: ancestor-active => ${active.state}, ancestor-revoked => ${ancestorRevoked.state} (${ancestorRevoked.failures[0]?.code} at index ${ancestorRevoked.failures[0]?.index})`)
console.log('wrote vector/case-a-neutral-vector.CANDIDATE.json and vector/openshell-adapter-observation.CANDIDATE.json')
