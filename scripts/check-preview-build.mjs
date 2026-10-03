import { z } from "zod";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = z
  .object({ buildContext: z.object({ isPreview: z.boolean() }) })
  .parse(JSON.parse(await readFile(".cloudflare/output/v0/config.json", "utf8")));

const worker = z
  .object({
    name: z.string(),
    env: z.object({
      RELAY_CONTROL_ORIGIN: z.object({ type: z.string(), value: z.string() }),
      AGENT_ROOMS: z.never().optional(),
    }),
  })
  .parse(
    JSON.parse(await readFile(".cloudflare/output/v0/workers/default/worker.config.json", "utf8")),
  );

const env = worker.env;

const controlOrigin = env.RELAY_CONTROL_ORIGIN;

assert.equal(root.buildContext.isPreview, true, "Build must target native Worker Previews");

assert.equal(worker.name, "relay-multiplayer-agent", "Preview must belong to the main Worker");

assert.equal(controlOrigin.type, "text");

assert.equal(
  controlOrigin.value,
  "https://relay-multiplayer-agent.aranlucas.workers.dev",
  "Preview UI must retain the existing room service",
);

assert.equal(env.AGENT_ROOMS, undefined, "Preview must not create a separate room namespace");

console.log("Native Preview output targets the main Worker and existing room service.");
