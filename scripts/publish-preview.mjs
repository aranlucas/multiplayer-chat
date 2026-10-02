import { spawnSync } from "node:child_process";

const branch = process.env.WORKERS_CI_BRANCH ?? process.env.GITHUB_HEAD_REF;
const commitSHA = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA;
const controlOrigin = process.env.RELAY_CONTROL_ORIGIN;
const webhookSecret = process.env.RELAY_DEPLOYMENT_WEBHOOK_SECRET;
const roomID = roomFromBranch(branch);

if (!branch || !commitSHA) {
  throw new Error("Preview publishing requires a branch and exact commit SHA");
}
if (branch === "main") {
  process.stdout.write("Skipping Preview publication for the production branch.\n");
  process.exit(0);
}
if (roomID && (!controlOrigin || !webhookSecret)) {
  throw new Error("RELAY_CONTROL_ORIGIN and RELAY_DEPLOYMENT_WEBHOOK_SECRET are required");
}

const upload = spawnSync(
  "pnpm",
  ["exec", "cf", "previews", "deploy", branch, "--prebuilt", "--mode", "relay-preview"],
  { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] },
);
const output = `${upload.stdout ?? ""}\n${upload.stderr ?? ""}`;
process.stdout.write(output);
if (upload.status !== 0) {
  await report({
    status: "failed",
    failure: "Cloudflare preview upload failed",
  });
  process.exit(upload.status ?? 1);
}

try {
  const deployment = readDeployment(upload.stdout ?? "");
  await waitUntilReady(deployment.previewURL, commitSHA);
  await report({ status: "ready", ...deployment });
} catch (error) {
  await report({
    status: "failed",
    failure: error instanceof Error ? error.message : "Preview publication failed",
  });
  throw error;
}

/** @param {string} stdout */
function readDeployment(stdout) {
  const result = /** @type {unknown} */ (JSON.parse(stdout));
  if (
    !result ||
    typeof result !== "object" ||
    !("type" in result) ||
    result.type !== "preview" ||
    !("version" in result) ||
    result.version !== 1 ||
    !("deployment_id" in result) ||
    typeof result.deployment_id !== "string" ||
    !result.deployment_id ||
    !("deployment_urls" in result) ||
    !Array.isArray(result.deployment_urls)
  ) {
    throw new Error("Cloudflare did not return a native Preview deployment");
  }
  const previewURL = result.deployment_urls.find((value) => typeof value === "string");
  if (!previewURL) {
    throw new Error("Cloudflare did not return an immutable deployment URL");
  }
  const url = new URL(previewURL);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Preview deployment URL must use HTTPS unless it is local");
  }
  return { previewURL: url.toString(), deploymentID: result.deployment_id };
}

/** @param {{ status: string; failure?: string; previewURL?: string; deploymentID?: string }} input */
async function report(input) {
  if (!roomID) {
    return;
  }
  const response = await fetch(new URL("/api/deployments", controlOrigin), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${webhookSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      roomID,
      commitSHA,
      provider: "cloudflare-workers-builds",
      ...input,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Relay rejected the preview callback (${response.status}): ${await response.text()}`,
    );
  }
}

/** @param {string} targetURL @param {string} expectedSHA */
async function waitUntilReady(targetURL, expectedSHA) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(new URL("/__relay/ready", targetURL), {
      signal: AbortSignal.timeout(8_000),
    }).catch(() => undefined);
    const result =
      /** @type {{ ready?: boolean; commitSHA?: string; roomProtocol?: number } | undefined} */ (
        await response?.json().catch(() => undefined)
      );
    if (
      response?.ok &&
      result?.ready === true &&
      result.commitSHA === expectedSHA &&
      result.roomProtocol === 1
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Preview did not become healthy with the published commit");
}

/** @param {string | undefined} value */
function roomFromBranch(value) {
  const match = value?.match(/^relay\/(.+)--[a-z0-9]+$/i);
  return match?.[1];
}
