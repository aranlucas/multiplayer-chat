# Untangle decisions — 2026-11-06

## Scope and baseline (before implementation)

Clean checkout at `997d59e`. Reviewed the source/module inventory, client and server imports,
room orchestration, workspace/sandbox/tool adapters, event presentation/coalescing, HTTP and
preview entrypoints, shared validators, test inventory, build/CI configuration and product docs.
Preserve prior comment/test cleanup (#99, #100), existing product decisions, and behavioral tests.
Both optional additions selected. Tests and builds run only in CI under the latest user instruction;
no local test or build process was started by this thread. Existing CI runs lint/format, tests,
and both builds (including TypeScript). No deployment is authorized.

## Design and problem inventory

1. Put preview URL normalization and readiness verification in one server module using Zod.
   - Hidden link: HTTP callbacks/local previews and room alarms separately implement URL policy,
     readiness endpoint, timeout, protocol and exact-SHA checks.
   - Both trust a TypeScript assertion on external JSON; truthy malformed readiness can activate
     a preview. Runtime validation must require boolean `true` and protocol 1.
   - Retain optional SHA only for local simulation previews, which need not have a Git commit.
2. Define handoff client state and mobile tab vocabulary in a shared module.
   - Hidden link: HTTP input, durable tickets, bootstrap response validation, hook and tab rendering
     separately enumerate the same fields/tabs. Server validation is buried in room orchestration.
   - Keep tolerant optional-field decoding and existing length limits/default transcript behavior.
3. Move room schema migration and OpenCode bootstrap table isolation into a focused storage module.
   - Needless link: room event/turn orchestration contains nearly 200 lines of schema/bootstrap
     mechanics. The bootstrap order and recovery path must remain explicit in the constructor.
   - Keep historical migrations, table restoration on failure, and persisted participant hashing:
     these encode compatibility requirements, not disposable special cases.

## Retained boundaries and special cases

- Room owns ordered state/events; workspace owns captured publication content/revisions;
  GitHub client owns remote publication; sandbox/tools own execution. Do not merge these boundaries.
- Live and simulated runners differ intentionally; simulation sleeps pace demo events.
- SDK event compatibility, deferred provider errors, stale deployment observations, publication
  serialization, reconnect retries, and Strict Mode cancellation protect external/lifecycle behavior.
- JSON/text boundary helpers are shared policy, not redundant wrappers. UI display and event
  coalescing have different outputs and change for different reasons.
- Build-preview scripts and tests protect Cloudflare prebuilt metadata and exact SHA delivery.
  Keep existing native configs, asset licensing, product/design docs and external-workaround comments.
- No dependency or custom script is needed. Zod already supplies boundary validation.

## Review and validation

Inventory review running sequentially; record its findings and later review outcomes below.
CI is the validation authority. Local validation results: none claimed.

### Inventory review additions (before their implementation)

4. Centralize the remote workspace root in a stable workspace-path module.
   - Workspace checkout, tool paths/prompts and SDK session locations independently hardcode it.
5. Validate deployment callback statuses with Zod before room persistence.
   - An arbitrary nonempty status currently passes the HTTP presence check and corrupts revision state.
6. Assert persisted revision recovery in the existing readiness test, replacing a generated spy-call
   expectation. Remove remaining session-title/simulation implementation recaps; retain SDK context.

Regression expectations: malformed readiness must never activate a revision; wrong protocol/SHA or
HTTP failure must reject; valid matching readiness must succeed. Invalid callback status must return
400 before accessing a room. Existing publication concurrency, multiplayer persistence and draft
handoff integration tests remain in CI. No tests were removed.

### Completion review

Two sequential read-only subagent reviews covered the repository and final changes. The second
found a remaining schema-to-workspace dependency, duplicated deployment status/protocol constants,
and a missed shared participant decoder. Addressed all of them; the reviewer confirmed no further
worthwhile findings. Schema recovery now lives beside migrations; wire producer/consumers share
status/version definitions. Added tolerant-field/length handoff regressions. Existing migration
recovery tests follow the helper to its new module. No meaningful tests were removed.

Local lint initially identified new spacing/type issues and the moved test import; corrected them.
Tests and builds remain CI-only. Existing CI includes the new regression files automatically.
No deployed multiplayer verification is claimed: this thread does not deploy or run browser tests.
