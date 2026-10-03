# Anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Commit: c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b
- Source path: skills/install-anti-slop/assets/anti-slop/
- Installed path: tools/oxlint/anti-slop/
- Changes to vendored implementation: none.
- Root LICENSE copied from the same commit; nested Stylistic LICENSE and UPSTREAM.md preserved.
- Generic rules are enabled. Effect rules require a direct Effect dependency.

## Repository integration

- Toolchain: exact `oxlint` / `@oxlint/plugins` 1.86.0, pnpm 12.6.0.
- All 18 generic rules and native `oxc/no-accumulating-spread` are errors. Existing type-aware, security, React, and zero-warning policy is retained.
- Runtime wire, checkpoint, encrypted-session, and GitHub API data use Zod contracts. OpenCode's public subscription is JSON-decoded SSE, including with the in-process Workerd host; JSON extensions are preserved and non-JSON extensions rejected. Narrow unknown-input exceptions exist only at the three external decoders.
- The generic SQLite test-driver assertion preserves the same query-result contract as Workers SQL; real migrations and constraints execute in tests. Runtime room behavior stays in its own core behind the Durable Object adapter, and SDK/platform tests use typed dependencies instead of module mocks.
- Tests default-deny external fetch/WebSocket transport; local Workerd fixtures additionally deny outbound inference/service requests. No live providers, production deployments, credentials, or real user data are needed.

## Verification

- Exact-manager frozen installation; type-aware zero-diagnostic lint; formatter and fix/format stability; TypeScript project build.
- 195 tests in 31 files, including actual local Workerd SDK and Durable Object two-participant/reconnect/one-time handoff flows, malformed wire/extension data, iterator cancellation, and authenticated ciphertext validation. The final local suite used `--maxWorkers=2` to bound memory.
- Production and native Worker Preview builds, plus native preview output validation.
- Negative rule probe verified actual plugin loading; 38 vendored files and the upstream root license were byte-checked against the pinned source. Upstream unit and CLI suites were also verified with matching 1.86 tooling during the rollout.
- Graphical browser playtesting and deployed-site/provider operations were not run. Existing upstream bundle warnings remain.
