import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it, onTestFinished } from "vitest";
import { z } from "zod";

const run = promisify(execFile);

const project = fileURLToPath(new URL("../../", import.meta.url));

it("build:preview produces v1 output marked as a native Preview and readable by cf", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-preview-build-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await symlink(join(project, "node_modules"), join(directory, "node_modules"), "dir");

  const manifest = z
    .object({
      type: z.literal("module"),
      packageManager: z.string(),
      scripts: z.object({ "build:preview": z.string() }),
    })
    .parse(JSON.parse(await readFile(join(project, "package.json"), "utf8")));

  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));

  await Promise.all(["src", "preview", "e2e"].map((name) => mkdir(join(directory, name))));

  await Promise.all(
    [
      "vite.config.ts",
      "cloudflare.config.ts",
      "preview/cloudflare.config.ts",
      "e2e/cloudflare.config.ts",
    ].map((name) => copyFile(join(project, name), join(directory, name))),
  );

  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { skipLibCheck: true, types: [], noEmit: true },
      files: ["src/preview-worker.ts"],
    }),
  );
  await writeFile(
    join(directory, "src/preview-worker.ts"),
    'export default { fetch() { return new Response("preview"); } };\n',
  );
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><title>Preview build test</title>",
  );

  // Use the real package command and installed plugin, without sharing build output
  // with other tests or relying on a mock of Cloudflare's preview detection.
  await run("pnpm", ["run", "build:preview"], { cwd: directory, timeout: 25_000 });

  const output = z
    .object({
      producer: z.object({ name: z.string() }),
      buildContext: z.object({ isPreview: z.boolean(), mode: z.string() }),
    })
    .parse(
      JSON.parse(await readFile(join(directory, ".cloudflare/output/v1/config.json"), "utf8")),
    );

  assert.equal(output.producer.name, "@cloudflare/vite-plugin");
  assert.deepEqual(output.buildContext, { isPreview: true, mode: "relay-preview" });

  // Load the same prebuilt Worker through cf without uploading a Preview.
  await run(
    join(project, "node_modules/.bin/cf"),
    ["workers", "check", "--prebuilt", "--mode", "relay-preview"],
    { cwd: directory, timeout: 25_000 },
  );
}, 60_000);
