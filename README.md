# APS OpenShell reference enforcement middleware

Local only. Never published, never pushed. Nothing here has been offered to NVIDIA/OpenShell,
and this is not an OpenShell integration or a supported integration.

## The claim

> For outbound HTTP requests that traverse the OpenShell supervisor middleware boundary, APS re-evaluates the
> current delegated authority associated with the requesting sandbox and denies before upstream dispatch when an
> ancestor delegation has been revoked.

That is the whole claim. "Revoked" only, not "revoked or narrowed": at the pinned APS SDK commit there is no
public API that resolves a currently narrower ancestor authority for an already-issued descendant chain. The
only `v2/authority-delegation` symbols exported from the package root are the canonical sign/verify pair,
`parseAuthorityDelegationJson`, `verifyAuthorityDelegationChain`, and types. `compareAuthority` is not a root
export. APS authority records are immutable, and reauthorization creates new authority rather than re-parenting
an existing child chain.

## Pins

| Thing | Value |
|---|---|
| OpenShell | `ba16b9f2c7c59899532628ffa6cd26d37bffd477` |
| APS SDK `agent-passport-system` | `809be18c22cbd4a709dfaef556bc974459502383` (version 7.0.0, working tree clean) |
| node | v24.11.1 |
| npm | 11.6.2 |
| cargo | 1.95.0 (f2d3ce0bd 2026-03-21) |
| rustc | 1.95.0 (59807616e 2026-04-14) |

The APS SDK is a local path dependency (`file:../agent-passport-system`). It is not modified by this repo.
`verifyAuthorityDelegationChain` is imported from the public package root in `src/evaluate.mjs`:

```js
import { verifyAuthorityDelegationChain } from 'agent-passport-system'
```

That resolves to `dist/src/index.js` through the package's own `exports` map, and the root export was confirmed
to work from the installed package artifact before any product code was written.

## Enforcement point

The tested path is `relay_with_inspection` -> `relay_rest`. The harness drives `relay_with_inspection`
(`crates/openshell-supervisor-network/src/l7/relay.rs:853`), which dispatches `L7Protocol::Rest` to `relay_rest`
(`relay.rs:1830`) at `relay.rs:877`. Inside `relay_rest`, at `ba16b9f`: the external middleware chain apply is
`relay.rs:1988`, a denial returns at `:2017`, and the upstream write is at `:2088`. The middleware is a separate
OS process reached over OpenShell's own external gRPC middleware client path: the registry is built by
`MiddlewareRegistry::connect_services` and installed with the public `OpaEngine::replace_middleware_registry`.

The `relay_with_route_selection` path (`relay.rs:923`) is not exercised by any test here, and whether it enforces
the same way is UNKNOWN.

## Identity

The requester is identified only by `RequestContext.sandbox_id`, which the supervisor supplies from its
process-wide OCSF event context. `proto/supervisor_middleware.proto:590-594` requires consumers to use
`sandbox_id` rather than the display name for authorization and identity. That id is mapped to an APS `agent_id`
through an operator-owned mapping file. No request header, body byte, or other agent-controlled content is ever
used as the authorization identity.

**This is an operator-configured `sandbox_id -> APS agent_id` association, not a cryptographic binding between
an OpenShell sandbox and an APS agent.** Nothing in this build establishes such a binding. A sandbox that could
cause the supervisor to report a different `sandbox_id` would be mapped to a different agent, and nothing here
detects that.

## What is established

Each row is a test that ran through the real relay. Every deny case asserts on the harness's own post-denial
read of the upstream pipe, described under "Zero upstream bytes" below.

| Case | Test | Result |
|---|---|---|
| P1 GREEN: valid chain, child's GET reaches upstream exactly once, response relayed | `aps_middleware_allows_valid_chain_and_forwards` | 25/25 |
| P1 RED: root's grant to the parent revoked, same child, same request, 403 with the middleware denial, zero upstream bytes | `aps_middleware_denies_before_upstream` | 25/25, zero upstream bytes 25/25 |
| P2-1 static monotonic narrowing: child requests authority outside the signed parent authority | `aps_middleware_denies_before_upstream` (chain `widened`) | 10/10, APS `SCOPE_WIDENING` |
| P2-2a revocation state missing | `aps_middleware_denies_before_upstream` | 10/10, APS `REVOCATION_UNKNOWN` |
| P2-2b revocation state unreadable | same | 10/10, APS `REVOCATION_UNKNOWN` |
| P2-2c revocation state malformed | same | 10/10, APS `REVOCATION_UNKNOWN` |
| P2-2d revocation state outside the middleware's local freshness rule | same | 10/10, APS `REVOCATION_UNKNOWN` |
| P2-3 expired link in the chain | same (chain `expired`) | 10/10, APS `EXPIRED` |
| P2-4a tampered chain, one byte changed in a signed field | same (chain `tampered`) | 10/10, APS `ID_MISMATCH` |
| P2-4b wrong signature, child signed by a key that is not the issuer | same (chain `wrong-signature`) | 10/10, APS `SIGNATURE_INVALID` |
| P2-5 middleware registered, one request allowed, process killed, next request observed | `aps_middleware_registered_but_unreachable_denies_before_upstream` | 10/10 |
| P2-6 WebSocket upgrade request reaches the middleware and is denied before upstream | `aps_middleware_denies_upgrade_request_before_upstream` | 10/10 |
| P2-6 control: with the refusal off, the same upgrade request does reach upstream | `aps_upgrade_reaches_upstream_when_middleware_allows_it` | 10/10 |
| P2-7 revocation between two requests of the same session: first allowed, revoke, second denied | `aps_middleware_denies_second_request_after_revocation` | 10/10 |
| P2-8 middleware decision latency over 200 allowed requests | `aps_middleware_latency_over_allowed_requests` | median 830 us, p95 978 us |

Latency is as measured on this machine by the middleware process itself, and is not a claim about any other
machine or deployment.

"Zero upstream bytes" comes from one observation and one only: a single 200 ms read of the upstream pipe, made
by the harness after the client already has the denial response. The harness prints what that read returned as
`APS_UPSTREAM_BYTES_AFTER_DENY=<n>` before it asserts on it, and both runners parse that line, so a run where the
observation did not happen fails rather than reading as a zero. The number is what the one read returned, capped
by a 32-byte buffer, so it separates zero from nonzero rather than counting a whole forward.

What that proves: zero HTTP request or application bytes reached the upstream inside that window. What it does
not touch: whether a TCP connection was created, which no test here proves, and a forward that arrived later than
200 ms, which this observation would not catch and which no test here drives.

Two named results worth stating exactly:

- **P2-2 keeps `unknown` distinct from `revoked`.** An unresolved revocation answer is recorded as
  `aps_state=indeterminate`, `aps_code=REVOCATION_UNKNOWN`, with the reason it could not be resolved. An actually
  revoked ancestor is `aps_state=invalid`, `aps_code=REVOKED`. The freshness bound is middleware policy, not an
  APS verifier claim.
- **P2-5 records observed behavior, not assumed behavior.** After the middleware process was killed, the next
  request returned `403 Forbidden` with `{"error":"middleware_failed", ...}` and zero upstream bytes. This is
  "registered but unreachable", which is a request-time deny. It is not the same thing as "never registered":
  `crates/openshell-supervisor-network/src/host.rs:91-96` refuses to start the host proxy at all when
  `network_middlewares` is configured without a middleware service registry, which is a startup refusal.

## What is NOT established

- **DNS.** Mediated by the supervisor and governed by policy, never by an extension. Middleware operations are
  HTTP request, HTTP response, and outgoing WebSocket text only. Nothing here touches DNS.
- **Control plane RPCs outside the 24 interceptable ones.** `crates/openshell-gateway-interceptors/src/routes.rs`
  lists 24 interceptable methods against 82 RPCs in `proto/openshell.proto`. This build does not use the gateway
  interceptor surface at all.
- **Server-to-agent traffic and response bodies the middleware cannot inspect.** Server-to-agent WebSocket
  messages, and compressed, partial, or `Cache-Control: no-transform` response bodies, are documented
  limitations of the supervisor middleware contract.
- **Any traffic that does not traverse the HTTP middleware.** Specifically, and not as a generic line: transparent
  TCP (`crates/openshell-supervisor-network/src/proxy.rs:1212-1219`), `tls: skip` tunnels (`proxy.rs:2959-2985`),
  h2c prior knowledge (`proxy.rs:1670-1704`), and SQL L7 passthrough (`relay.rs:885-908`) are **denied by
  `UninspectableTrafficGate` under a fail-closed chain**, not inspected by this middleware. The denial is
  OpenShell's, not APS's. This build does not test those paths.
- **Non-WebSocket upgrades.** The upgrade refusal detects an RFC 6455 handshake from `Sec-WebSocket-Key` and
  `Sec-WebSocket-Version`, because OpenShell omits `Upgrade` and `Connection` from what a middleware sees:
  `safe_middleware_headers` (`crates/openshell-supervisor-network/src/l7/middleware.rs:828`, called on the
  request path at `:616`) builds the middleware-visible header list and its filter drops `connection` at `:857`
  and `upgrade` at `:862`. The same stage hands the HTTP request a hardcoded `"https"` scheme
  (`middleware.rs:524`). A non-WebSocket upgrade carries no `Sec-WebSocket-*` header and this middleware cannot
  see it at all. Separately, h2c upgrade
  requests are refused by OpenShell with 403 regardless of enforcement mode
  (`crates/openshell-supervisor-network/src/l7/rest.rs:2445-2456`).
- **Later narrowing of an ancestor's authority.** P2-1 establishes chain narrowing: a child that requests
  authority outside its signed parent authority is rejected. It does not establish that a *later* replacement of
  an ancestor's authority with a narrower one is detected, and nothing here models that by substituting a newly
  issued parent into an existing child chain.
- **Behavior inside a real sandbox.** Not run. P4 was skipped: no container runtime is present on this machine
  and none was installed, per the job's rules. `docker`, `podman` and `colima` are all absent, and OpenShell's VM
  driver is Linux only. Every result above comes from OpenShell's own relay code driven over in-memory duplex
  pipes, not from a booted sandbox with its outer network fence in place.
- **That `include: ["**"]` attaches to every destination in a running policy.** At the matcher level `**` matches
  every valid host (`cargo test -p openshell-core --lib host_pattern`, 6 of 6 including
  `universal_wildcard_matches_any_host`). That proves the matcher. The tests here prove attachment only for the
  one destination they use, `api.example.test:8080`.
- **Production use.** This is a reference implementation behind a claim, with test-only keys committed on
  purpose. It is not hardened, not reviewed by anyone else, and not fit to deploy.
- **Maintainer acceptance, a non-APS implementation, or an enterprise pilot.** None of those is touched by
  anything here.

## The HARNESS PATCH

`harness/openshell-harness.patch`. A 494-line pure insertion into
`crates/openshell-supervisor-network/src/l7/relay.rs` inside its existing `#[cfg(test)] mod tests`, on a local
OpenShell branch `aps-harness`. No deletions, no modifications, one file, test code only.

It is needed because `L7EvalContext` derives `Default` only under `cfg(test)` and carries `pub(crate)` fields, so
it cannot be constructed from outside the crate. Everything else on the path is public. The patch reuses the
shape of the plumbing OpenShell already has for external middleware registrations at `relay.rs:4479` and the
zero-upstream-bytes assertion at `relay.rs:5966`. It does not reimplement relay or middleware enforcement
behavior, does not replace the middleware runner with a fake, and does not bypass the external service registry
or client path.

This is not an OpenShell change and must never be described as one.

## Layout

```
DESIGN.md      the integration contract found at the pin, and the harness design
EVIDENCE.md    verbatim commands, exit codes and output for G0, G1 and every P2 case
RUN-LOG.md     one line per phase, gate result, and surprise
proto/         supervisor_middleware.proto and extension.proto, vendored from OpenShell ba16b9f
src/           the middleware: gRPC server, APS evaluation, state loading
fixtures/      TEST ONLY keys, chains and revocation states, with a self-checking generator
harness/       the HARNESS PATCH
scripts/       the runners: G1, the P2 suite, a standalone gRPC smoke test
vector/        two CANDIDATE artifacts, neither added to the conformance lab repo
evidence/      captured run output
```

## Running it

```sh
npm install
node fixtures/generate.mjs      # regenerate fixtures, reusing the committed keys
node scripts/smoke.mjs          # middleware only, no OpenShell
node scripts/run-g1.mjs         # G1: 25 GREEN + 25 RED through the real relay
node scripts/run-p2.mjs         # P2: 12 cases, 10 passes, plus the latency case
node vector/verify.mjs          # the neutral vector, no OpenShell and no middleware
```

The relay runners need an OpenShell checkout at `ba16b9f` with the harness patch applied. Default location
`/tmp/aps-os/openshell`, override with `APS_OPENSHELL_DIR`.
