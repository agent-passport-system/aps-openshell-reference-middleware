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
