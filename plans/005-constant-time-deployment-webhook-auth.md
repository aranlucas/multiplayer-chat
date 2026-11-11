# Plan 005: Compare the deployment callback secret in constant time

> **Executor instructions**: Follow this plan step by step and honor the STOP
> conditions. Update the status row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 73ce9c1..HEAD -- src/http-app.ts src/server/github-auth.ts test/worker.test.ts`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `73ce9c1`, 2026-11-11

## Why this matters

`POST /api/deployments` (`src/http-app.ts:273-278`) authenticates the publisher with `context.req.header("Authorization") !== \`Bearer ${expected}\``. That is an early-exit string comparison of a shared secret. A valid callback can mark any room revision ready or failed. The repo already has a constant-time comparison for OAuth state (`timingSafeEqual`, `src/server/github-auth.ts:434`). Network timing on Workers is noisy, so the practical risk is low, but the fix is cheap and makes the two secret checks match.

## Steps

1. Export a `timingSafeEqual` from a small shared server module (for example `src/server/secret-compare.ts`), or export the existing one from `github-auth.ts`. Use it in `http-app.ts` for the bearer comparison. Don't change the behavior when the secret is missing (still 401).
2. Test in `test/worker.test.ts`, following its existing deployment-callback cases: a wrong secret of the same length gets 401, a missing header gets 401, and the correct secret reaches validation (400 for an empty body).

## Done criteria

- [ ] All repo gates pass

## STOP conditions

- Workers exposes `crypto.subtle.timingSafeEqual` in the configured compatibility date. Prefer it, and note that in the PR.
