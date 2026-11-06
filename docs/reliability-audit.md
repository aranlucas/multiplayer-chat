# Reliability audit — 2026-11-06

Baseline: remote default `0579280` (merged untangle pass). Clean isolated worktree; no structural cleanup. Tests and builds run only in CI under the campaign policy.

## Inventory and trust boundaries

- React bootstrap, identity and draft storage → WebSocket room protocol → SQLite Durable Object. Public interfaces are `/r/:room`, `/api/rooms/:room/*`, shared Zod messages and the AgentRoom RPC facade. Rooms are share-by-link collaborative spaces, not authenticated tenants; query-selected roles are the implemented contract, with no account ACL documented in PRODUCT.md.
- Room messages drive planning, queued/steering turns, permission and question responses. Turn generations prevent stale completion/publication. Snapshot replay and persisted queue state cover reconnects.
- Workspace pins a public GitHub repository SHA; Railway or Workers-native snapshots supply agent files. Changes and workspace revision are captured synchronously together before publication. Publication is coalesced and newer edits remain unpublished.
- GitHub OAuth uses encrypted HttpOnly cookies and state checks; publication writes through the user's token. External GitHub payloads, URLs, archives, webhook secrets and model events are trust boundaries.
- Deployment callbacks/polling verify the published SHA and protocol before readiness; origin-bound, hashed, expiring, one-use handoff tickets transfer identity and unsent draft. Production deployment/data changes are excluded.
- Existing Vitest coverage includes real workerd persistence, room turns, concurrent publication, workspace checkpoints, GitHub operations, client handoff and rendering. CI retains lint/format, tests, SPA and Worker preview builds.

## Findings recorded before implementation

1. **High confidence, medium impact: same-name visitors collide.** `src/client/use-room.ts:getIdentity` derives a new participant ID from the display name. Two independent browsers entering `?name=Alice` both become `alice`; punctuation-normalized names collide too. Presence and participant-keyed drafts/permissions can be attributed to the wrong visitor. Expected: new identities have opaque unique IDs; remembered IDs and explicit handoff identities remain stable. Regression: independently empty storage must yield distinct IDs for identical names, while reload preserves each ID.
2. **High confidence, medium impact: malformed unrelated cookies break session reads.** `src/server/github-auth.ts:parseCookies` decodes every cookie before `readGitHubSession` enters its catch. A cookie such as `other=%` throws URIError, turning a session check or PR request into HTTP 500. Expected: malformed cookie entries cannot break a valid encrypted session or unauthenticated reads. Test both conditions.
3. **High confidence, medium impact: OAuth return path can redirect off origin.** `safeReturnTo` accepts `/\\example.com`; WHATWG URL resolution treats backslash as slash for HTTPS and redirects to that host after OAuth. Expected: return locations remain on the application origin. Regression exercises the complete start/state/callback flow with a malicious return parameter.

## Rejected hypotheses and retained contracts

- Participant roles are not GitHub authentication; imposing account-based room ACLs would invent product requirements. GitHub PR creation already requires same-origin and authenticated session.
- Publication revision capture and in-flight coalescing already have behavioral regressions; do not redo the merged module extraction or replace these guards.
- Handoff redemption performs SQL consumption without an await between lookup and update after hashing; a same-instance double redemption does not interleave there.
- Exact-SHA preview verification is present; checking only HTTP readiness would weaken existing behavior.

## Validation plan and framework applicability

Use the real published `e2e` package from tester-army/e2e and `@e2e-dev/web` for deterministic browser flows without model credentials. Published versions verified via npm (e2e 0.23.0, web 0.15.5; Node ^22.22.3 or >=24.8). Read current quickstart and GitHub Actions docs via HTTPS; use manually authored config, no login or interactive init. CI-only local fixture server must exercise independent same-name visitors, shared planning/events and reload persistence. Handoff is separately covered by existing protocol/client/workerd tests; no production deployment is authorized for this audit.

CI evidence, independent review and final outcome will be appended after implementation.

4. **High confidence, high impact (independent review): repository switching overlaps active work.** `handleClientMessage(room.configure)` clears repository metadata without excluding unsettled turns, concurrent configuration or publication. A paused runner retains checkpoint rights and can subsequently write old-repository edits into the new workspace; publication can restore old PR metadata after reset. Guard repository configuration while turn invocations, cloning or publication are active, and reject new prompts/publication during configuration. Regression holds a paused provider completion pending and checks repository and checkpoints stay associated.

Implementation: opaque IDs only for new identities (existing storage/handoff IDs preserved); cookie decode failures drop only the malformed entry; canonical URL origin validation rejects backslash and control-character authority variants; repository configuration excludes unsettled turn invocations/publication/cloning and blocks prompts/publication until completion. Installed packages with `--ignore-scripts` after inspecting the root prepare and pnpm allowBuilds policies; no local tests/builds ran.

The browser journey uses actual Workers SQLite room state and UI planning, independent empty storage for the second same-name visitor, persisted participant separation, reload and unsent draft persistence. It does not claim simultaneous-browser or deployed preview verification. Production deployment is disallowed; existing workerd handoff regressions remain the controlled CI evidence. No model calls or secrets. CI adds retained runner reports/logs/traces and four baseline-reproduction invocations that must fail against `0579280` before the corrected full suite is accepted.

Independent review challenged the three original findings and found the repository-switch race. Addressed its OAuth control-character variants, normal-return preservation, browser connection wait and controlled paused-runner reproduction. Added configuration-failure/retry and competing-work regressions. Offline browser fixture blocks external fetches; workspace initialization reports failure while room collaboration remains usable, so ordinary CI requires neither GitHub nor provider access. Local static `pnpm lint` and `pnpm format:check` passed before the fixture addition; all execution evidence remains pending CI.
