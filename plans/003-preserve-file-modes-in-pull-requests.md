# Plan 003: Preserve executable file modes when publishing a pull request

> **Executor instructions**: Follow this plan step by step and honor the STOP
> conditions. Update the status row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 73ce9c1..HEAD -- src/server/github-pull-request.ts test/server/github-pull-request.test.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `73ce9c1`, 2026-11-11

## Why this matters

`src/server/github-pull-request.ts:129-137` writes every changed path to the Git tree with `mode: "100644"`. When the agent edits an executable file such as `scripts/build.sh` (mode `100755`), the pull request silently drops the executable bit. CI scripts and hooks then break after merge. The diff shows a mode change that nobody asked for.

## Current state

- `github-pull-request.ts:129-137`: the tree entries are hardcoded with `mode: "100644", type: "blob"`.
- `WorkspaceChange` (`src/shared/workspace-change.ts`) carries only `path` and `content`. The mode isn't captured from the sandbox or the tarball.

## Steps

1. In `publish`, before building the tree, read the modes of the changed paths that already exist in the base commit. For each modified path, call `GET /repos/{writeRepository}/contents/{path}?ref={baseCommitSHA}`, or use one `GET /git/trees/{baseTree}?recursive=1` call and fall back to per-path calls when it is `truncated`. Keep `100755` for executable files and default to `100644` for new files.
2. Validate the response with Zod. Reject symlink (`120000`) or submodule entries with a clear error rather than overwriting them with a blob.
3. Test: in `test/server/github-pull-request.test.ts`, the base tree reports `scripts/build.sh` as `100755`, and the published tree entry must keep `100755`. A new file must get `100644`.

## Done criteria

- [ ] All repo gates pass (`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test --maxWorkers=1`, `pnpm build`)
- [ ] New mode regression fails on the old hardcoded mode

## STOP conditions

- Mode lookup needs more than one extra GitHub request per changed file _and_ per publication. Report the request budget first.
