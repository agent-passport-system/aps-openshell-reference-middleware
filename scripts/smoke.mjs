// Standalone middleware smoke test: no OpenShell, no relay. Calls Describe and
// EvaluateHttpRequest directly over gRPC against the running middleware process
// to confirm the contract shape and the allow/deny answers.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import { REPO, buildStateDir, writeRevocations } from './state.mjs'

const stateDir = '/tmp/aps-mw-smoke-state'
buildStateDir(stateDir, { chain: 'valid', revocations: 'none' })

const child = spawn(process.execPath, [join(REPO, 'src', 'server.mjs')], {
  env: { ...process.env, APS_MW_STATE: stateDir },
  stdio: ['ignore', 'pipe', 'inherit'],
})
const port = await new Promise((resolve, reject) => {
  let buf = ''
  child.stdout.on('data', chunk => {
    buf += chunk
    const m = /LISTENING (\d+)/.exec(buf)
    if (m) resolve(Number(m[1]))
  })
  child.on('exit', code => reject(new Error(`middleware exited ${code}`)))
})

const def = protoLoader.loadSync('supervisor_middleware.proto', {
  includeDirs: [join(REPO, 'proto')],
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
})
const { SupervisorMiddleware } = grpc.loadPackageDefinition(def).openshell.middleware.v1
const client = new SupervisorMiddleware(`127.0.0.1:${port}`, grpc.credentials.createInsecure())
const call = (method, payload) => new Promise((res, rej) =>
  client[method](payload, (e, r) => (e ? rej(e) : res(r))))

let failures = 0
const check = (label, got, want) => {
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (want ${want})`}`)
}

const m = await call('Describe', { gateway: { protocol_version: { major: 1, minor: 0 } } })
check('Describe binding operation', m.bindings[0].operation, 'SUPERVISOR_MIDDLEWARE_OPERATION_HTTP_REQUEST')
check('Describe binding phase', m.bindings[0].phase, 'SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS')
check('Describe protocol major', m.extension.protocol_version.major, 1)

const evaluate = (sandboxId, headers = []) => call('EvaluateHttpRequest', {
  phase: 'SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS',
  context: { request_id: 'smoke-1', sandbox_id: sandboxId, sandbox: 'smoke', workspace: 'ws' },
  target: { scheme: 'http', host: 'api.example.test', port: 8080, method: 'GET', path: '/v1/messages', query: '' },
  headers,
  body: Buffer.alloc(0),
  middleware_name: 'aps-authority',
})

const SBX = 'sbx-aps-case-a-child'
let r = await evaluate(SBX)
check('valid chain, nothing revoked', r.decision, 'DECISION_ALLOW')

r = await evaluate('sbx-not-in-mapping')
check('unmapped sandbox_id', r.decision, 'DECISION_DENY')
check('unmapped reason_code', r.reason_code, 'aps_unknown_sandbox')

r = await evaluate(SBX, [{ name: 'upgrade', value: 'websocket' }])
check('upgrade header', r.reason_code, 'aps_upgrade_not_permitted')

writeRevocations(stateDir, 'parent-grant-revoked')
r = await evaluate(SBX)
check('ancestor revoked, same process', r.decision, 'DECISION_DENY')
check('ancestor revoked reason_code', r.reason_code, 'aps_authority_revoked')

writeRevocations(stateDir, 'none')
r = await evaluate(SBX)
check('back to active without restart', r.decision, 'DECISION_ALLOW')

writeRevocations(stateDir, 'malformed')
r = await evaluate(SBX)
check('malformed revocation state', r.reason_code, 'aps_revocation_unknown')

writeRevocations(stateDir, 'stale', false)
r = await evaluate(SBX)
check('stale revocation state', r.reason_code, 'aps_revocation_unknown')

child.kill('SIGTERM')
console.log(failures === 0 ? '\nsmoke: all checks passed' : `\nsmoke: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
