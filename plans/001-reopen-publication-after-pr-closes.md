# Plan 001: Open a new pull request when the room's saved pull request is closed, merged or its branch is gone

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 73ce9c1..HEAD -- src/server/github-pull-request.ts src/server/agent-room-core.ts test/server/github-pull-request.test.ts test/server/agent-room-deployment.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `73ce9c1`, 2026-11-11

## Why this matters

A Relay room remembers the first pull request it opened (`relay_room.pull_request_*`) and publishes every later workspace revision to it. Nothing checks whether that pull request is still open. Once a maintainer merges it, two failures follow:

1. If GitHub auto-deleted the head branch, which is common, the branch lookup returns 404. `request()` throws `"Not Found"`. Live turns call `publishSavedPullRequest()` after each successful turn, so **every later successful agent turn is reported as `Agent turn failed: Not Found`** and the room goes to `error`.
2. If the branch still exists, Relay pushes the new commit onto a merged or closed PR and posts "published revision N to pull request #X". The change never reaches review.

The UI can't recover either: `handlePullRequest` in `src/client/app.tsx:152` only opens the old `pullRequestURL` when one is saved. The only way out today is to reconfigure the repository, which wipes the workspace. After this plan, a closed, merged or missing PR makes the next publication open a fresh pull request, and the room records it.

## Current state

- `src/server/github-pull-request.ts`: GitHub REST client. `publish(input, existing?)` creates blobs, tree, commit, then either PATCHes the existing branch or creates a branch and PR.
  - Line 98-101: `writeRepository = existing?.writeRepository ?? (push ? full_name : ensureFork(...))`
  - Lines 142-156: when `existing`, reads `GET /repos/{writeRepository}/git/ref/heads/{branch}` **without** `allowNotFound`, so a deleted branch throws `"Not Found"`; a moved head throws `"Pull request branch moved …"`.
  - Lines 168-195: `existing` ⇒ PATCH ref and reuse `{ number, html_url }`; otherwise POST ref + POST `/pulls`.
  - `request(schema, path, init, allowNotFound: true)` returns `undefined` on 404. Use this overload.
- `src/server/agent-room-core.ts:364-454` `publishPullRequest`: builds `existing` from room columns (line 378-393), calls `publish`, and stores the result in `relay_room`. The event text at line 438-441 is `existing ? "published revision … to pull request #N" : "created pull request #N"`.
- `src/server/agent-room-core.ts:1416-1418`: a successful live turn awaits `publishSavedPullRequest()`. A throw there marks the turn failed.
- Tests: `test/server/github-pull-request.test.ts` fakes `fetch` by URL (see the `json()` helper and the "publishes later revisions to the same pull request branch" case). `test/server/agent-room-deployment.test.ts` builds rooms from `test/server/fixtures/room.ts` (`roomContext`, `TestRoom`, `simulationEnv`). `test/setup-network.ts` blocks non-loopback fetch, so room tests must `vi.stubGlobal("fetch", …)`.
- Conventions: Zod schemas for every GitHub payload (`pullSchema`, `refSchema` …); no `any` or double casts (AGENTS.md).

## Commands you will need

| Purpose   | Command                                                                                                                                                          | Expected on success |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Install   | `pnpm install --frozen-lockfile`                                                                                                                                 | exit 0              |
| Unit      | `pnpm exec vitest run --config vitest.config.ts --project node --maxWorkers=1 test/server/github-pull-request.test.ts test/server/agent-room-deployment.test.ts` | all pass            |
| Lint      | `pnpm lint && pnpm format:check`                                                                                                                                 | exit 0              |
| Typecheck | `pnpm typecheck`                                                                                                                                                 | exit 0              |
| Tests     | `pnpm test --maxWorkers=1`                                                                                                                                       | all pass            |
| Build     | `pnpm build`                                                                                                                                                     | exit 0              |

## Scope

**In scope**: `src/server/github-pull-request.ts`, `src/server/agent-room-core.ts` (event text only), `test/server/github-pull-request.test.ts`, `test/server/agent-room-deployment.test.ts`, `test/server/fixtures/room.ts` (a seeding helper only).

**Out of scope**: the client (`src/client/*`); the deployment alarm and readiness logic; fork and permission handling for a _second_ participant (plan 002); file modes (plan 003).

## Steps

### Step 1: Decide whether the saved PR is reusable before writing to GitHub

Add `const pullStateSchema = z.object({ state: z.string() });` and a private method:

```ts
/** A saved pull request receives new revisions only while it is open and its branch still exists. */
private async reusablePullRequest(repository: string, existing: ExistingPullRequest) {
  const pull = await this.request(pullStateSchema, `/repos/${repository}/pulls/${existing.number}`, {}, true);
  if (pull?.state !== "open") return undefined;
  const remote = await this.request(refSchema, `/repos/${existing.writeRepository}/git/ref/heads/${refPath(existing.branch)}`, {}, true);
  if (!remote) return undefined;
  if (remote.object.sha !== existing.headSHA) throw new Error(/* keep the existing "branch moved" message */);
  return existing;
}
```

In `publish`, call it right after loading `baseRepository` and replace every later use of `existing` with the result (`reusable`): the write repository, the parent SHA (`reusable?.headSHA ?? input.baseCommitSHA`), the branch, PATCH-vs-POST, and the pull creation. Remove the old in-line ref read.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Describe a replacement in the room timeline

In `publishPullRequest` (`agent-room-core.ts:438`), use three cases. Keep the current text when `existing.number === result.number`. Use the "created" text when there's no `existing`. When `existing` is set but the numbers differ, use `@login created pull request #N because #M is no longer open`.

**Verify**: `pnpm typecheck` → exit 0.

## Test plan

In `test/server/github-pull-request.test.ts`:

- Update the "publishes later revisions" fake to answer `GET /pulls/42` with `{ state: "open" }`. The test is about reusing an open PR.
- New: the saved PR is merged (`state: "closed"`). Expect POST `/git/refs`, POST `/pulls`, no PATCH, commit `parents` equal to `[baseCommitSHA]`, and a new PR number.
- New: the saved PR is open but its branch returns 404. Expect a new PR, and no "Not Found" throw.
- New: the branch moved. It still rejects with "branch moved", and nothing is written (no POST/PATCH).

In `test/server/agent-room-deployment.test.ts`, add a room-level regression. Seed a room whose saved PR is merged and that has one workspace change. Stub `fetch` with a GitHub fake. `createPullRequest` must succeed, the room must now report the new PR number and URL, and the timeline must say the old PR is no longer open.

## Done criteria

- [ ] All commands in the table exit 0
- [ ] The new tests fail when `reusablePullRequest` is reverted to always returning `existing`
- [ ] `git status` shows only in-scope files modified

## STOP conditions

- `request()` no longer supports the `allowNotFound` overload.
- The PR object from GitHub lacks `state` in the API version pinned at `API_VERSION`.
- The fix appears to need client changes.

## Maintenance notes

- A PR a human closed on purpose (not merged) is also replaced on the next edit. The room's work keeps going, and pushing into a closed PR was worse. If maintainers want "closed means stop publishing", that's a product decision. Add a room flag; don't change this check.
- The PR-state check adds one GET per publication. It's negligible next to the blob, tree and commit writes.
