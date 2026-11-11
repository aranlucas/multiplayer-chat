# Plan 002: Let a second GitHub participant publish to a room whose pull request lives on someone else's fork

> **Executor instructions**: Follow this plan step by step and honor the STOP
> conditions. Update the status row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 73ce9c1..HEAD -- src/server/github-pull-request.ts src/server/agent-room-core.ts src/client/app.tsx`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (it changes who owns publication)
- **Depends on**: plans/001-reopen-publication-after-pr-closes.md
- **Category**: bug
- **Planned at**: commit `73ce9c1`, 2026-11-11

## Why this matters

Relay is multiplayer, and every authenticated participant's browser auto-publishes. The effect in `src/client/app.tsx:101-149` calls `createPullRequest()` whenever `workspaceRevision > publishedWorkspaceRevision`. The server reuses `existing.writeRepository` (`src/server/github-pull-request.ts:98-101`). When the first publisher had no push access, that is _their fork_ (`login/repo`). A second participant's token can't push to it, so their publication fails with a GitHub 403/404. Because `publishPullRequest` also overwrites `github_credential` (`agent-room-core.ts:414-429`), a successful publish by B also changes whose token later turns use.

## Current state

- `github-pull-request.ts:96-101`: the write repository is chosen from `existing` before any permission check.
- `agent-room-core.ts:414-429`: stores `sealedCredential` for the latest publisher.
- `agent-room-core.ts:456-476` `publishSavedPullRequest`: publishes with the stored credential after each live turn.

## Steps (design first)

1. Write a failing test in `test/server/github-pull-request.test.ts`: `existing.writeRepository = "alice/repo"`, login `bob`, and `GET /repos/alice/repo` reports `permissions.push: false`. Today the PATCH fails.
2. Choose a behavior and record it in this plan before coding. Options:
   (a) Bob's publication is refused with a clear message ("Pull request #N is published from @alice's fork; ask @alice or a repository maintainer to publish"), and the client stops auto-publishing for non-owners.
   (b) Only the stored credential publishes. The HTTP route records Bob's request as "publish requested" and runs `publishSavedPullRequest()`.
   Recommended: (b). It keeps one owner per PR and needs no new GitHub permissions.
3. Implement it. Add a room-level test with two credentials.

## Done criteria

- [ ] `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test --maxWorkers=1 && pnpm build` exit 0
- [ ] Two-participant regression test passes; reverted code fails it

## STOP conditions

- The chosen option needs a new OAuth scope.
- PRODUCT.md or DESIGN.md states a publication ownership rule that conflicts with either option.

## Maintenance notes

Interacts with plan 001. A replaced PR re-selects `writeRepository` from the current publisher.
