# Relay

Relay is a multiplayer coding-agent room built on Cloudflare Durable Objects and native OpenCode runtimes in Microsandbox. One Durable Object owns one shared room, giving participants a stable identity, a single event order, hibernating WebSockets, and persistent SQLite history.

![Relay desktop session](artifacts/relay-desktop-local.png)

## What works

- Shared, ordered OpenCode session events and tool transcripts
- Real-time presence across multiple browser tabs or devices
- Immediate steering or queued follow-up prompts
- Dangerous always-allow tool execution with every side effect retained in the transcript
- Persistent room snapshots for late joiners
- Public GitHub repository selection, exact commit pinning, and durable native OpenCode workspaces
- Per-user GitHub OAuth and one-click pull request creation from the shared overlay
- Automatic updates to one room PR, exact-commit preview tracking, and seamless room handoff to the deployed build
- Hardware-isolated OpenCode, shell, and file tools through a self-hosted Microsandbox runner
- Responsive transcript, people, and queue views
- Local simulation mode for development without provider credentials
- Live OpenCode Zen using a configurable model (`hy3-free` by default)

## Architecture

```text
React client
  ├─ Production or stateless preview build
  ├─ One-time room handoff ticket
  ├─ GitHub OAuth + revision publishing
  └─ WebSocket to the stable Relay control plane
       └─ AgentRoom Durable Object (one per room name)
            ├─ Relay SQLite tables: room, events, participants, permissions
            ├─ Commit-pinned GitHub snapshot + mutable PR overlay
            ├─ Authenticated native OpenCode event stream
            ├─ Hibernating WebSocket fan-out
            └─ Per-room Microsandbox microVM
                 ├─ OpenCode server + persistent session database
                 ├─ Repository at `/workspace/repository`
                 ├─ OpenCode's native read/edit/write/bash tools
                 └─ Dangerous always-allow policy inside the microVM
```

Relay keeps collaboration state in Durable Object SQLite. OpenCode keeps its own session database on the per-room microVM disk. The runner streams OpenCode's durable events to Relay, which records a compact, UI-focused projection while retaining the raw payload. After each turn, the runner returns the Git change set to Relay's durable overlay for pull-request creation.

The Durable Object is the stable room authority even when the browser moves to a preview deployment. Preview builds are stateless Workers: after Relay verifies that a preview serves the exact published commit and room protocol, every participant receives a short-lived, one-time handoff ticket. The deployed client reconnects to the original room, preserving the transcript, presence, queue, workspace, and OpenCode session.

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

Production uses a Workers-native repository backend: it resolves public Git refs over Git smart HTTP, downloads the exact commit archive, and stores text files plus the room's mutable overlay in its Durable Object. This works on the Workers Free plan.

New rooms start from [`aranlucas/multiplayer-chat@main`](https://github.com/aranlucas/multiplayer-chat/tree/main). Maintainers can select a different public GitHub repository and branch from the header.

The self-hosted service in [`runner/`](runner/) gives each room its own hardware-isolated Linux microVM disk. OpenCode itself runs in that microVM beside the repository and invokes its built-in read, edit, write, search, and bash tools directly. Relay does not implement or proxy a model-facing Bash tool. Its runner only handles runtime lifecycle, authenticated prompt/event transport, exact-commit checkout, and Git-change synchronization.

Every turn resumes the disk, resets the repository to the exact Durable Object commit plus shared overlay, and starts the room's persistent OpenCode session. Ignored dependency directories and package caches survive between turns. Before shutdown the runner returns every tracked, untracked, modified, renamed, and deleted UTF-8 text file to the Worker. The bearer token stays in the Worker secret store and on the runner host; it is never sent to the browser.

## Microsandbox runner

Requirements: Node.js 22+ on Apple Silicon macOS, Linux with KVM, or Windows with WHP.

```bash
pnpm install
export MICROSANDBOX_RUNNER_TOKEN="$(openssl rand -hex 32)"
pnpm runner
```

The runner listens on `127.0.0.1:7777` by default. Expose it through a stable, authenticated HTTPS endpoint such as a named Cloudflare Tunnel; temporary `trycloudflare.com` hostnames are suitable only for local smoke tests. Then configure the Worker URL and secret:

```bash
npx wrangler secret put MICROSANDBOX_RUNNER_URL
npx wrangler secret put MICROSANDBOX_RUNNER_TOKEN
pnpm deploy
```

The default image is the pinned official `ghcr.io/anomalyco/opencode:1.18.17` image. On first room boot, the runner adds Bash, Git, Node, Corepack, and ripgrep. For production, publish a derived image with those packages preinstalled and set `MICROSANDBOX_IMAGE` to eliminate that first-boot provisioning delay.

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

When a room has shared file changes, **Create PR** writes Git blobs and a deletion-aware tree on top of the room's pinned commit, creates a uniquely named `relay/…` branch, and opens the pull request against the selected base branch. If the authenticated user cannot push to the upstream repository, Relay creates or reuses that user's fork first. Relay stores the credential encrypted with `GITHUB_SESSION_SECRET`; later successful turns append commits to the same PR automatically. Each commit becomes an immutable room revision and starts deployment observation.

## Seamless preview handoff

Relay uses two deployment surfaces because Cloudflare does not generate normal preview URLs for Workers that implement Durable Objects:

- `wrangler.jsonc` deploys the stable control plane and production client.
- `preview/wrangler.jsonc` deploys the stateless preview client.

Configure Cloudflare Workers Builds for non-production branches with this deploy command:

```bash
pnpm deploy:preview
```

The preview build requires these build variables/secrets:

```text
RELAY_CONTROL_ORIGIN=https://relay.com
RELAY_DEPLOYMENT_WEBHOOK_SECRET=<same secret configured on the control Worker>
```

Workers Builds supplies `WORKERS_CI_BRANCH` and `WORKERS_CI_COMMIT_SHA`. The publish script uploads a preview alias, waits for `/__relay/ready` to report that exact SHA, and calls the stable control plane. Relay then broadcasts the ready revision and moves connected participants to the deployed version. A later deployment on the same preview origin activates the revision and reloads the room; a versioned preview on a different origin uses a one-time ticket.

The complete two-origin flow can be tested without GitHub or OAuth:

```bash
pnpm dev:e2e --host 127.0.0.1
pnpm dev:preview --host 127.0.0.1

curl -X POST http://127.0.0.1:5176/api/rooms/local-loop/local-preview \
  -H 'Content-Type: application/json' \
  --data '{"previewURL":"http://127.0.0.1:5174","commitSHA":"local-preview"}'
```

Open `http://127.0.0.1:5176/r/local-loop` before calling the local-preview endpoint. The browser will move to port 5174 while its WebSocket remains attached to the room on port 5176.

## Live OpenCode mode

The checked-in default is OpenCode Zen's `opencode/hy3-free` model. A free model can run live locally without a Zen API key:

```bash
cp .dev.vars.example .dev.vars
# Set OPENCODE_MODE=live and MICROSANDBOX_RUNNER_TOKEN in .dev.vars.
# Start `pnpm runner` with the same token, then run `pnpm dev`.
pnpm dev
```

Relay configures OpenCode's native permission wildcard to `allow`. This is dangerous mode inside a hardware-isolated microVM: repository edits do not pause for maintainer approval, while tool inputs, outputs, and resulting diffs remain visible and persistent to every participant. The Pause action calls OpenCode's native interrupt API, which also terminates an active bash tool.

## Verify and deploy

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:preview
pnpm deploy
```

Deployed app: [relay-multiplayer-agent.aranlucas.workers.dev](https://relay-multiplayer-agent.aranlucas.workers.dev)

The generated UI concepts are retained in [`design/`](design/) and the browser-verified implementation screenshots are in [`artifacts/`](artifacts/).
