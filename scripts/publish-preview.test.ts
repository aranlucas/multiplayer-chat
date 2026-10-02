import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it, onTestFinished } from "vitest";

interface PublisherOptions {
  branch?: string;
  webhookSecret?: string;
  readySHA?: string;
  cliResult?: { deployment_urls?: string[] };
  stdout?: string;
  uploadExit?: number;
}

interface ObservedRequest {
  url?: string;
  authorization?: string;
  body?: Record<string, unknown>;
}

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function parseCommand(text: string): string[] {
  const value: unknown = JSON.parse(text);
  assert.ok(Array.isArray(value));
  assert.ok(value.every((item: unknown): item is string => typeof item === "string"));
  return value;
}

const publisher = fileURLToPath(new URL("./publish-preview.mjs", import.meta.url));
const commitSHA = "1234567890abcdef1234567890abcdef12345678";

async function runPublisher(options: PublisherOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "relay-preview-test-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const requests: ObservedRequest[] = [];
  const server = createServer((request, response) => {
    let bodyText = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (bodyText += chunk));
    request.on("end", () => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        body: bodyText ? parseObject(bodyText) : undefined,
      });
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(
          request.url === "/api/deployments"
            ? { ok: true }
            : { ready: true, commitSHA: options.readySHA ?? commitSHA, roomProtocol: 1 },
        ),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const cliResult = {
    type: "preview",
    version: 1,
    preview_urls: [`${origin}/branch-latest`],
    deployment_id: "immutable-deployment",
    deployment_urls: [`${origin}/immutable-build`],
    ...options.cliResult,
  };
  const commandLog = join(directory, "command.json");
  await writeFile(
    join(directory, "pnpm"),
    `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(commandLog)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(${JSON.stringify(options.stdout ?? JSON.stringify(cliResult))});\nprocess.exit(${options.uploadExit ?? 0});\n`,
    { mode: 0o755 },
  );
  const timerFixture = join(directory, "fast-retries.mjs");
  await writeFile(
    timerFixture,
    "const schedule = globalThis.setTimeout; globalThis.setTimeout = (callback, delay, ...args) => schedule(callback, Math.min(delay, 1), ...args);\n",
  );
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    WORKERS_CI_BRANCH: options.branch ?? "relay/test-room--123abc",
    WORKERS_CI_COMMIT_SHA: commitSHA,
    RELAY_CONTROL_ORIGIN: origin,
    RELAY_DEPLOYMENT_WEBHOOK_SECRET: options.webhookSecret ?? "test-webhook",
  };
  const result = await new Promise<ChildResult>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", timerFixture, publisher], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => (stdout += data));
    child.stderr.on("data", (data: string) => (stderr += data));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  const command = await readFile(commandLog, "utf8")
    .then(parseCommand)
    .catch(() => undefined);
  return { ...result, requests, command, origin };
}

it("publishes a native Preview and reports its immutable deployment URL", async () => {
  const result = await runPublisher();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.command, [
    "exec",
    "cf",
    "previews",
    "deploy",
    "relay/test-room--123abc",
    "--prebuilt",
    "--mode",
    "relay-preview",
  ]);
  assert.deepEqual(
    result.requests.map((request) => request.url),
    ["/__relay/ready", "/api/deployments"],
  );
  assert.deepEqual(result.requests[1].body, {
    roomID: "test-room",
    commitSHA,
    provider: "cloudflare-workers-builds",
    status: "ready",
    previewURL: `${result.origin}/immutable-build`,
    deploymentID: "immutable-deployment",
  });
  assert.equal(result.requests[1].authorization, "Bearer test-webhook");
});

it("publishes non-Relay branches without calling the room webhook", async () => {
  const result = await runPublisher({ branch: "codex/native-worker-previews" });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.command?.includes("codex/native-worker-previews"));
  assert.deepEqual(
    result.requests.map((request) => request.url),
    ["/__relay/ready"],
  );
});

it("does not deploy the production branch through the preview publisher", async () => {
  const result = await runPublisher({ branch: "main" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.command, undefined);
  assert.deepEqual(result.requests, []);
});

it("refuses a room Preview before deployment when callback credentials are missing", async () => {
  const result = await runPublisher({ webhookSecret: "" });
  assert.notEqual(result.code, 0);
  assert.equal(result.command, undefined);
  assert.deepEqual(result.requests, []);
  assert.ok(result.stderr.includes("RELAY_DEPLOYMENT_WEBHOOK_SECRET are required"));
});

it("refuses a mutable branch URL when no deployment URL was returned", async () => {
  const result = await runPublisher({ cliResult: { deployment_urls: [] } });
  assert.notEqual(result.code, 0);
  assert.ok(!result.requests.some((request) => request.body?.status === "ready"));
});

it("rejects malformed deployment JSON", async () => {
  const result = await runPublisher({ stdout: "Cloudflare uploaded a preview" });
  assert.notEqual(result.code, 0);
  assert.ok(!result.requests.some((request) => request.body?.status === "ready"));
});

it("reports a failed native Preview upload", async () => {
  const result = await runPublisher({ uploadExit: 1 });
  assert.equal(result.code, 1);
  assert.equal(result.requests[0].body?.status, "failed");
});

it("never marks a different commit ready", async () => {
  const result = await runPublisher({ readySHA: "another-commit" });
  assert.notEqual(result.code, 0);
  const reports = result.requests.filter((request) => request.url === "/api/deployments");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].body?.status, "failed");
});
