# DESIGN: APS OpenShell reference enforcement middleware (Case A)

Pins. OpenShell `ba16b9f2c7c59899532628ffa6cd26d37bffd477` (clone at `/tmp/aps-os/openshell`, `git rev-parse HEAD` exit 0).
APS SDK `agent-passport-system` `809be18c22cbd4a709dfaef556bc974459502383`, working tree clean. node v24.11.1, npm 11.6.2,
cargo 1.95.0, rustc 1.95.0.

## The claim this build exists to establish

> For outbound HTTP requests that traverse the OpenShell supervisor middleware boundary, APS re-evaluates the
> current delegated authority associated with the requesting sandbox and denies before upstream dispatch when an
> ancestor delegation has been revoked.

"Revoked" only. P0 searched for a public APS API that independently resolves a currently narrower ancestor
authority for an already-issued descendant chain and found none: at `809be18c`, the only
`v2/authority-delegation` symbols exported from the package root (`src/index.ts`) are the canonical
sign/verify pair (`:2142`), `parseAuthorityDelegationJson` (`:2143`), `verifyAuthorityDelegationChain`
(`:2147`) and types (`:2157`). `compareAuthority` is not exported from the root (`grep -n compareAuthority
src/index.ts` returns nothing). There is no `resolveAuthority`, `currentAuthority`, `effectiveAuthority` or
equivalent. The claim stays at "revoked".

## The integration contract found at the pin

An external supervisor middleware is a gRPC service the operator registers in gateway TOML
(`[[openshell.supervisor.middleware]]`, `docs/extensibility/supervisor-middleware/configure.mdx`), then
attaches per destination in sandbox policy under `network_middlewares`. Registration fields come from
`SupervisorMiddlewareService` (`proto/sandbox.proto:452-477`): `name`, `grpc_endpoint` (must be `http://` or
`https://`, `crates/openshell-supervisor-middleware/src/lib.rs:794-801`), `max_payload_bytes`,
`request_timeout` (10ms to 30s, default 500ms, `lib.rs:936-952`), `tls_ca_cert_pem`, `audience`, and
`allow_insecure_transport`.

Service contract: `service SupervisorMiddleware` (`proto/supervisor_middleware.proto:15-35`) with
`Describe`, `ValidateConfig`, `EvaluateHttpRequest`, `EvaluateWebSocketSession`. Case A needs the first three.
The manifest must declare at least one binding (`lib.rs:904-906`); the HTTP request stage requires
`SUPERVISOR_MIDDLEWARE_OPERATION_HTTP_REQUEST` at `SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS`
(`lib.rs:870-878`), a non-zero `max_payload_bytes` no smaller than the registration's (`lib.rs:850-861`,
`:921-931`), and `PeerMetadata` with protocol 1.0 plus the capability
`openshell.supervisor-middleware.contract` in both `supported_capabilities` and `required_capabilities`
(`crates/openshell-core/src/extension_protocol.rs:12-13`, `:40-42`, `:104-116`, `:140`).

Request context a middleware receives: `HttpRequestEvaluation`
(`proto/supervisor_middleware.proto:108-129`) carrying `phase`, `RequestContext`, validated `config`,
`HttpRequestTarget` (scheme, host, port, method, path, query), headers in wire order with credential,
routing, framing and hop-by-hop headers omitted, the buffered body, and `middleware_name`.

Decisions: `Decision` is `DECISION_ALLOW` or `DECISION_DENY`, and `DECISION_UNSPECIFIED` is "handled
according to the policy failure mode" (`:626-637`). `HttpRequestResult` (`:687-720`) carries the decision,
a free-form `reason` OpenShell never relays, optional body and header mutations, findings, metadata, and a
`reason_code` that OpenShell *may* return to the requester.

`on_error: fail_closed` (the default, `docs/.../schema.mdx:545`) means a middleware that cannot be
evaluated blocks the request. It also drives `UninspectableTrafficGate`
(`crates/openshell-supervisor-network/src/l7/middleware.rs:119-129`): with at least one fail-closed entry
matching, traffic the chain can never inspect is denied rather than passed.

External diagnostics are normalized: for an operator-run service OpenShell overwrites `reason` and clears
`metadata` (`lib.rs:1001-1028`, `:704-712`) but leaves `reason_code` intact, and the client-visible deny body
includes `error: "middleware_denied"`, `middleware: <config name>` and `reason_code`
(`crates/openshell-supervisor-network/src/l7/rest.rs:2909-2946`).

## Enforcement point

The tested path is `relay_with_inspection` -> `relay_rest`. The harness drives `relay_with_inspection`
(`crates/openshell-supervisor-network/src/l7/relay.rs:853`), which dispatches `L7Protocol::Rest` to `relay_rest`
(`:1830`) at `:877`. Inside `relay_rest`: the external middleware chain apply is
`apply_middleware_chain_with_request_id` at `:1988`, a deny returns at `:2017` after
`send_middleware_rejection_response` at `:2009`, and the upstream write is
`relay_http_request_with_credential_rejection` at `:2088`. All re-verified at `ba16b9f`.

`relay_with_route_selection` (`:923`) is a different relay path. It contains its own chain apply, deny return and
upstream write (`:1208`, `:1240`, `:1305`), which earlier drafts of these artifacts cited by mistake. No test
here executes it, so whether it enforces the same way is UNKNOWN.

## Identity: operator-configured mapping, not a cryptographic binding

`RequestContext.sandbox_id` (`proto/supervisor_middleware.proto:586-587`) is the supervisor-supplied
identity. The proto is explicit that it is the authorization key: names "may be reused for different sandbox
instances, so consumers must use sandbox_id for authorization, persistence, durable correlation, and
identity" (`:590-594`).

Where it comes from: the relay reads the supervisor's process-wide OCSF event context,
`openshell_ocsf::ctx::ctx()`, and copies `sandbox_id` into `HttpRequestInput`
(`crates/openshell-supervisor-network/src/l7/middleware.rs:704-729`, field at `:717`), which becomes
`RequestContext` in `ChainRunner::evaluate_described_with_policy_admitted`
(`crates/openshell-supervisor-middleware/src/lib.rs:1705-1711`). The context is a process-wide `OnceLock`
set once at sandbox start via the public `openshell_ocsf::ctx::set_ctx`
(`crates/openshell-ocsf/src/ctx.rs:14`, `:31-33`), falling back to an empty `sandbox_id` when unset
(`:16-25`, `:40-42`).

The middleware maps that `sandbox_id` to an APS `agent_id` through an operator-owned mapping file, and
loads that agent's delegation chain by the mapped `agent_id`. No request header, body byte or other
agent-controlled content is ever used as the authorization identity.

**Stated plainly: this job does not establish a cryptographic binding between an OpenShell sandbox and an APS
agent.** It establishes enforcement for an operator-configured `sandbox_id -> APS agent_id` association. A
sandbox that can cause the supervisor to report a different `sandbox_id` would be mapped to a different
agent, and nothing here detects that.

## Where chain and revocation state live

Files the middleware loads from a state directory, keyed by the mapped `agent_id`:

- `mapping.json`: `sandbox_id -> agent_id`. Operator-owned.
- `chains/<agent_id>.json`: the root-to-leaf delegation chain for that agent.
- `revocations.json`: revocation state plus a `generated_at` timestamp.
- `trust-anchors.json`: accepted root subjects and their verification keys.

Every evaluated request re-reads `revocations.json` and the chain from disk. No startup snapshot is reused.
A missing, unreadable, malformed, or stale (outside the middleware's local freshness rule) revocation file is
an **unresolved** revocation answer and denies, recorded as `unknown`, kept distinct from `revoked`. The
freshness bound is middleware policy, not an APS verifier claim.

APS call: `verifyAuthorityDelegationChain(chain, { now, trustRoot, resolveVerificationKey,
resolveRevocation })` (`src/v2/authority-delegation/verify.ts:118-121`, options at
`src/v2/authority-delegation/types.ts:171-176`), imported from the package root. It returns `valid`,
`invalid`, `indeterminate` or `unsupported`. Revoked ancestor gives `invalid` / `REVOKED`
(`verify.ts:285-287`); an unresolvable revocation answer gives `indeterminate` / `REVOCATION_UNKNOWN`
(`:288-290`); a child widening its parent gives `invalid` from `compareAuthority` at `:259`. Only `valid`
allows. Everything else, and any exception, denies.

## Test harness

A unit test inside `crates/openshell-supervisor-network/src/l7/relay.rs`'s own `mod tests`, on a local
OpenShell branch `aps-harness`, saved as `harness/openshell-harness.patch`. It reuses, unchanged in shape,
the plumbing OpenShell already has for external middleware registrations at `relay.rs:4479-4560`:

1. Spawn the TypeScript middleware as a separate OS process (`node`), and wait for it to print its port.
2. Build the registry with the real external client path:
   `MiddlewareRegistry::connect_services(Vec::new(), vec![SupervisorMiddlewareService { name, grpc_endpoint:
   "http://127.0.0.1:<port>", .. }])` (`lib.rs:1107`). This performs a real `Describe` over tonic against the
   Node process, validates the manifest, and negotiates the protocol.
3. Install it with the public `OpaEngine::replace_middleware_registry`
   (`crates/openshell-supervisor-network/src/opa.rs:868`), then capture the endpoint config and tunnel engine.
4. Drive the real relay: `relay_with_inspection` (`relay.rs:853`) over `tokio::io::duplex` pipes, the same
   pattern as `audit_endpoint_still_enforces_middleware_deny` (`relay.rs:5922`), whose zero-bytes assertion at
   `:5966-5969` is the model for ours.
5. Policy: one `network_middlewares` entry, `on_error: fail_closed`, `endpoints.include: ["**"]`, against a
   `rest` endpoint that allows the request at L7 so the only denial source is the middleware.

Why a harness patch rather than an out-of-crate test: `L7EvalContext` (`relay.rs:43`) derives `Default` only
under `cfg(test)` (`:42`) and has `pub(crate)` fields (`:52`, `:62`, `:64-83`), so it cannot be constructed
from outside the crate. Everything else on the path is public. The patch adds test code only. It does not
reimplement relay or middleware enforcement behavior, does not replace the middleware runner with a fake, and
does not bypass the external service registry or client path.

`include: ["**"]` at the matcher level matches every valid host: `cargo test -p openshell-core --lib
host_pattern` passes 6 of 6 including `universal_wildcard_matches_any_host`
(`crates/openshell-core/src/host_pattern.rs:314-333`). That proves the matcher. Whether `["**"]` attaches to
every destination in a running policy is UNKNOWN. The GREEN test proves attachment only for the destination
it tests.
