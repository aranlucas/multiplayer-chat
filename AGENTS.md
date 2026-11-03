# Working on Relay

- Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before delivering a change. CI enforces these gates.
- Fix the cause of lint failures. Do not weaken the policy, add blanket suppressions, or introduce `any`, `as never`, or double casts to silence errors. Keep unavoidable external-data assertions at a named boundary; validate untrusted input at runtime. Existing test doubles are not a pattern for new production code.
- Handle rejected promises where work starts. `void` only discards a result; it does not handle rejection. UI event handlers must surface failures or call an operation that does.
- Keep React effects tied to the resource they synchronize. Do not restart network operations on unrelated room snapshots or draft edits. Keep hooks unconditional and components outside other components.
- Capture file contents and their revision together before asynchronous publication. Protect concurrent publication, preserve newer workspace edits, and verify deployment readiness against the exact published SHA.
- Add behavioral regression tests for defects, including relevant failure and concurrency paths. Do not reproduce implementation logic in assertions or mocks, or replace real assertions with mocks of the behavior being tested.
- Keep room state, workspace operations, deployment handoff, and UI rendering in their existing modules. Extract a focused module when adding another responsibility; do not grow `agent-room.ts` with unrelated helpers.
- For multiplayer changes, verify two participants, shared events, reconnect/persistence, and preview handoff with an unsent draft using the deployed site.

## Test quality

- Before adding a test, identify the specific behavior, a credible mistake it should catch, and an independently justified expected result.
- Prefer small, fast, reliable tests whose failures identify the broken behavior. Use integration/E2E tests for interactions isolated tests cannot establish.
- Protect contracts, not incidental internal structure.
- Distinguish temporary development scaffolding from checks worth maintaining.
- Never delete or weaken a failing test just to make the suite pass.

## Scripts: native first

Before adding a script file (`scripts/`, `bin/`, `tools/`, root `*.sh|*.py|*.mjs`) or a package script that runs one, take the first rung that works:

1. A flag or subcommand of a tool the repo already uses (`<tool> --help`).
2. Declarative config for that tool (`vite.config.ts`, `cloudflare.config.ts`, `vitest.config.ts`, `oxfmt.config.ts`, `pnpm-workspace.yaml`).
3. A maintained plugin for that tool.
4. A one-line package.json script that calls a native command.
5. A test in the existing runner (Vitest), for anything that asserts.
6. A custom script, only for behavior specific to this repo. Its first comment names the native rung it couldn't use and why. It has a test in the existing runner, and the PR that adds it quotes that comment.

## Code: libraries first

Before hand-writing general-purpose code, use a well-maintained library: actively released, widely adopted, typed, and a fit for this stack. Reach for one already in the dependencies first. Write custom code for domain logic and for the glue no library covers. A PR that adds a dependency says why it was picked; a PR that hand-writes something a library covers names the library and why it didn't fit.

- Room protocol and external payload validation → `zod`.
- HTTP routing and middleware → `hono`.
- Localized event timestamps → the JavaScript standard-library `Intl.DateTimeFormat`.
