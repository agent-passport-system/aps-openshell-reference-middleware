# RUN-LOG

APS OpenShell reference enforcement middleware, Case A build job.

Date started: 2026-09-29 (Day 225).

| Time (PDT) | Entry |
|---|---|
| 19:08:40 | Job start. Repo created at ~/aps-openshell-middleware, git init exit 0, no remotes. |
| 19:08:40 | Signing pre-flight in /tmp/aps-sign-preflight: git commit -s exit 0, git log --format='%G?' returned G, key DB1325FDC6E6DCBB, no AI trailer. |
| 19:08:40 | Toolchain: node v24.11.1, npm 11.6.2, cargo 1.95.0, rustc 1.95.0. docker/podman/colima all 'not found' -> P4 will be skipped. |
| 19:08:40 | P0 start: re-verify chat-sourced facts at OpenShell ba16b9f. |
| 19:17:10 | P0 complete. DESIGN.md written. All chat-sourced facts re-verified at ba16b9f (relay.rs:1208/:1240/:1305, test at :5922, middleware_relay_context_with_enforcement at :4257, host_pattern 6/6, RequestContext.sandbox_id at proto:586). |
| 19:17:10 | GATE G0 PASS: external gRPC middleware reachable from a relay unit test via MiddlewareRegistry::connect_services (lib.rs:1107) + OpaEngine::replace_middleware_registry (opa.rs:868); pattern already in-tree at relay.rs:4479-4560. Supervisor-supplied sandbox_id available via openshell_ocsf::ctx (ctx.rs:31). Harness patch needed only because L7EvalContext derives Default under cfg(test). |
| 19:44:16 | P1: middleware + fixtures built. Fixture self-checks 6/6 with exact expected APS codes. Standalone gRPC smoke 12/12. |
| 19:44:16 | HARNESS PATCH added on OpenShell branch aps-harness: pure insertion into relay.rs mod tests, no deletions, test code only. |
| 19:44:16 | Runner defect caught: cargo exits 0 when a test filter matches nothing. Added a ran/selectedNone guard so a zero-test run can never read as a pass. |
| 19:44:16 | GATE G1 PASS (first run, commit 37a884c): 50/50, zero upstream bytes in all 25 RED runs. Two mutations confirmed the RED assertions are not vacuous. |
| 19:44:16 | SURPRISE, P2 case 6: OpenShell omits Upgrade and Connection from what a middleware sees (headers.rs:298,303) and hardcodes scheme https for the HTTP request stage (middleware.rs:524). Denying on an Upgrade header is impossible. Observed that the middleware does receive sec-websocket-key and sec-websocket-version, and switched detection to those, with a negative control proving the deny is what stops the request. |
| 19:44:16 | P2 suite 12 cases pass on a shakedown pass. Middleware changed after the first G1, so G1 will be rerun against the final code. |
| 20:13:58 | P2 suite PASS: 10/10 passes, all 12 cases. Latency over 200 allowed requests: median 836us p95 981us. |
| 20:13:58 | GATE G1 rerun against final code PASS: 50/50, zero upstream bytes in all 25 RED runs, elapsed 536.1s. |
| 20:13:58 | P4 skipped: no container runtime, not installed per rules. docker/podman/colima all absent; OpenShell VM driver is Linux only. |
