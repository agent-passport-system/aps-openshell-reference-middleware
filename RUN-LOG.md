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
| 21:11:46 | P3 artifacts written: README.md, EVIDENCE.md, vector/ (2 CANDIDATE artifacts + a standalone verifier). Harness patch regenerated at 457 lines and confirmed to apply cleanly to a pristine ba16b9f checkout. |
| 21:11:46 | Caught before the final commit: rerunning fixtures/generate.mjs rotated the committed keys. Restored the exact fixtures every run used, then made the generator reuse committed keys so the set is byte-reproducible. |
| 21:11:46 | Final G1 rerun against the final tree: 50/50 PASS, 629.2s. Final P2 rerun: 12 cases x 10 passes PASS, latency median 847us p95 1014us. |
| 21:11:46 | Commits 37a884c (G0+G1) and e54a916 (P2+artifacts), both signed G, both with Signed-off-by, no AI trailer, no remotes. Handoff written. BUILT. |

---

## Cleanup job, 2026-09-29 to 2026-09-30 (Day 225 to 226)

Bounded cleanup of findings F1 to F5 in HANDOFF-2026-09-29-openshell-casea-verify.md. Past entries above are left
as written, including the citations this job corrects. Claim unchanged, word for word.

| Time (PDT) | Entry |
|---|---|
| 22:30 | Cleanup start. Read the verify handoff section 3 and D-20260929-OPENSHELL-CASEA-ERRATUM. OpenShell checkout /tmp/aps-os/openshell present on branch aps-harness at ba16b9f, relay.rs sha256 2ed8757206daa1a8bda2267eda56cd4073f2c717188571ca821525aa7aa53596, matching the verifier's patched baseline. |
| 22:40 | Re-verified at ba16b9f before editing any citation: relay.rs:1988 apply_middleware_chain_with_request_id, :2017 return Ok(()) inside the Denied arm opened at :2001 after send_middleware_rejection_response at :2009, :2088 relay_http_request_with_credential_rejection. Also l7/middleware.rs:828 fn safe_middleware_headers, :857 "connection", :862 "upgrade", call site :616. Pristine relay.rs at the pin is 11709 lines, sha256 58f084b12093ab21a5707452925eb76a59008d7b3a28a56f42ee5e8d7f74d03b. |
| 23:05 | F1 fixed. aps_request returns Option<usize> populated only by the real post-denial read of the upstream pipe. All four deny tests assert on it. The four vacuous assert!(forwarded.is_empty()) lines removed. Harness change stays inside #[cfg(test)] mod tests, insertions only. |
| 23:20 | F1 runners fixed. Harness prints APS_UPSTREAM_BYTES_AFTER_DENY=<n> before asserting. New shared parser in run-case.mjs; run-g1.mjs and run-p2.mjs parse it and count a missing line as FAIL, never as zero. Both /upstream received/ heuristics removed. run-p2.mjs also checks the post-denial read count per case (denyReads). |
| 23:25 | Caught during wiring: cargo's test harness prefixes the first output line with "test <name> ... ", so an anchored ^KEY= regex never matched. Harness now prints a leading newline and the parser matches the key anywhere. Without this the metric would have read MISSING on every run, which the new rule correctly failed. |
| 23:45 | Item 4 PASS, metric proven live. Mutation M1b in /tmp only at the MiddlewareApplyResult::Denied arm inside relay_rest: 53-byte request line written upstream before the rejection response. APS_MW_G1_RUNS=1 node scripts/run-g1.mjs exit 1, APS_UPSTREAM_BYTES_AFTER_DENY=32, zero_upstream_bytes=false, RED runs with zero upstream bytes 0/1, GATE G1 FAIL on the metric's own assertion. |
| 23:55 | M1b reverted, revert proven: relay.rs sha256 dafa9ba0c8b170fee9825f55d8b7d0dcc0735cda9daec55cef400ab3b2a52805 identical to the pre-mutation file, cmp exit 0, mutation text absent, git diff HEAD 494/0. Rebuild exit 0, G1 1 run exit 0 with APS_UPSTREAM_BYTES_AFTER_DENY=0 and GATE G1 PASS. |
| 00:05 | Harness patch regenerated: 494 insertions, 0 deletions, one file, 4 context lines, all inserted lines between the last pre-existing test's closing brace and the mod tests closing brace. git apply --check exit 0 against a pristine ba16b9f clone; applied there the file is sha256-identical to the working checkout. |
| 00:20 | F2 and F3 fixed. Enforcement citation moved to the tested path relay_with_inspection -> relay_rest (1988/2017/2088) in README.md, DESIGN.md, EVIDENCE.md, vector/generate.mjs and the regenerated vector/openshell-adapter-observation.CANDIDATE.json, each with a sentence that relay_with_route_selection is not exercised and UNKNOWN. Upgrade citation moved to l7/middleware.rs:828/857/862 called at :616 in README.md, EVIDENCE.md and src/evaluate.mjs. src/ change is comments only. Neutral vector byte-identical after regeneration. |
| 00:25 | F4 fixed: README run instructions no longer claim fixtures/generate.mjs rewrites the committed keys. F5 fixed: README.md and EVIDENCE.md state the 200 ms post-denial window, what it proves, that it says nothing about TCP connection creation, and that the count saturates at the 32-byte read buffer. |
| 00:30 | Item 8 claim ceiling grep over README, DESIGN, EVIDENCE and both vectors: 15 hits, every one a limitation or a denial. Nothing widened to all OpenShell traffic, the route_selection path, cryptographic identity, dynamic narrowing, real-sandbox behavior, production use or an NVIDIA-supported integration. Nothing to fix. |
| 01:35 | Item 7 G1 rerun against the final tree: exit 0, GREEN 25/25, RED 25/25, RED runs with zero upstream bytes 25/25 with the new metric reading 0 on every row, observation missing in 0, elapsed 3528.0s, GATE G1 PASS. |
| 02:20:10 | Item 7 P2 rerun against the final tree: exit 0, all 12 cases 10/10, every deny case APS_UPSTREAM_BYTES_AFTER_DENY=0, case 6 control none, latency case post_denial_reads=0 allowed_decisions=200/200 median 830us p95 978us, P2 SUITE PASS. git diff --stat on fixtures/ empty. smoke.mjs and vector/verify.mjs both exit 0. |
| 02:20:10 | Commits 05c75c5 (harness and runners) and d60ce3e (citations and window), both signed G, both with Signed-off-by, no AI trailer, no remotes, pre-commit hook kept. CLEANED. |
