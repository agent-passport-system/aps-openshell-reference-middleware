// APS OpenShell reference enforcement middleware.
//
// A gRPC service implementing OpenShell's supervisor middleware contract
// (proto/supervisor_middleware.proto, vendored from OpenShell ba16b9f). It runs
// as its own OS process. OpenShell's supervisor connects to it through the
// gateway's external middleware client path and calls EvaluateHttpRequest for
// every outbound HTTP request that traverses the middleware boundary.

import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'

import { evaluateRequest } from './evaluate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROTO_DIR = join(HERE, '..', 'proto')

const IMPLEMENTATION_NAME = 'aeoess/aps-openshell-reference-enforcement-middleware'
const IMPLEMENTATION_VERSION = '0.1.0'
const CONTRACT_CAPABILITY = 'openshell.supervisor-middleware.contract'
// Must not exceed what the registration configures, and must be non-zero.
const BINDING_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

const stateDir = requiredEnv('APS_MW_STATE')
const revocationMaxAgeMs = Number(process.env.APS_MW_REVOCATION_MAX_AGE_MS ?? 300000)
const decisionLog = process.env.APS_MW_DECISION_LOG ?? null
const port = Number(process.env.APS_MW_PORT ?? 0)

function requiredEnv(name) {
  const value = process.env[name]
  if (value === undefined || value === '') {
    console.error(`${name} is required`)
    process.exit(2)
  }
  return value
}

const packageDefinition = protoLoader.loadSync('supervisor_middleware.proto', {
  includeDirs: [PROTO_DIR],
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})
const loaded = grpc.loadPackageDefinition(packageDefinition)
const middlewareProto = loaded.openshell.middleware.v1

function manifest() {
  return {
    name: IMPLEMENTATION_NAME,
    service_version: IMPLEMENTATION_VERSION,
    bindings: [
      {
        operation: 'SUPERVISOR_MIDDLEWARE_OPERATION_HTTP_REQUEST',
        phase: 'SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS',
        max_payload_bytes: BINDING_MAX_PAYLOAD_BYTES,
        request_timeout: { seconds: '10', nanos: 0 },
      },
    ],
    // Empty skips OpenShell's post-authentication audience consistency check.
    // This deployment posture uses a plaintext local endpoint with no bearer.
    expected_audience: '',
    extension: {
      protocol_version: { major: 1, minor: 0 },
      implementation_name: IMPLEMENTATION_NAME,
      implementation_version: IMPLEMENTATION_VERSION,
      supported_capabilities: [CONTRACT_CAPABILITY],
      required_capabilities: [CONTRACT_CAPABILITY],
    },
  }
}

function recordDecision(entry) {
  if (decisionLog === null) return
  try {
    appendFileSync(decisionLog, JSON.stringify(entry) + '\n')
  } catch {
    // A diagnostic write failure never changes a decision.
  }
}

const service = {
  Describe(_call, callback) {
    callback(null, manifest())
  },

  ValidateConfig(call, callback) {
    // This middleware takes no policy-supplied configuration. Any config object
    // is accepted and ignored; nothing in it can affect a decision.
    callback(null, { valid: true, reason: '' })
  },

  EvaluateHttpRequest(call, callback) {
    const startedNs = process.hrtime.bigint()
    const request = call.request
    // The supervisor-supplied sandbox identity. proto/supervisor_middleware.proto
    // :590-594 requires consumers to use sandbox_id, not the display name, for
    // authorization and identity.
    const sandboxId = request?.context?.sandbox_id ?? ''
    const headers = Array.isArray(request?.headers)
      ? request.headers.map(h => ({ name: String(h.name ?? '').toLowerCase(), value: String(h.value ?? '') }))
      : []

    let outcome
    try {
      outcome = evaluateRequest({
        sandboxId,
        headers,
        stateDir,
        nowMs: Date.now(),
        revocationMaxAgeMs,
      })
    } catch (error) {
      // Any exception denies.
      outcome = {
        decision: 'deny',
        reasonCode: 'aps_evaluation_error',
        detail: `unexpected error: ${error?.message ?? error}`,
      }
    }

    const elapsedUs = Number(process.hrtime.bigint() - startedNs) / 1000
    recordDecision({
      request_id: request?.context?.request_id ?? '',
      sandbox_id: sandboxId,
      method: request?.target?.method ?? '',
      path: request?.target?.path ?? '',
      decision: outcome.decision,
      reason_code: outcome.reasonCode ?? '',
      aps_state: outcome.apsState ?? '',
      aps_code: outcome.apsCode ?? '',
      revocation_unresolved: outcome.revocationUnresolved ?? null,
      detail: outcome.detail ?? '',
      decision_us: elapsedUs,
    })

    callback(null, {
      decision: outcome.decision === 'allow' ? 'DECISION_ALLOW' : 'DECISION_DENY',
      reason: outcome.detail ?? '',
      body: Buffer.alloc(0),
      has_body: false,
      header_mutations: [],
      findings: [],
      metadata: {},
      reason_code: outcome.decision === 'allow' ? '' : outcome.reasonCode,
    })
  },

  EvaluateWebSocketSession(call) {
    // Not bound. The manifest declares only HTTP_REQUEST/PRE_CREDENTIALS, so
    // OpenShell never selects this middleware for a WebSocket message stage.
    call.end()
  },
}

const server = new grpc.Server()
server.addService(middlewareProto.SupervisorMiddleware.service, service)
server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
  if (error) {
    console.error(`bind failed: ${error.message}`)
    process.exit(1)
  }
  // The harness reads this line to learn the endpoint.
  console.log(`LISTENING ${boundPort}`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.forceShutdown())
}
