# EVIDENCE

Every claim below quotes the command, its own exit code read directly rather than through a pipe, and the
relevant output. Bounded reads are marked. Captured run output is under `evidence/`.

Pins: OpenShell `ba16b9f2c7c59899532628ffa6cd26d37bffd477`, APS SDK
`809be18c22cbd4a709dfaef556bc974459502383`. node v24.11.1, npm 11.6.2, cargo 1.95.0, rustc 1.95.0.

---

## Pre-flight

**Signing.** `commit.gpgsign` is on globally, so a throwaway signed commit was made in `/tmp/aps-sign-preflight`
before any real work.

```
$ git commit -s -q -m "preflight: signing check"   # exit 0
$ git log --format='%G?'
G
$ git log --format='%GS %GK'
Tymofii Pidlisnyi <signal@aeoess.com> DB1325FDC6E6DCBB
$ git log --format=%B | grep -iE 'anthropic|co-authored-by: *claude'   # exit 1, no match
```

**No container runtime.** `which docker podman colima` printed `docker not found`, `podman not found`,
`colima not found`. Nothing was installed.

---

## GATE G0

G0 is a reading gate. It asks whether a test can drive OpenShell's real relay with the TypeScript middleware as
a separate OS process over OpenShell's actual external gRPC middleware client path, and whether a stable
supervisor-supplied sandbox identity reaches it. Both were then demonstrated in P1, not left as inference.

### Checkout at the pin

```
$ git fetch --depth 1 origin ba16b9f2c7c59899532628ffa6cd26d37bffd477
From https://github.com/NVIDIA/OpenShell
 * branch            ba16b9f2c7c59899532628ffa6cd26d37bffd477 -> FETCH_HEAD
$ git checkout -q FETCH_HEAD && git rev-parse HEAD
ba16b9f2c7c59899532628ffa6cd26d37bffd477
EXIT=0
```

### Chat-sourced facts re-verified at the pin

| Claim from chat | Verified | How |
|---|---|---|
| External middleware chain applies at `relay.rs:1208` | the line is what chat said, but it is on a path no test here runs | `:1208` is `apply_middleware_chain_with_request_id(`, inside `relay_with_route_selection` (`:923`). The tested path is `relay_with_inspection` -> `relay_rest`, where the chain apply is `:1988`. See the erratum at the end of this file. |
| A denial returns at `relay.rs:1240` | same, same path | `:1232` `send_middleware_rejection_response`, `:1240` `return Ok(());`, both inside `relay_with_route_selection`. On the tested path the deny returns at `:2017` after `send_middleware_rejection_response` at `:2009`. |
| Upstream write at `relay.rs:1305` | same, same path | `:1305` `relay_http_request_with_credential_rejection_observed(`, inside `relay_with_route_selection`. On the tested path the upstream write is `relay_http_request_with_credential_rejection(` at `:2088`. |
| `audit_endpoint_still_enforces_middleware_deny` at `relay.rs:5922` | yes | `grep -n` returns exactly `relay.rs:5922` |
| That test asserts "upstream should not receive request bytes" | yes | `relay.rs:5966-5969`, `matches!(result, Err(_) \| Ok(Ok(0)))` |
| `middleware_relay_context_with_enforcement` exists | yes | `relay.rs:4257` |
| `RequestContext` carries `sandbox_id` | yes | `proto/supervisor_middleware.proto:586-587`, authorization guidance at `:590-594` |

`host_pattern`, run directly:

```
$ cargo test -p openshell-core --lib host_pattern
running 6 tests
test host_pattern::tests::host_matching_rejects_invalid_patterns ... ok
test host_pattern::tests::recursive_wildcard_requires_at_least_one_label ... ok
test host_pattern::tests::universal_wildcard_matches_any_host ... ok
test host_pattern::tests::selector_pattern_overlap_honors_concrete_exclusions ... ok
test host_pattern::tests::host_matching_is_case_insensitive ... ok
test host_pattern::tests::host_pattern_overlap_handles_concrete_and_wildcard_hosts ... ok
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 497 filtered out; finished in 0.00s
EXIT=0
```

This proves the matcher only. It does not prove that `include: ["**"]` attaches to every destination in a
running policy.

### The external gRPC path is reachable from a test

- `MiddlewareRegistry::connect_services(in_process, registrations)` is `pub async fn` at
  `crates/openshell-supervisor-middleware/src/lib.rs:1107`. A registration becomes
  `MiddlewareDispatch::Grpc(GrpcMiddlewareService)` at `lib.rs:1221-1229`, which calls the real tonic client
  (`src/remote.rs:37-54`), then a real `Describe` at `lib.rs:1230`, manifest validation at `:1240`, and protocol
  negotiation at `:1246`.
- `OpaEngine::replace_middleware_registry` is `pub fn` at `crates/openshell-supervisor-network/src/opa.rs:868`.
- `relay_with_inspection` is `pub async fn` at `crates/openshell-supervisor-network/src/l7/relay.rs:853`.
- A plaintext `http://` endpoint is permitted: `validate_registration` requires `http://` or `https://`
  (`lib.rs:794-801`), and `connect_channel` applies TLS only for `https://`
  (`crates/openshell-extension-core/src/transport.rs:127-135`).
- OpenShell's own relay tests already use this exact shape at `relay.rs:4479-4560`: a real `TcpListener` on
  `127.0.0.1:0`, a real `tonic::transport::Server`, and a `SupervisorMiddlewareService` registration pointed at
  it.

A harness patch is needed only because `L7EvalContext` (`relay.rs:43`) derives `Default` solely under
`cfg(test)` (`:42`) and carries `pub(crate)` fields (`:52`, `:62`, `:64-83`), so it cannot be built from outside
the crate.

### Supervisor-supplied sandbox identity

The relay copies `openshell_ocsf::ctx::ctx().sandbox_id` into `HttpRequestInput`
(`crates/openshell-supervisor-network/src/l7/middleware.rs:717`), which becomes `RequestContext.sandbox_id`
(`crates/openshell-supervisor-middleware/src/lib.rs:1705-1711`). The context is a process-wide `OnceLock` set at
sandbox start through the public `openshell_ocsf::ctx::set_ctx` (`crates/openshell-ocsf/src/ctx.rs:14`, `:31-33`).

Confirmed end to end by observation. The middleware's own record of a request that arrived through the
unmodified relay:

```json
{"request_id":"8938ffa6-d8f8-4070-ab46-73caa7836ff1","header_names":["sec-websocket-version","sec-websocket-key"],
 "scheme":"https","sandbox_id":"sbx-aps-case-a-child","method":"GET","path":"/v1/messages", ...}
```

`sandbox_id` is the value the supervisor context reports. No request content is used as identity.

### No public APS API resolves a currently narrower ancestor authority

```
$ grep -n "authority-delegation" src/index.ts
2142:} from './v2/authority-delegation/canonical.js'
2143:export { parseAuthorityDelegationJson } from './v2/authority-delegation/parse.js'
2147:export { verifyAuthorityDelegationChain } from './v2/authority-delegation/verify.js'
2157:} from './v2/authority-delegation/types.js'
$ grep -n "compareAuthority" src/index.ts     # exit 1, no match
```

So the claim stays at "revoked", and this is recorded as a separate finding rather than a claim change.

**GATE G0: PASS.**

---

## Phase P1

### The APS public root export resolves from the local package artifact

```
$ node -e "import('agent-passport-system').then(m => ...)"
verifyAuthorityDelegationChain => function
signAuthorityDelegation => function
computeAuthorityDelegationId => function
generateKeyPair => function
compareAuthority => undefined (expected undefined: not a root export)
EXIT=0
$ node --input-type=module -e "console.log(import.meta.resolve('agent-passport-system'))"
file:///<home>/agent-passport-system/dist/src/index.js
```

### Fixture self-check

```
$ node fixtures/generate.mjs
reusing the committed TEST ONLY keys (pass --rotate-keys to mint new ones)
ok    valid chain, nothing revoked: state=valid code=- (want state=valid code=-)
ok    valid chain, ancestor revoked: state=invalid code=REVOKED (want state=invalid code=REVOKED)
ok    child widens parent scope: state=invalid code=SCOPE_WIDENING (want state=invalid code=SCOPE_WIDENING)
ok    child link expired: state=invalid code=EXPIRED (want state=invalid code=EXPIRED)
ok    tampered child record: state=invalid code=ID_MISMATCH (want state=invalid code=ID_MISMATCH)
ok    child signed by wrong key: state=invalid code=SIGNATURE_INVALID (want state=invalid code=SIGNATURE_INVALID)
EXIT=0
```

Rerunning the generator changes no fixture byte, so the committed set is reproducible.

### Standalone middleware over gRPC, no OpenShell

```
$ node scripts/smoke.mjs
ok    Describe binding operation: SUPERVISOR_MIDDLEWARE_OPERATION_HTTP_REQUEST
ok    Describe binding phase: SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS
ok    Describe protocol major: 1
ok    valid chain, nothing revoked: DECISION_ALLOW
ok    unmapped sandbox_id: DECISION_DENY
ok    unmapped reason_code: aps_unknown_sandbox
ok    bare upgrade header is not the signal: DECISION_ALLOW
ok    sec-websocket-key: aps_upgrade_not_permitted
ok    sec-websocket-version: aps_upgrade_not_permitted
ok    ancestor revoked, same process: DECISION_DENY
ok    ancestor revoked reason_code: aps_authority_revoked
ok    back to active without restart: DECISION_ALLOW
ok    malformed revocation state: aps_revocation_unknown
ok    stale revocation state: aps_revocation_unknown
smoke: all checks passed
EXIT=0
```

`back to active without restart` and `ancestor revoked, same process` together show the middleware re-resolves
revocation state per request rather than caching a startup snapshot.

### A defect in the runner, found and fixed

The first GREEN attempt reported `exit=0` with `running 0 tests ... 1418 filtered out`. `cargo test` exits 0 when
a filter matches nothing, so a zero-test run would have read as a pass. The filter needed the full path
`l7::relay::tests::<name>`, and the runner now fails any run where no test was selected
(`scripts/run-case.mjs`, the `ran` and `selectedNone` fields). Every tally below is from runs that actually
selected and ran their test.

### GATE G1: 25 GREEN and 25 RED, each in a fresh process

```
$ node scripts/run-g1.mjs          # full output in evidence/g1-50-runs.txt
run  1  green exit=0 ran=true  red exit=0 ran=true zero_upstream_bytes=true
...
run 25  green exit=0 ran=true  red exit=0 ran=true zero_upstream_bytes=true

GREEN passed 25/25
RED   passed 25/25
RED runs with zero upstream bytes: 25/25
total runs: 50/50   elapsed 629.2s

GATE G1: PASS
G1_EXIT=0
```

Per-run commands, each in its own `cargo test` process with a freshly built state directory and a freshly
spawned middleware process:

```
cargo test -p openshell-supervisor-network --lib l7::relay::tests::aps_middleware_allows_valid_chain_and_forwards -- --exact --nocapture --test-threads=1
cargo test -p openshell-supervisor-network --lib l7::relay::tests::aps_middleware_denies_before_upstream -- --exact --nocapture --test-threads=1
```

The RED denial the client actually receives, captured from a deliberately mismatched assertion:

```json
{"error":"middleware_denied","detail":"Request rejected by configured middleware","policy":"rest_api",
 "middleware":"aps-authority","reason_code":"aps_authority_revoked","layer":"l7","method":"GET",
 "path":"/v1/messages","host":"api.example.test","port":8080,"binary":"/usr/bin/curl"}
```

### The RED assertions are not vacuous

`evidence/mutations.txt`. Both mutations must fail, and do.

```
--- Mutation 1: the RED test with nothing revoked ---
test l7::relay::tests::aps_middleware_denies_before_upstream ... FAILED
test result: FAILED. 0 passed; 1 failed; ...
[aps_middleware_denies_before_upstream] exit=101 ran=false ok=false

--- Mutation 2: the RED test expecting the wrong reason_code ---
test l7::relay::tests::aps_middleware_denies_before_upstream ... FAILED
  left: String("aps_authority_revoked")
 right: "aps_authority_expired"
[aps_middleware_denies_before_upstream] exit=101 ran=false ok=false

--- Control: the unmutated RED test ---
test l7::relay::tests::aps_middleware_denies_before_upstream ... ok
[aps_middleware_denies_before_upstream] exit=0 ran=true ok=true
```

**GATE G1: PASS.**

---

## Phase P2

```
$ APS_MW_P2_PASSES=10 APS_MW_LATENCY_REQUESTS=200 node scripts/run-p2.mjs
P2_EXIT=0
```

Full output in `evidence/p2-10-passes.txt`. Every pass 1 through 10 reported `ok` for all twelve cases.

```
  ok    p2-1-static-narrowing  10/10
  ok    p2-2a-revocation-missing  10/10
  ok    p2-2b-revocation-unreadable  10/10
  ok    p2-2c-revocation-malformed  10/10
  ok    p2-2d-revocation-stale  10/10
  ok    p2-3-expired-link  10/10
  ok    p2-4a-tampered  10/10
  ok    p2-4b-wrong-signature  10/10
  ok    p2-5-middleware-unreachable  10/10
  ok    p2-6-upgrade-denied  10/10
  ok    p2-6-control-upgrade-reaches-upstream  10/10
  ok    p2-7-revoked-between-requests  10/10

p2-8-latency: exit=0 ran=true allowed_decisions=200/200
  middleware decision time over 200 allowed requests, measured on this machine:
    median 847 us   p95 1014 us   min 791 us   max 4346 us

P2 SUITE: PASS (10 passes of 12 cases, plus the latency case once)
```

Each deny case is checked three ways: the harness assertion passed, no run printed
`upstream received <n> bytes`, and the middleware's own record carries the expected APS failure code.

### Case 1, static monotonic narrowing

The child requests `net:*` where its signed parent authority is `net:http:*` narrowed to `net:http:get`. APS
reports `SCOPE_WIDENING`. This establishes chain narrowing. It does not establish later replacement of an
ancestor's authority, and no fixture substitutes a newly issued parent into an existing child chain.

### Case 2, unresolved revocation stays distinct from revoked

`evidence/p2-2-unknown-vs-revoked.txt`:

```
--- missing:   decision=deny reason_code=aps_revocation_unknown aps_state=indeterminate aps_code=REVOCATION_UNKNOWN
               revocation_unresolved=revocation state: unreadable (ENOENT)
--- malformed: decision=deny reason_code=aps_revocation_unknown aps_state=indeterminate aps_code=REVOCATION_UNKNOWN
               revocation_unresolved=revocation state: malformed JSON
--- stale:     decision=deny reason_code=aps_revocation_unknown aps_state=indeterminate aps_code=REVOCATION_UNKNOWN
               revocation_unresolved=revocation state: stamped 212901191999ms ago, outside the middleware
                                     freshness bound of 300000ms

--- for contrast, an actually revoked ancestor ---
               decision=deny reason_code=aps_authority_revoked aps_state=invalid aps_code=REVOKED
               revocation_unresolved=None
```

`indeterminate` / `REVOCATION_UNKNOWN` never becomes `invalid` / `REVOKED`. The freshness bound is middleware
policy, not an APS verifier claim.

### Case 5, observed and not assumed

`evidence/p2-5-observed.txt`. The registry was built while the middleware answered `Describe`, one request was
allowed, then the process was killed and the next request observed:

```
test l7::relay::tests::aps_middleware_registered_but_unreachable_denies_before_upstream ...
aps-harness: killed middleware pid 52422
aps-harness: response after kill: HTTP/1.1 403 Forbidden
Content-Type: application/json
Content-Length: 229
X-OpenShell-Policy: rest_api
Connection: close

{"error":"middleware_failed","detail":"Request could not be processed by configured middleware",
 "policy":"rest_api","layer":"l7","method":"GET","path":"/v1/messages","host":"api.example.test",
 "port":8080,"binary":"/usr/bin/curl"}
ok
test result: ok. 1 passed; 0 failed; ...
exit=0 ran=true ok=true
```

The middleware's decision log for that run holds exactly one record, the first request's `allow`, and nothing
after the kill, because the process was gone. This is a request-time deny for a registered but unreachable
service. It is a different thing from never registered:
`crates/openshell-supervisor-network/src/host.rs:91-96` refuses to start the host proxy when
`network_middlewares` is configured without a registry, which is a startup refusal.

### Case 6, and a correction to the intended mechanism

The original design denied on an `Upgrade` header. That cannot work. The middleware allowed an upgrade request
and its record showed why:

```json
{"header_names":["sec-websocket-version","sec-websocket-key"],"scheme":"https","decision":"allow", ...}
```

OpenShell omits `Upgrade` and `Connection` from what a middleware sees: `safe_middleware_headers`
(`crates/openshell-supervisor-network/src/l7/middleware.rs:828`, called on the request path at `:616`) builds the
middleware-visible header list and its filter drops `connection` at `:857` and `upgrade` at `:862`. The same
stage hands the HTTP request a hardcoded `"https"` scheme (`middleware.rs:524`), so neither the header nor the
scheme carries the signal. `Sec-WebSocket-Key` and `Sec-WebSocket-Version` are end-to-end headers
and do arrive. The refusal keys on those, which catches an RFC 6455 handshake and does not catch a
non-WebSocket upgrade.

The negative control makes the deny load-bearing: with the refusal switched off, the same upgrade request
reaches upstream (`aps_upgrade_reaches_upstream_when_middleware_allows_it`, `10/10`, and the harness prints the
byte count it received). With the refusal on, upstream receives zero bytes.

### Case 7, revocation between two requests of one session

The first request is allowed and reaches upstream. The harness then copies a revoked revocation state over the
live one, a plain file copy between two paths supplied by the environment. The second request is denied with
`reason_code=aps_authority_revoked` and zero upstream bytes. `10/10`.

---

## The HARNESS PATCH

```
$ git diff --cached --stat
 .../openshell-supervisor-network/src/l7/relay.rs   | 457 +++++++++++++++++++++
 1 file changed, 457 insertions(+)
$ git diff --cached --name-only
crates/openshell-supervisor-network/src/l7/relay.rs
$ git diff --cached -U0 | grep -E "^@@"
@@ -11708,0 +11709,457 @@ network_policies:
$ grep -c "<home path>" harness/openshell-harness.patch
0
```

One file, one hunk, insertions only, zero deletions, entirely inside the existing `#[cfg(test)] mod tests`
(which begins at `relay.rs:3516`). Test code only.

Re-applied to a pristine fresh checkout at `ba16b9f` to confirm it is not tied to this working tree:

```
$ git apply --check harness/openshell-harness.patch
APPLY_CHECK_EXIT=0
$ git apply harness/openshell-harness.patch
APPLY_EXIT=0
$ git status --porcelain
 M crates/openshell-supervisor-network/src/l7/relay.rs
```

---

## The neutral vector

```
$ node vector/verify.mjs
ok    ancestor-active: state=valid codes=[]
ok    ancestor-revoked: state=invalid codes=[REVOKED]
aps-authority-delegation-case-a-ancestor-revoked: all 2 cases match
EXIT=0
```

Runs against the APS SDK with no OpenShell, no middleware and no relay. Both artifacts are byte-stable across
regeneration. Both are labelled CANDIDATE and neither was added to the conformance lab repo.

---

## Phase P4

Skipped. No container runtime is present and none was installed, per the job's rules. `docker`, `podman` and
`colima` are all absent, and OpenShell's VM driver is Linux only. Recorded as: **P4 skipped: no container
runtime, not installed per rules.**

---

## Things this evidence does not establish

- No test here proves that no TCP connection to the upstream was created. "Zero upstream bytes" is a single
  200 ms read of the upstream pipe, taken after the client already has the denial response. It is about HTTP
  request and application bytes received by the upstream inside that window, nothing more.
- No test here proves that a forward delayed past the 200 ms window would be caught. The observation would not
  see it, and no test here drives a delayed forward.
- No test here proves `include: ["**"]` attaches to every destination in a running policy. Attachment is proved
  for `api.example.test:8080` only.
- Nothing here was run inside a real sandbox, so the outer network fence that makes the supervisor the only
  egress path was never exercised.
- Local repository state cannot prove that no external write happened during this job. What can be said is that
  the repository has no configured remotes, no push, publish, or GitHub write command was issued, and no
  GitHub-writing tool was invoked.
