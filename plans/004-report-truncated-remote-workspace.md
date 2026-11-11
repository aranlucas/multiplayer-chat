# Plan 004: Report, rather than silently truncate, oversized repositories in the Workers-native workspace

> **Executor instructions**: Follow this plan step by step and honor the STOP
> conditions. Update the status row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 73ce9c1..HEAD -- src/server/workspace.ts test/server/workspace.test.ts`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `73ce9c1`, 2026-11-11

## Why this matters

Without Railway configured, `RepositoryWorkspace.prepareRemote` loads the GitHub tarball through `readTarTextFiles` (`src/server/workspace.ts:621-672`). The loop condition `files.length < 5_000 && totalBytes < 20_000_000` (line 627) stops reading without telling anyone. The workspace then reports `ready`. Search and the agent see only part of the repository, and a file that exists upstream but wasn't loaded is treated as new when the agent writes it. GitHub's pax extended headers (type `x`) for long paths are skipped, so those files are missing too.

## Steps

1. Make `readTarTextFiles` return `{ files, truncated: boolean }`. Handle pax `x` headers by applying the `path=` record to the next entry.
2. When truncated, store a `workspace_error`-style notice, or add a system event. Then make `search()` results say "partial workspace". Keep `workspace_status = 'ready'`.
3. Tests in `test/server/workspace.test.ts` (follow its tarball fixtures): one archive with more than the limit, and one with a pax long path.

## Done criteria

- [ ] All repo gates pass; new tests fail on the old reader

## STOP conditions

- The UI has no place to show a workspace notice without a protocol change. Report that before you add protocol fields.
