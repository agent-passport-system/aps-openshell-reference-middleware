// The APS decision for one OpenShell supervisor middleware HTTP request.
//
// Imported from the SDK's public package root, never a deep src/ path.
import { verifyAuthorityDelegationChain } from 'agent-passport-system'

import {
  Unresolved,
  loadChain,
  loadRevocationState,
  loadTrustAnchors,
  resolveAgentId,
} from './state.mjs'

/** Canonical UTC milliseconds, the only timestamp form the APS verifier accepts. */
export function canonicalNow(nowMs) {
  return new Date(nowMs).toISOString().replace(/(\.\d{3})?Z$/, (m) => (m === 'Z' ? '.000Z' : m))
}

const ALLOW = (detail) => ({ decision: 'allow', detail })
const DENY = (reasonCode, detail, extra = {}) => ({ decision: 'deny', reasonCode, detail, ...extra })

/**
 * Decide one request.
 *
 * Every path that is not a clean APS `valid` denies. Unknown identity, missing
 * chain, an unresolved revocation answer and any exception all deny.
 *
 * The requester is identified only by the supervisor-supplied `sandboxId`,
 * mapped through the operator-owned mapping file. Request content is never used
 * as the authorization identity.
 */
export function evaluateRequest({ sandboxId, headers, stateDir, nowMs, revocationMaxAgeMs, allowUpgrades = false }) {
  // Refuse a WebSocket upgrade attempt, which closes the WebSocket
  // agent-to-server binary frame and raw post-upgrade residual paths for this
  // deployment posture. Refused before any authority question, so the refusal
  // does not depend on chain state.
  //
  // Detected from the RFC 6455 handshake headers, not from `Upgrade`. OpenShell
  // omits `Upgrade` and `Connection` from what a middleware sees
  // (crates/openshell-supervisor-middleware/src/headers.rs:298 and :303 at
  // ba16b9f) and hands the HTTP request stage a hardcoded "https" scheme
  // (crates/openshell-supervisor-network/src/l7/middleware.rs:524), so neither
  // the header nor the scheme can carry the signal. `Sec-WebSocket-Key` and
  // `Sec-WebSocket-Version` are end-to-end headers and do reach the middleware;
  // that was confirmed by observing a real upgrade request through the relay.
  //
  // This catches an RFC 6455 WebSocket handshake. It does NOT catch a
  // non-WebSocket upgrade, which carries no Sec-WebSocket-* header and which
  // this middleware therefore cannot see at all.
  if (!allowUpgrades) {
    const handshake = headers.find(
      h => h.name === 'sec-websocket-key' || h.name === 'sec-websocket-version',
    )
    if (handshake !== undefined) {
      return DENY('aps_upgrade_not_permitted', `websocket handshake header present: ${handshake.name}`)
    }
  }

  const now = canonicalNow(nowMs)

  let agentId
  try {
    agentId = resolveAgentId(stateDir, sandboxId)
  } catch (error) {
    if (error instanceof Unresolved) return DENY('aps_mapping_unresolved', error.message)
    throw error
  }
  if (agentId === null) {
    return DENY('aps_unknown_sandbox', `no APS agent mapped for sandbox_id ${JSON.stringify(sandboxId)}`)
  }

  let chain
  let anchors
  try {
    chain = loadChain(stateDir, agentId)
    anchors = loadTrustAnchors(stateDir)
  } catch (error) {
    if (error instanceof Unresolved) return DENY('aps_chain_unavailable', error.message)
    throw error
  }

  // Resolved again for this request. A snapshot taken at startup is never
  // reused. `revocationUnresolved` keeps "could not answer" distinct from
  // "answered revoked": the verifier is handed `unknown`, and reports
  // REVOCATION_UNKNOWN under its own code.
  let revoked = null
  let revocationUnresolved = null
  try {
    revoked = loadRevocationState(stateDir, nowMs, revocationMaxAgeMs)
  } catch (error) {
    if (!(error instanceof Unresolved)) throw error
    revocationUnresolved = error.message
  }

  const result = verifyAuthorityDelegationChain(chain, {
    now,
    trustRoot: (root) =>
      anchors.roots.some(
        anchor => anchor.issuer === root.issuer && anchor.subject === root.subject,
      ) && root.parent_delegation_id === null,
    resolveVerificationKey: (_issuer, verificationMethod) => {
      const key = anchors.keys[verificationMethod]
      return typeof key === 'string' ? key : null
    },
    resolveRevocation: (delegation) => {
      if (revocationUnresolved !== null) return 'unknown'
      return revoked.has(delegation.delegation_id) ? 'revoked' : 'active'
    },
  })

  const first = result.failures[0]
  const apsDetail = `aps=${result.state}` +
    (first ? ` code=${first.code}${first.index === undefined ? '' : ` index=${first.index}`}` : '')

  if (result.state === 'valid') {
    return ALLOW(`${apsDetail} agent=${agentId}`)
  }

  const reasonCode = apsReasonCode(result.state, first?.code)
  const detail = revocationUnresolved !== null && first?.code === 'REVOCATION_UNKNOWN'
    ? `${apsDetail} (${revocationUnresolved})`
    : apsDetail
  return DENY(reasonCode, `${detail} agent=${agentId}`, {
    apsState: result.state,
    apsCode: first?.code,
    revocationUnresolved,
  })
}

/** Stable machine-readable deny codes. OpenShell may return these to the requester. */
function apsReasonCode(state, code) {
  switch (code) {
    case 'REVOKED': return 'aps_authority_revoked'
    case 'REVOCATION_UNKNOWN': return 'aps_revocation_unknown'
    case 'EXPIRED': return 'aps_authority_expired'
    case 'NOT_YET_VALID': return 'aps_authority_not_yet_valid'
    case 'SIGNATURE_INVALID': return 'aps_signature_invalid'
    case 'ID_MISMATCH': return 'aps_record_tampered'
    case 'SCOPE_WIDENING':
    case 'SPEND_WIDENING':
    case 'SPEND_UNIT_CHANGE':
    case 'DEPTH_WIDENING':
    case 'DEPTH_EXHAUSTED':
    case 'TIME_WIDENING':
    case 'REPUTATION_WIDENING':
    case 'VALUES_WEAKENING':
    case 'REVERSIBILITY_WIDENING': return 'aps_authority_not_narrowed'
    case 'ROOT_UNTRUSTED': return 'aps_root_untrusted'
    case undefined: return `aps_chain_${state}`
    default: return `aps_chain_${state}_${code.toLowerCase()}`
  }
}
