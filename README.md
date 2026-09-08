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
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Oxlint runs with type information and rejects warnings. CI runs every verification command above. Use `pnpm lint:fix` and `pnpm format` for mechanical fixes, then run the complete checks.

The policy rejects unsafe `any` propagation, unhandled promises, async callbacks passed to synchronous APIs, non-null assertions, conditional hooks, incomplete effect dependencies, import cycles, focused/skipped tests, and assertions without an expected error message. Curly braces and strict equality make control flow explicit.

The few policy exceptions are deliberate: React uses the automatic JSX transform; inferred mock types remain allowed but unsafe mock usage is checked; valid ARIA roles need not be replaced with a different HTML element; test doubles may use empty classes. User-opened editors have narrowly documented autofocus exceptions. Generated bundles and Wrangler declarations are excluded.

## Deploy

```bash
pnpm deploy
```

Production uses a Cloudflare Worker for room state and a Railway Sandbox for each room's repository workspace.
