import { spawnSync } from "node:child_process";

const branch = process.env.WORKERS_CI_BRANCH ?? process.env.GITHUB_HEAD_REF;
const commitSHA =
  process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA;
const controlOrigin = process.env.RELAY_CONTROL_ORIGIN;
const webhookSecret = process.env.RELAY_DEPLOYMENT_WEBHOOK_SECRET;
const roomID = roomFromBranch(branch);

if (!branch || !commitSHA) {
  throw new Error("Preview publishing requires a branch and exact commit SHA");
}
if (!roomID) {
  process.stdout.write(
    `Skipping room preview for non-Relay branch ${branch}.\n`,
  );
  process.exit(0);
}
if (!controlOrigin || !webhookSecret) {
  throw new Error(
    "RELAY_CONTROL_ORIGIN and RELAY_DEPLOYMENT_WEBHOOK_SECRET are required",
  );
}

const alias = `r-${commitSHA.slice(0, 12).toLowerCase()}`;
const upload = spawnSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "versions",
    "upload",
    "--config",
    "dist-preview/relay_multiplayer_preview/wrangler.json",
    "--preview-alias",
    alias,
  ],
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

const previewURL =
  output.match(/https:\/\/[^\s]+\.workers\.dev\/?/i)?.[0] ?? undefined;
if (!previewURL) {
  await report({
    status: "failed",
    failure: "Cloudflare did not return a preview URL",
  });
  throw new Error("Cloudflare did not return a preview URL");
}

await waitUntilReady(previewURL, commitSHA);
await report({ status: "ready", previewURL, deploymentID: alias });

async function report(input) {
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

async function waitUntilReady(previewURL, expectedSHA) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(new URL("/__relay/ready", previewURL)).catch(
      () => undefined,
    );
    const result = await response?.json().catch(() => undefined);
    if (
      response?.ok &&
      result?.ready === true &&
      result.commitSHA === expectedSHA &&
      result.roomProtocol === 1
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  await report({
    status: "failed",
    previewURL,
    failure: "Preview did not become healthy with the published commit",
  });
  throw new Error("Preview readiness check timed out");
}

function roomFromBranch(value) {
  const match = value?.match(/^relay\/(.+)--[a-z0-9]+$/i);
  return match?.[1];
}
