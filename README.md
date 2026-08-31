# Relay

Relay is a multiplayer coding-agent room built with Cloudflare Durable Objects, OpenCode, and Railway Sandboxes.

## Run locally

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite. A local reconnect demo is available at `/r/reconnect-loop`.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Deploy

```bash
pnpm deploy
```

Production uses a Cloudflare Worker for room state and a Railway Sandbox for each room's repository workspace.
