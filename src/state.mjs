// Operator-owned state the middleware loads per request.
//
// Every read here happens again for every evaluated request. Nothing is cached
// across requests: a revocation that lands between two requests of the same
// session must change the second request's answer.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export class Unresolved extends Error {
  constructor(what, why) {
    super(`${what}: ${why}`)
    this.what = what
    this.why = why
  }
}

function readJson(path, what) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Unresolved(what, `unreadable (${error.code ?? error.message})`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Unresolved(what, 'malformed JSON')
  }
}

/** Operator-owned sandbox_id -> APS agent_id association.
 *
 *  This is a configured association, not a cryptographic binding. */
export function resolveAgentId(stateDir, sandboxId) {
  const mapping = readJson(join(stateDir, 'mapping.json'), 'sandbox mapping')
  const sandboxes = mapping?.sandboxes
  if (sandboxes === null || typeof sandboxes !== 'object') {
    throw new Unresolved('sandbox mapping', 'no sandboxes object')
  }
  if (typeof sandboxId !== 'string' || sandboxId.length === 0) {
    return null
  }
  const agentId = sandboxes[sandboxId]
  return typeof agentId === 'string' && agentId.length > 0 ? agentId : null
}

export function loadChain(stateDir, agentId) {
  const loaded = readJson(join(stateDir, 'chain.json'), 'delegation chain')
  if (loaded?.agent_id !== agentId) {
    throw new Unresolved('delegation chain', `chain is for ${loaded?.agent_id ?? 'no agent'}, not ${agentId}`)
  }
  if (!Array.isArray(loaded.chain) || loaded.chain.length === 0) {
    throw new Unresolved('delegation chain', 'chain is not a non-empty array')
  }
  return loaded.chain
}

export function loadTrustAnchors(stateDir) {
  const anchors = readJson(join(stateDir, 'trust-anchors.json'), 'trust anchors')
  if (!Array.isArray(anchors?.roots) || anchors.keys === null || typeof anchors.keys !== 'object') {
    throw new Unresolved('trust anchors', 'missing roots array or keys object')
  }
  return anchors
}

/** Revocation state, with the middleware's own local freshness rule applied.
 *
 *  The freshness bound is middleware policy. It is not an APS verifier claim.
 *  A file that is missing, unreadable, malformed, or stamped outside the bound
 *  yields an unresolved revocation answer, which is distinct from "revoked". */
export function loadRevocationState(stateDir, nowMs, maxAgeMs) {
  const state = readJson(join(stateDir, 'revocations.json'), 'revocation state')
  const generatedAt = state?.generated_at
  if (typeof generatedAt !== 'string') {
    throw new Unresolved('revocation state', 'no generated_at')
  }
  const stampedMs = Date.parse(generatedAt)
  if (Number.isNaN(stampedMs)) {
    throw new Unresolved('revocation state', 'generated_at is not a parseable instant')
  }
  const ageMs = nowMs - stampedMs
  if (ageMs > maxAgeMs) {
    throw new Unresolved(
      'revocation state',
      `stamped ${ageMs}ms ago, outside the middleware freshness bound of ${maxAgeMs}ms`,
    )
  }
  if (ageMs < -maxAgeMs) {
    throw new Unresolved('revocation state', `stamped ${-ageMs}ms in the future`)
  }
  const ids = state.revoked_delegation_ids
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
    throw new Unresolved('revocation state', 'revoked_delegation_ids is not an array of strings')
  }
  return new Set(ids)
}
