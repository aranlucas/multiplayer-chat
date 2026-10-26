# Relay feature roadmap

Updated 2026-10-26. Proposed collaboration features after Digits/MCP priorities.
The value to evaluate is shared understanding and a completed change, not more
agent activity or a longer transcript.

## Starting point

At `db208cf96bd2f6383ef4656c666bca60c81bd63c`, the [room](README.md) already
shares ordered agent events, steering/queued prompts, permissions, diffs and
exact-commit preview/PR publication. A deterministic simulation and live
Cloudflare/Railway path are distinct; local tests do not prove live availability.

## Ordered releases

1. **Catch up when joining a busy room.** Show the current task, decisions,
   unresolved questions, changed files and next action with links to the events
   behind them. Acceptance: the summary identifies its event boundary, labels
   uncertain conclusions, and does not lose later events while refreshing.
2. **Agree on the next change.** Add a concise shared task card with acceptance
   criteria and a visible history of approved changes to the plan.
   Acceptance: participants can distinguish a suggestion, queued prompt and
   accepted direction; edits do not silently authorize tools or publication;
   overlapping edits resolve against a known revision.
3. **Make work limits and stopping understandable.** Display supported turn,
   time and usage limits plus a clear stop/recovery path. Acceptance: unknown
   provider cost stays unknown; stopping prevents new work where the runtime
   guarantees it and reports already-started external effects accurately.
   Do not claim a hard cost ceiling from incomplete telemetry.
4. **Hand off a finished change with its evidence.** Package the existing diff,
   selected revision, check results and remaining limitations into a compact
   review view. Acceptance: tests refer to the exact reviewed revision, newer
   workspace edits remain visible, and preview readiness is not treated as
   approval to merge. Reuse existing publication and draft-handoff contracts.

## First slice and evidence

Start with the late-join catch-up view in simulation, then a deliberately
configured pilot with two participants. Compare time to understand the task,
clarification messages and mistaken actions with reading the raw transcript.
Keep code, credentials and prompt contents out of aggregate product analytics.

Follow [project gates](AGENTS.md): lint, formatting, types, tests and build; a
future multiplayer change also needs the stated two-participant deployed flow.
This roadmap changes no room behavior and initiates no live provider, sandbox
or deployment session. Prefer existing room state and events over a parallel
coordination service.
