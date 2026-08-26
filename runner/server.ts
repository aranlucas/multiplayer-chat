import { createServer, type ServerResponse } from "node:http";
import { MiB, NetworkPolicy, Sandbox } from "microsandbox";
import {
  parseExecuteRequest,
  type ExecuteRequest,
} from "./protocol";
import {
  MAX_WORKSPACE_CHANGE_BYTES,
  MAX_WORKSPACE_FILE_BYTES,
  parseGitChangePaths,
  parseWorkspaceChanges,
  type WorkspaceChange,
} from "../src/shared/workspace-change";

const port = parseInteger(
  process.env.MICROSANDBOX_RUNNER_PORT,
  7777,
  1,
  65_535,
);
const host = process.env.MICROSANDBOX_RUNNER_HOST ?? "127.0.0.1";
const token = process.env.MICROSANDBOX_RUNNER_TOKEN;
const image = process.env.MICROSANDBOX_IMAGE ?? "node:22-bookworm";
const maxBodyBytes = 2_000_000;
const locks = new Map<string, Promise<void>>();

if (!token || token.length < 32)
  throw new Error(
    "MICROSANDBOX_RUNNER_TOKEN must contain at least 32 characters",
  );

const server = createServer(async (request, response) => {
  try {
    if (request.headers.authorization !== `Bearer ${token}`) {
      sendJSON(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.url === "/health" && request.method === "GET") {
      sendJSON(response, 200, { ok: true, runtime: "microsandbox", image });
      return;
    }
    if (request.url !== "/v1/execute" || request.method !== "POST") {
      sendJSON(response, 404, { error: "Not found" });
      return;
    }
    const input = parseExecuteRequest(JSON.parse(await readBody(request)));
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    await withRoomLock(input.roomID, () => execute(input, response));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Runner request failed";
    if (!response.headersSent) sendJSON(response, 400, { error: message });
    else {
      writeEvent(response, { type: "stderr", data: `${message}\n` });
      writeEvent(response, { type: "result", exitCode: 1, durationMs: 0 });
      response.end();
    }
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `Relay Microsandbox runner listening on http://${host}:${port}\n`,
  );
});

async function execute(input: ExecuteRequest, response: ServerResponse) {
  const startedAt = Date.now();
  const sandboxName = `relay-${input.roomID}`;
  const { sandbox, reused } = await openSandbox(sandboxName);
  writeEvent(response, {
    type: "status",
    message: reused
      ? `Resumed ${sandboxName}`
      : `Booted ${sandboxName}`,
  });

  try {
    writeEvent(response, {
      type: "status",
      message: `Checking out ${input.repository}@${input.commitSHA.slice(0, 12)}`,
    });
    await prepareWorkspace(sandbox, input);
    const fs = sandbox.fs();
    for (const change of input.changes) {
      const fullPath = `/workspace/repository/${change.path}`;
      if (change.content === null) {
        if (await fs.exists(fullPath)) await fs.remove(fullPath);
        continue;
      }
      await checkedShell(
        sandbox,
        `mkdir -p ${shellQuote(parentDirectory(fullPath))}`,
        10_000,
      );
      await fs.write(fullPath, change.content);
    }
    if (input.changes.length) {
      writeEvent(response, {
        type: "status",
        message: `Applied ${input.changes.length} shared workspace change${input.changes.length === 1 ? "" : "s"}`,
      });
    }

    const command = `export PATH=/usr/local/lib/node_modules/corepack/shims:$PATH; ${input.command}`;
    writeEvent(response, { type: "status", message: `$ ${command}` });
    const stream = await sandbox.execStreamWith("sh", (exec) =>
      exec
        .args(["-lc", command])
        .cwd("/workspace/repository")
        .timeout(input.timeoutMs)
        .stdinNull(),
    );
    let exitCode = 1;
    const decoder = new TextDecoder();
    for await (const event of stream) {
      if (event.kind === "stdout" || event.kind === "stderr") {
        writeEvent(response, {
          type: event.kind,
          data: decoder.decode(event.data, { stream: true }),
        });
      } else if (event.kind === "exited") {
        exitCode = event.code;
      }
    }
    const changes = await collectWorkspaceChanges(sandbox, input.commitSHA);
    writeEvent(response, { type: "changes", changes });
    writeEvent(response, {
      type: "result",
      exitCode,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    await sandbox.stopWithTimeout(10_000).catch(() => undefined);
    response.end();
  }
}

async function openSandbox(sandboxName: string) {
  try {
    return { sandbox: await Sandbox.start(sandboxName), reused: true };
  } catch {
    const sandbox = await Sandbox.builder(sandboxName)
      .image(image)
      .cpus(2)
      .memory(MiB(2_048))
      .rootDisk(8_192)
      .maxDuration(720)
      .network((network) =>
        network.policy(NetworkPolicy.fromProfiles(["public"])),
      )
      .replaceWithTimeout(15_000)
      .create();
    return { sandbox, reused: false };
  }
}

async function prepareWorkspace(
  sandbox: Sandbox,
  input: ExecuteRequest,
) {
  const expectedRemote = `https://github.com/${input.repository}.git`;
  const existingRemote = await checkedShellOutput(
    sandbox,
    "git -C /workspace/repository remote get-url origin",
    10_000,
  ).catch(() => "");

  if (existingRemote.trim() !== expectedRemote) {
    await checkedShell(
      sandbox,
      `rm -rf /workspace/repository && mkdir -p /workspace && git clone --filter=blob:none --no-checkout ${shellQuote(expectedRemote)} /workspace/repository`,
      120_000,
    );
  }
  await checkedShell(
    sandbox,
    `git -C /workspace/repository fetch --filter=blob:none origin ${shellQuote(input.commitSHA)} && git -C /workspace/repository checkout --detach ${shellQuote(input.commitSHA)} && git -C /workspace/repository reset --hard ${shellQuote(input.commitSHA)} && git -C /workspace/repository clean -fd`,
    120_000,
  );
}

async function collectWorkspaceChanges(
  sandbox: Sandbox,
  baseCommitSHA: string,
): Promise<WorkspaceChange[]> {
  const nameStatus = await checkedShellOutput(
    sandbox,
    `git -C /workspace/repository diff --name-status -z ${shellQuote(baseCommitSHA)} --`,
    30_000,
  );
  const untracked = await checkedShellOutput(
    sandbox,
    "git -C /workspace/repository ls-files --others --exclude-standard -z",
    30_000,
  );
  const paths = parseGitChangePaths(nameStatus, untracked);
  const fs = sandbox.fs();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const changes: WorkspaceChange[] = [];
  let totalBytes = 0;

  for (const change of paths) {
    if (change.deleted) {
      changes.push({ path: change.path, content: null });
      continue;
    }
    const fullPath = `/workspace/repository/${change.path}`;
    const metadata = await fs.stat(fullPath);
    if (metadata.kind !== "file")
      throw new Error(`Changed path is not a regular file: ${change.path}`);
    if (metadata.size > MAX_WORKSPACE_FILE_BYTES)
      throw new Error(`Changed file is too large: ${change.path}`);
    const bytes = await fs.read(fullPath);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_WORKSPACE_CHANGE_BYTES)
      throw new Error("Workspace changes are too large");
    let content: string;
    try {
      content = decoder.decode(bytes);
    } catch {
      throw new Error(`Changed file is not UTF-8 text: ${change.path}`);
    }
    changes.push({ path: change.path, content });
  }
  return parseWorkspaceChanges(changes);
}

async function checkedShell(
  sandbox: Sandbox,
  command: string,
  timeoutMs: number,
) {
  const result = await sandbox.execWith("sh", (exec) =>
    exec.args(["-lc", command]).timeout(timeoutMs).stdinNull(),
  );
  if (!result.success)
    throw new Error(
      result.stderr().trim() ||
        result.stdout().trim() ||
        `Command exited with ${result.code}`,
    );
}

async function checkedShellOutput(
  sandbox: Sandbox,
  command: string,
  timeoutMs: number,
) {
  const result = await sandbox.execWith("sh", (exec) =>
    exec.args(["-lc", command]).timeout(timeoutMs).stdinNull(),
  );
  if (!result.success)
    throw new Error(
      result.stderr().trim() ||
        result.stdout().trim() ||
        `Command exited with ${result.code}`,
    );
  return result.stdout();
}

async function withRoomLock(roomID: string, operation: () => Promise<void>) {
  const previous = locks.get(roomID) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(roomID, queued);
  await previous;
  try {
    await operation();
  } finally {
    release();
    if (locks.get(roomID) === queued) locks.delete(roomID);
  }
}

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeEvent(response: ServerResponse, event: Record<string, unknown>) {
  response.write(`${JSON.stringify(event)}\n`);
}

function sendJSON(
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error("Invalid numeric runner setting");
  return parsed;
}
