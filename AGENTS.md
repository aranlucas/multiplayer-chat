# Working on Relay

- Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before delivering a change. CI enforces these gates.
- Fix the cause of lint failures. Do not weaken the policy, add blanket suppressions, or introduce `any`, `as never`, or double casts to silence errors. Keep unavoidable external-data assertions at a named boundary; validate untrusted input at runtime. Existing test doubles are not a pattern for new production code.
- Handle rejected promises where work starts. `void` only discards a result; it does not handle rejection. UI event handlers must surface failures or call an operation that does.
- Keep React effects tied to the resource they synchronize. Do not restart network operations on unrelated room snapshots or draft edits. Keep hooks unconditional and components outside other components.
- Capture file contents and their revision together before asynchronous publication. Protect concurrent publication, preserve newer workspace edits, and verify deployment readiness against the exact published SHA.
- Add behavioral regression tests for defects, including relevant failure and concurrency paths. Do not replace real assertions with mocks of the behavior being tested.
- Keep room state, workspace operations, deployment handoff, and UI rendering in their existing modules. Extract a focused module when adding another responsibility; do not grow `agent-room.ts` with unrelated helpers.
- For multiplayer changes, verify two participants, shared events, reconnect/persistence, and preview handoff with an unsent draft using the deployed site.
