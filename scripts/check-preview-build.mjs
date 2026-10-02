import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = object(JSON.parse(await readFile(".cloudflare/output/v0/config.json", "utf8")));
const worker = object(
  JSON.parse(await readFile(".cloudflare/output/v0/workers/default/worker.config.json", "utf8")),
);
const env = object(worker.env);
const controlOrigin = object(env.RELAY_CONTROL_ORIGIN);

assert.equal(object(root.buildContext).isPreview, true, "Build must target native Worker Previews");
assert.equal(worker.name, "relay-multiplayer-agent", "Preview must belong to the main Worker");
assert.equal(controlOrigin.type, "text");
assert.equal(
  controlOrigin.value,
  "https://relay-multiplayer-agent.aranlucas.workers.dev",
  "Preview UI must retain the existing room service",
);
assert.equal(env.AGENT_ROOMS, undefined, "Preview must not create a separate room namespace");
console.log("Native Preview output targets the main Worker and existing room service.");

/** @param {unknown} value */
function object(value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return /** @type {Record<string, unknown>} */ (value);
}
