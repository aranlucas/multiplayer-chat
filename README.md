# Relay

Relay is a multiplayer coding-agent room built on Cloudflare Durable Objects and the OpenCode Workerd SDK. One Durable Object owns one shared room, giving participants a stable identity, a single event order, hibernating WebSockets, and persistent SQLite history.

![Relay desktop session](artifacts/relay-desktop-local.png)

## What works

- Shared, ordered OpenCode session events and tool transcripts
- Real-time presence across multiple browser tabs or devices
- Immediate steering or queued follow-up prompts
- Dangerous always-allow tool execution with every side effect retained in the transcript
- Persistent room snapshots for late joiners
- Public GitHub repository selection, exact commit pinning, search, reads, diffs, checks, and unified-diff edits
- Per-user GitHub OAuth and one-click pull request creation from the shared overlay
- Free hardware-isolated command execution through a self-hosted Microsandbox runner
- Responsive transcript, people, and queue views
- Local simulation mode for development without provider credentials
- Live OpenCode Zen using Ox Alpha Free (`x-preview-f-free`)

## Architecture

```text
React client
  ├─ GitHub OAuth + POST /api/rooms/:room/pull-requests
  └─ WebSocket /api/rooms/:room/ws
       └─ AgentRoom Durable Object (one per room name)
            ├─ Relay SQLite tables: room, events, participants, permissions
            ├─ Commit-pinned GitHub snapshot + mutable file overlay
            ├─ Authenticated Microsandbox command stream
            ├─ Hibernating WebSocket fan-out
            └─ OpenCodeWorkerd
                 ├─ OpenCode session + persistent event bus
                 ├─ Relay tools
                 └─ Dangerous always-allow permission policy
```

OpenCode initializes its schema first, then Relay creates namespaced collaboration tables in the same Durable Object SQLite database. Relay records its own compact, UI-focused event projection while retaining the raw OpenCode event payload.

Cloudflare's Agents SDK was considered for `useAgent`, but it is intentionally not layered on top: its client requires the Agents SDK server protocol and would introduce a second agent state model. Relay keeps OpenCode authoritative and uses a small room-specific WebSocket protocol instead.

## Develop

Requirements: Node.js 22+, pnpm, and Wrangler.

```bash
pnpm install
pnpm dev
```

Open [http://127.0.0.1:5173/r/reconnect-loop](http://127.0.0.1:5173/r/reconnect-loop). Join as another participant with query parameters:

```text
http://127.0.0.1:5173/r/reconnect-loop?name=Sam&role=contributor
```

## Repository workspaces

Production uses a Workers-native repository backend: it resolves public Git refs over Git smart HTTP, downloads the exact commit archive, stores text files in the room's Durable Object, and applies unified diffs to a persistent overlay. This works on the Workers Free plan.

Full commands run on the free, self-hosted Microsandbox service in [`runner/`](runner/). For every command the runner boots a hardware-isolated Linux microVM, clones the selected repository, checks out the exact Durable Object commit, applies the room's changed-file overlay, and streams stdout and stderr back through OpenCode. The bearer token stays in the Worker secret store and on the runner host; it is never placed inside the microVM or sent to the browser. If the runner is offline, repository browsing and edits continue to work and `run_tests` falls back to the Workers-native preflight.

## Microsandbox runner

Requirements: Node.js 22+ on Apple Silicon macOS, Linux with KVM, or Windows with WHP.

```bash
pnpm install
export MICROSANDBOX_RUNNER_TOKEN="$(openssl rand -hex 32)"
pnpm runner
```

The runner listens on `127.0.0.1:7777` by default. Expose it through an authenticated HTTPS tunnel, then configure the Worker URL and secret:

```bash
npx wrangler secret put MICROSANDBOX_RUNNER_TOKEN
# Set MICROSANDBOX_RUNNER_URL in wrangler.jsonc
pnpm deploy
```

`relay.run_tests` chooses the repository's `test`, `typecheck`, or `build` script and installs dependencies from its lockfile. `relay.run_command` intentionally permits an arbitrary shell command because Relay runs in dangerous always-allow mode. Both tools retain their progress and terminal result in the shared Durable Object transcript.

## GitHub pull requests

The **Connect GitHub** button uses GitHub's web OAuth flow with the `public_repo` scope. Relay encrypts the resulting access and refresh tokens into an HTTP-only, secure, same-site cookie; tokens are never exposed to client JavaScript, OpenCode, or Microsandbox. Pull request creation uses the authenticated user's GitHub permissions.

Register a GitHub OAuth app with this production callback:

```text
https://relay-multiplayer-agent.aranlucas.workers.dev/api/auth/github/callback
```

Set `GITHUB_OAUTH_CLIENT_ID` in `wrangler.jsonc`, then store the client and cookie-encryption secrets in Workers:

```bash
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
openssl rand -hex 32 | npx wrangler secret put GITHUB_SESSION_SECRET
```

When a room has shared file changes, **Create PR** writes Git blobs and a tree on top of the room's pinned commit, creates a uniquely named `relay/…` branch, and opens the pull request against the selected base branch. If the authenticated user cannot push to the upstream repository, Relay creates or reuses that user's fork first. The resulting PR URL is persisted in the Durable Object and broadcast to every participant.

## Live OpenCode mode

Production is configured for OpenCode Zen's Ox Alpha Free model (`opencode/x-preview-f-free`). To run live locally:

```bash
cp .dev.vars.example .dev.vars
# Set OPENCODE_MODE=live and OPENCODE_ZEN_API_KEY in .dev.vars
pnpm dev
```

For production, store the key as a Worker secret:

```bash
pnpm wrangler secret put OPENCODE_ZEN_API_KEY
```

The key is available only to the Worker and is passed into OpenCode's provider configuration inside the Durable Object. It is never sent to the browser. OpenCode's SDK is dynamically loaded on first room use, keeping Worker startup below Cloudflare's validation limit.

Relay deliberately configures the V2 permission rule `{ action: "*", resource: "*", effect: "allow" }` and forces plugin permission evaluations to `allow`. This is dangerous mode: repository edits do not pause for maintainer approval. Tool inputs, outputs, and resulting diffs remain visible and persistent to every participant.

## Verify and deploy

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm deploy
```

Deployed app: [relay-multiplayer-agent.aranlucas.workers.dev](https://relay-multiplayer-agent.aranlucas.workers.dev)

The generated UI concepts are retained in [`design/`](design/) and the browser-verified implementation screenshots are in [`artifacts/`](artifacts/).
