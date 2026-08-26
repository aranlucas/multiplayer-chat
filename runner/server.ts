import { createServer, type ServerResponse } from "node:http";
import { MiB, NetworkPolicy, Sandbox } from "microsandbox";
import {
  parseOpenCodeInterruptRequest,
  parseOpenCodeTurnRequest,
  type OpenCodeTurnRequest,
} from "./protocol";
import {
  MAX_WORKSPACE_CHANGE_BYTES,
  MAX_WORKSPACE_FILE_BYTES,
  parseGitChangePaths,
  parseWorkspaceChanges,
  type WorkspaceChange,
} from "../src/shared/workspace-change";

const port = parseInteger(process.env.MICROSANDBOX_RUNNER_PORT, 7777, 1, 65_535);
const host = process.env.MICROSANDBOX_RUNNER_HOST ?? "127.0.0.1";
const token = process.env.MICROSANDBOX_RUNNER_TOKEN;
const image =
  process.env.MICROSANDBOX_IMAGE ??
  "ghcr.io/anomalyco/opencode:1.18.17";
const maxBodyBytes = 2_000_000;
const locks = new Map<string, Promise<void>>();
const activeRuntimes = new Map<
  string,
  {
    sandbox: Sandbox;
    server: Awaited<ReturnType<Sandbox["execStreamWith"]>>;
  }
>();

if (!token || token.length < 32)
  throw new Error("MICROSANDBOX_RUNNER_TOKEN must contain at least 32 characters");

const server = createServer(async (request, response) => {
  try {
    if (request.headers.authorization !== `Bearer ${token}`) {
      sendJSON(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.url === "/health" && request.method === "GET") {
      sendJSON(response, 200, {
        ok: true,
        runtime: "native-opencode-microsandbox",
        image,
      });
      return;
    }
    if (request.url === "/v1/opencode/interrupt" && request.method === "POST") {
      const input = parseOpenCodeInterruptRequest(
        JSON.parse(await readBody(request)),
      );
      const interrupted = await interrupt(input.roomID, input.sessionID);
      sendJSON(response, 200, { interrupted });
      return;
    }
    if (request.url === "/v1/opencode/turn" && request.method === "POST") {
      const input = parseOpenCodeTurnRequest(JSON.parse(await readBody(request)));
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      await withRoomLock(input.roomID, () => runTurn(input, response));
      return;
    }
    sendJSON(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runner request failed";
    if (!response.headersSent) sendJSON(response, 400, { error: message });
    else if (!response.writableEnded) {
      writeEvent(response, { type: "status", message: `Runner error: ${message}` });
      writeEvent(response, {
        type: "result",
        status: "failed",
        durationMs: 0,
      });
      response.end();
    }
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `Relay native OpenCode runner listening on http://${host}:${port}\n`,
  );
});

async function runTurn(input: OpenCodeTurnRequest, response: ServerResponse) {
  const startedAt = Date.now();
  const sandboxName = `relay-${input.roomID}`;
  const { sandbox, reused } = await openSandbox(sandboxName);
  writeEvent(response, {
    type: "status",
    message: reused ? `Resumed ${sandboxName}` : `Booted ${sandboxName}`,
  });

  let openCodeServer:
    | Awaited<ReturnType<Sandbox["execStreamWith"]>>
    | undefined;
  let terminalStatus: "succeeded" | "failed" | "interrupted" | undefined;
  let stderr = "";
  try {
    await prepareRuntime(sandbox, response);
    writeEvent(response, {
      type: "status",
      message: `Checking out ${input.repository}@${input.commitSHA.slice(0, 12)}`,
    });
    await prepareWorkspace(sandbox, input);
    await applyWorkspaceChanges(sandbox, input.changes);
    if (input.changes.length)
      writeEvent(response, {
        type: "status",
        message: `Applied ${input.changes.length} shared workspace change${input.changes.length === 1 ? "" : "s"}`,
      });

    openCodeServer = await startOpenCodeServer(sandbox, input.timeoutMs);
    activeRuntimes.set(input.roomID, { sandbox, server: openCodeServer });
    await waitForOpenCode(sandbox);
    writeEvent(response, {
      type: "status",
      message: "OpenCode is using its native repository tools in Microsandbox",
    });

    const bridgeInput = {
      sessionID: input.sessionID,
      after: input.after,
      prompt: input.prompt,
      delivery: input.delivery,
      model: parseModelRef(input.model),
    };
    const stream = await sandbox.execStreamWith("node", (exec) =>
      exec
        .args(["-e", OPEN_CODE_BRIDGE, JSON.stringify(bridgeInput)])
        .cwd("/workspace/repository")
        .timeout(input.timeoutMs)
        .stdinNull(),
    );
    const decoder = new TextDecoder();
    let stdoutBuffer = "";
    for await (const event of stream) {
      if (event.kind === "stdout") {
        stdoutBuffer += decoder.decode(event.data, { stream: true });
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = parseBridgeEvent(line);
          if (parsed.type === "terminal") terminalStatus = parsed.status;
          else writeEvent(response, parsed);
        }
      } else if (event.kind === "stderr") {
        stderr = appendBounded(stderr, decoder.decode(event.data, { stream: true }));
      }
    }
    if (stdoutBuffer.trim()) {
      const parsed = parseBridgeEvent(stdoutBuffer);
      if (parsed.type === "terminal") terminalStatus = parsed.status;
      else writeEvent(response, parsed);
    }
    if (!terminalStatus)
      throw new Error(stderr.trim() || "OpenCode ended without a terminal event");

    const changes = await collectWorkspaceChanges(sandbox, input.commitSHA);
    writeEvent(response, { type: "changes", changes });
    writeEvent(response, {
      type: "result",
      status: terminalStatus,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Native OpenCode turn failed";
    writeEvent(response, { type: "status", message: `Runner error: ${message}` });
    const changes = await collectWorkspaceChanges(sandbox, input.commitSHA).catch(
      () => input.changes,
    );
    writeEvent(response, { type: "changes", changes });
    writeEvent(response, {
      type: "result",
      status: terminalStatus ?? "failed",
      durationMs: Date.now() - startedAt,
    });
  } finally {
    activeRuntimes.delete(input.roomID);
    await openCodeServer?.kill().catch(() => undefined);
    await sandbox.stopWithTimeout(10_000).catch(() => undefined);
    response.end();
  }
}

async function interrupt(roomID: string, sessionID: string): Promise<boolean> {
  const active = activeRuntimes.get(roomID);
  if (!active) return false;
  const script = `const id=process.argv[1];const response=await fetch("http://127.0.0.1:4096/api/session/"+encodeURIComponent(id)+"/interrupt",{method:"POST"});if(!response.ok)throw new Error(await response.text());`;
  const result = await active.sandbox.execWith("node", (exec) =>
    exec
      .args(["-e", script, sessionID])
      .timeout(20_000)
      .stdinNull(),
  );
  if (!result.success)
    throw new Error(result.stderr().trim() || "OpenCode interrupt failed");
  return true;
}

async function openSandbox(sandboxName: string) {
  try {
    const handle = await Sandbox.get(sandboxName);
    const sandbox =
      handle.status === "running" ? await handle.connect() : await handle.start();
    return { sandbox, reused: true };
  } catch {
    const sandbox = await Sandbox.builder(sandboxName)
      .image(image)
      .cpus(2)
      .memory(MiB(2_048))
      .rootDisk(8_192)
      .maxDuration(960)
      .network((network) =>
        network.policy(NetworkPolicy.fromProfiles(["public"])),
      )
      .replaceWithTimeout(15_000)
      .create();
    return { sandbox, reused: false };
  }
}

async function prepareRuntime(sandbox: Sandbox, response: ServerResponse) {
  const probe = await sandbox.execWith("/bin/sh", (exec) =>
    exec
      .args([
        "-lc",
        "command -v opencode && command -v bash && command -v git && command -v node && command -v rg && command -v corepack",
      ])
      .timeout(10_000)
      .stdinNull(),
  );
  if (probe.success) return;
  writeEvent(response, {
    type: "status",
    message: "Provisioning Git, Bash, Node, Corepack, and ripgrep in the OpenCode image",
  });
  await checkedShell(
    sandbox,
    "apk add --no-cache bash git nodejs npm ripgrep && npm install --global corepack && corepack enable",
    180_000,
  );
}

async function startOpenCodeServer(sandbox: Sandbox, timeoutMs: number) {
  const config = JSON.stringify({
    permission: { "*": "allow" },
    instructions: [
      "You are working in /workspace/repository. Use OpenCode's native read, glob, grep, edit, write, and bash tools directly. Implement requested changes, inspect evidence, and run appropriate verification. The repository is isolated in Microsandbox and tools are allowed without approval.",
    ],
  });
  return sandbox.execStreamWith("opencode", (exec) =>
    exec
      .args(["serve", "--hostname", "127.0.0.1", "--port", "4096"])
      .env("OPENCODE_CONFIG_CONTENT", config)
      .cwd("/workspace/repository")
      .timeout(Math.min(timeoutMs + 60_000, 960_000))
      .stdinNull(),
  );
}

async function waitForOpenCode(sandbox: Sandbox) {
  const probe = `fetch("http://127.0.0.1:4096/global/health",{signal:AbortSignal.timeout(2000)}).then(response=>{if(!response.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await sandbox.execWith("node", (exec) =>
      exec.args(["-e", probe]).timeout(5_000).stdinNull(),
    );
    if (result.success) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("OpenCode server did not start");
}

async function prepareWorkspace(sandbox: Sandbox, input: OpenCodeTurnRequest) {
  const expectedRemote = `https://github.com/${input.repository}.git`;
  const existingRemote = await checkedShellOutput(
    sandbox,
    "git -C /workspace/repository remote get-url origin",
    10_000,
  ).catch(() => "");
  if (existingRemote.trim() !== expectedRemote)
    await checkedShell(
      sandbox,
      `rm -rf /workspace/repository && mkdir -p /workspace && git clone --filter=blob:none --no-checkout ${shellQuote(expectedRemote)} /workspace/repository`,
      120_000,
    );
  await checkedShell(
    sandbox,
    `git -C /workspace/repository fetch --filter=blob:none origin ${shellQuote(input.commitSHA)} && git -C /workspace/repository checkout --detach ${shellQuote(input.commitSHA)} && git -C /workspace/repository reset --hard ${shellQuote(input.commitSHA)} && git -C /workspace/repository clean -fd`,
    120_000,
  );
}

async function applyWorkspaceChanges(
  sandbox: Sandbox,
  changes: WorkspaceChange[],
) {
  const fs = sandbox.fs();
  for (const change of changes) {
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
  const result = await sandbox.execWith("/bin/sh", (exec) =>
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
  const result = await sandbox.execWith("/bin/sh", (exec) =>
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

function parseBridgeEvent(line: string): Record<string, unknown> & {
  type: string;
  status?: "succeeded" | "failed" | "interrupted";
} {
  const parsed = JSON.parse(line) as Record<string, unknown> & {
    type: string;
    status?: "succeeded" | "failed" | "interrupted";
  };
  if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string")
    throw new Error("OpenCode bridge returned an invalid event");
  return parsed;
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

function parseModelRef(value: string) {
  const [providerID, ...parts] = value.split("/");
  return { providerID, id: parts.join("/") };
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function appendBounded(current: string, chunk: string) {
  const next = current + chunk;
  return next.length <= 60_000 ? next : next.slice(-60_000);
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error("Invalid numeric runner setting");
  return parsed;
}

const OPEN_CODE_BRIDGE = String.raw`
const input = JSON.parse(process.argv[1]);
const base = "http://127.0.0.1:4096";
const headers = {
  "content-type": "application/json",
};
const request = async (path, init = {}) => {
  const response = await fetch(base + path, { ...init, headers: { ...headers, ...init.headers } });
  if (!response.ok) throw new Error(response.status + " " + (await response.text()));
  return response;
};
let sessionID = input.sessionID;
if (!sessionID) {
  const response = await request("/api/session", {
    method: "POST",
    body: JSON.stringify({
      agent: "build",
      model: input.model,
      location: { directory: "/workspace/repository" },
    }),
  });
  sessionID = (await response.json()).data.id;
}
console.log(JSON.stringify({ type: "session", sessionID }));
const eventURL = "/api/session/" + encodeURIComponent(sessionID) + "/event" +
  (input.after ? "?after=" + encodeURIComponent(input.after) : "");
const eventResponsePromise = request(eventURL, { headers: { accept: "text/event-stream" } });
await request("/api/session/" + encodeURIComponent(sessionID) + "/prompt", {
  method: "POST",
  body: JSON.stringify({
    prompt: { text: input.prompt },
    delivery: input.delivery,
  }),
});
const eventResponse = await eventResponsePromise;
const reader = eventResponse.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let terminal;
outer: while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const blocks = buffer.split("\n\n");
  buffer = blocks.pop() || "";
  for (const block of blocks) {
    let cursor;
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) cursor = line.slice(3).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    let event = JSON.parse(dataLines.join("\n"));
    if (typeof event === "string") event = JSON.parse(event);
    if (!cursor && event && typeof event === "object" && event.durable) {
      cursor = String(event.durable.seq || "") || undefined;
    }
    console.log(JSON.stringify({ type: "opencode", cursor, event }));
    const eventType = event && typeof event === "object"
      ? String(event.type || (event.event && event.event.type) || "")
      : "";
    if (eventType === "session.execution.succeeded") terminal = "succeeded";
    if (eventType === "session.execution.failed") terminal = "failed";
    if (eventType === "session.execution.interrupted") terminal = "interrupted";
    if (eventType === "session.next.step.ended" && event.data && event.data.finish !== "tool-calls") {
      terminal = "succeeded";
    }
    if (eventType === "session.next.step.failed") {
      const detail = JSON.stringify(event.data && event.data.error || "").toLowerCase();
      terminal = detail.includes("interrupt") || detail.includes("abort")
        ? "interrupted"
        : "failed";
    }
    if (eventType === "session.next.tool.failed") {
      const detail = JSON.stringify(event.data && event.data.error || "").toLowerCase();
      if (detail.includes("interrupt") || detail.includes("abort")) terminal = "interrupted";
    }
    if (terminal) break outer;
  }
}
await reader.cancel().catch(() => undefined);
if (!terminal) throw new Error("OpenCode event stream ended before execution completed");
console.log(JSON.stringify({ type: "terminal", status: terminal }));
`;
