import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import {
  MicrosandboxRunnerClient,
  type ExecutionTarget,
  type MicrosandboxRunnerEnv,
  type RunnerEvent,
  type WorkspaceChange,
} from "./microsandbox-runner";
import { applyUnifiedDiff } from "./unified-diff";

export interface WorkspaceEnv extends MicrosandboxRunnerEnv {
  Sandbox?: DurableObjectNamespace<Sandbox>;
}

interface WorkspaceRow {
  [key: string]: string | null;
  room_id: string;
  repository: string;
  branch: string;
  commit_sha: string | null;
  workspace_status: string;
}

export interface WorkspaceInfo {
  repository: string;
  branch: string;
  commitSHA: string;
  directory: string;
}

export interface PullRequestWorkspace extends WorkspaceInfo {
  changes: WorkspaceChange[];
}

const WORKSPACE_DIRECTORY = "/workspace/repository";
const MAX_TOOL_OUTPUT = 60_000;

export class RepositoryWorkspace {
  private preparing?: Promise<WorkspaceInfo>;
  private readonly runner: MicrosandboxRunnerClient;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: WorkspaceEnv,
  ) {
    this.runner = new MicrosandboxRunnerClient(env);
  }

  async ensureReady(): Promise<WorkspaceInfo> {
    if (!this.preparing) {
      this.preparing = this.prepare().finally(() => {
        this.preparing = undefined;
      });
    }
    return this.preparing;
  }

  async configure(repository: string, branch: string): Promise<WorkspaceInfo> {
    const normalizedRepository = validateRepository(repository);
    const normalizedBranch = validateBranch(branch);
    this.storage.sql.exec(
      "UPDATE relay_room SET repository = ?, branch = ?, commit_sha = NULL, workspace_status = 'cloning', workspace_error = NULL, pull_request_url = NULL, pull_request_branch = NULL WHERE singleton = 1",
      normalizedRepository,
      normalizedBranch,
    );
    if (this.env.Sandbox) {
      const sandbox = this.sandbox(this.room().room_id);
      await sandbox.exec(`rm -rf ${WORKSPACE_DIRECTORY}`, { timeout: 30_000 });
    } else {
      this.ensureRemoteSchema();
      this.storage.sql.exec("DELETE FROM relay_workspace_files");
      this.storage.sql.exec("DELETE FROM relay_workspace_changes");
    }
    return this.ensureReady();
  }

  async search(query: string): Promise<string> {
    const value = query.trim();
    if (!value || value.length > 300 || value.includes("\0"))
      throw new Error("Search query must be 1-300 characters");
    await this.ensureReady();
    if (!this.env.Sandbox) return this.searchRemote(value);
    const result = await this.sandbox(this.room().room_id).exec(
      `rg --line-number --column --color never --hidden --glob '!.git' --glob '!node_modules' --glob '!dist' --max-count 50 -- ${shellQuote(value)} .`,
      { cwd: WORKSPACE_DIRECTORY, timeout: 30_000 },
    );
    if (result.exitCode !== 0 && result.exitCode !== 1)
      throw new Error(compactFailure("Repository search failed", result));
    return truncate(result.stdout || "No matches found.");
  }

  async readFile(path: string): Promise<string> {
    const relativePath = validateRelativePath(path);
    await this.ensureReady();
    if (!this.env.Sandbox) {
      this.ensureRemoteSchema();
      const content = this.remoteFiles().get(relativePath);
      if (content === undefined)
        throw new Error(
          `File is not tracked by the selected repository: ${relativePath}`,
        );
      return numberLines(content);
    }
    const sandbox = this.sandbox(this.room().room_id);
    const tracked = await sandbox.exec(
      `git ls-files --error-unmatch -- ${shellQuote(relativePath)}`,
      {
        cwd: WORKSPACE_DIRECTORY,
        timeout: 15_000,
      },
    );
    if (!tracked.success)
      throw new Error(
        `File is not tracked by the selected repository: ${relativePath}`,
      );
    const file = await sandbox.readFile(
      `${WORKSPACE_DIRECTORY}/${relativePath}`,
    );
    const numbered = file.content
      .split("\n")
      .slice(0, 1_500)
      .map((line, index) => `${String(index + 1).padStart(6)} │ ${line}`)
      .join("\n");
    return truncate(numbered);
  }

  async diff(): Promise<string> {
    await this.ensureReady();
    if (!this.env.Sandbox) {
      this.ensureRemoteSchema();
      const changes = this.storage.sql
        .exec<{ path: string; original: string; content: string }>(
          "SELECT path, original, content FROM relay_workspace_changes ORDER BY path",
        )
        .toArray();
      if (!changes.length) return "Working tree is clean.";
      return truncate(
        changes
          .map((change) => {
            const before = change.original.split("\n").length;
            const after = change.content.split("\n").length;
            return ` M ${change.path} (${before} → ${after} lines)`;
          })
          .join("\n"),
      );
    }
    const result = await this.sandbox(this.room().room_id).exec(
      "git diff --stat && git diff --no-ext-diff --",
      {
        cwd: WORKSPACE_DIRECTORY,
        timeout: 30_000,
      },
    );
    if (!result.success)
      throw new Error(
        compactFailure("Unable to read the workspace diff", result),
      );
    return truncate(result.stdout || "Working tree is clean.");
  }

  async applyPatch(patch: string): Promise<string> {
    if (!patch.trim() || patch.length > 250_000)
      throw new Error("Patch must be between 1 and 250,000 characters");
    await this.ensureReady();
    if (!this.env.Sandbox) {
      const changed = this.applyRemotePatch(patch);
      return `${changed.map((path) => ` M ${path}`).join("\n")}\n${await this.diff()}`;
    }
    const sandbox = this.sandbox(this.room().room_id);
    const patchPath = `/tmp/relay-${crypto.randomUUID()}.patch`;
    await sandbox.writeFile(patchPath, patch);
    try {
      const result = await sandbox.exec(
        `git apply --whitespace=nowarn ${shellQuote(patchPath)}`,
        {
          cwd: WORKSPACE_DIRECTORY,
          timeout: 60_000,
        },
      );
      if (!result.success)
        throw new Error(compactFailure("Patch could not be applied", result));
      return this.diff();
    } finally {
      await sandbox.deleteFile(patchPath).catch(() => undefined);
    }
  }

  async runTests(
    target: ExecutionTarget,
    onEvent?: (event: RunnerEvent) => void | Promise<void>,
  ): Promise<string> {
    const workspace = await this.ensureReady();
    if (this.runner.configured) {
      return this.runner.execute(
        {
          roomID: this.room().room_id,
          repository: workspace.repository,
          commitSHA: workspace.commitSHA,
          changes: this.workspaceChanges(),
          target,
          timeoutMs: 300_000,
        },
        onEvent,
      );
    }
    if (!this.env.Sandbox) return this.checkRemoteSnapshot(target);
    const sandbox = this.sandbox(this.room().room_id);
    const packageFile = await sandbox
      .readFile(`${WORKSPACE_DIRECTORY}/package.json`)
      .catch(() => undefined);
    const packageJSON = packageFile
      ? (JSON.parse(packageFile.content) as {
          scripts?: Record<string, string>;
        })
      : undefined;
    const scripts = packageJSON?.scripts ?? {};
    const selected =
      target === "auto"
        ? ["test", "typecheck", "build"].find((name) => scripts[name])
        : target;

    let command: string;
    if (selected && scripts[selected]) {
      const dependencies = await sandbox.exec("test -d node_modules", {
        cwd: WORKSPACE_DIRECTORY,
        timeout: 5_000,
      });
      if (!dependencies.success) {
        const install = await sandbox.exec(await this.installCommand(sandbox), {
          cwd: WORKSPACE_DIRECTORY,
          timeout: 300_000,
        });
        if (!install.success)
          throw new Error(
            compactFailure("Dependency installation failed", install),
          );
      }
      command = `npm run ${shellQuote(selected)}`;
    } else {
      command =
        "git ls-files -z '*.js' '*.mjs' '*.cjs' | xargs -0 -r -n1 node --check";
    }

    const result = await sandbox.exec(command, {
      cwd: WORKSPACE_DIRECTORY,
      timeout: 300_000,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (!result.success)
      throw new Error(
        truncate(output || `Command exited with ${result.exitCode}`),
      );
    return truncate(
      output ||
        `✓ ${selected ? `npm run ${selected}` : "JavaScript syntax checks"} passed`,
    );
  }

  async runCommand(
    command: string,
    onEvent?: (event: RunnerEvent) => void | Promise<void>,
  ): Promise<string> {
    const value = command.trim();
    if (!value || value.length > 4_000 || value.includes("\0"))
      throw new Error("Command must be between 1 and 4,000 characters");
    const workspace = await this.ensureReady();
    if (this.runner.configured) {
      try {
        return await this.runner.execute(
          {
            roomID: this.room().room_id,
            repository: workspace.repository,
            commitSHA: workspace.commitSHA,
            changes: this.workspaceChanges(),
            command: value,
            timeoutMs: 300_000,
          },
          onEvent,
        );
      } catch (error) {
        console.error("Microsandbox command execution failed", error);
        throw error;
      }
    }
    if (!this.env.Sandbox)
      throw new Error(
        "Full command execution requires the free Microsandbox runner to be online",
      );
    const result = await this.sandbox(this.room().room_id).exec(value, {
      cwd: WORKSPACE_DIRECTORY,
      timeout: 300_000,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (!result.success)
      throw new Error(
        truncate(output || `Command exited with ${result.exitCode}`),
      );
    return truncate(output || "✓ Command passed");
  }

  async pullRequestWorkspace(): Promise<PullRequestWorkspace> {
    const workspace = await this.ensureReady();
    const changes = this.workspaceChanges();
    if (!changes.length)
      throw new Error(
        "There are no shared workspace changes to put in a pull request",
      );
    return { ...workspace, changes };
  }

  private async installCommand(
    sandbox: ReturnType<typeof getSandbox>,
  ): Promise<string> {
    const files = await sandbox.listFiles(WORKSPACE_DIRECTORY);
    const names = new Set(files.files.map((file) => file.name));
    if (names.has("pnpm-lock.yaml"))
      return "corepack pnpm install --frozen-lockfile";
    if (names.has("yarn.lock")) return "corepack yarn install --immutable";
    if (names.has("bun.lock") || names.has("bun.lockb"))
      return "bun install --frozen-lockfile";
    if (names.has("package-lock.json")) return "npm ci";
    return "npm install";
  }

  private async prepare(): Promise<WorkspaceInfo> {
    const row = this.room();
    const repository = validateRepository(row.repository);
    const branch = validateBranch(row.branch);
    this.storage.sql.exec(
      "UPDATE relay_room SET workspace_status = 'cloning', workspace_error = NULL WHERE singleton = 1",
    );

    try {
      if (!this.env.Sandbox)
        return await this.prepareRemote(repository, branch, row.commit_sha);
      const sandbox = this.sandbox(row.room_id);
      const current = await sandbox
        .exec("git rev-parse HEAD", {
          cwd: WORKSPACE_DIRECTORY,
          timeout: 10_000,
        })
        .catch(() => undefined);
      const remote = await sandbox
        .exec("git remote get-url origin", {
          cwd: WORKSPACE_DIRECTORY,
          timeout: 10_000,
        })
        .catch(() => undefined);
      const expectedRemote = `https://github.com/${repository}.git`;
      if (
        !current?.success ||
        remote?.stdout.trim().replace(/\.git$/, "") !==
          expectedRemote.replace(/\.git$/, "")
      ) {
        await sandbox.exec(`rm -rf ${WORKSPACE_DIRECTORY}`, {
          timeout: 30_000,
        });
        await sandbox.gitCheckout(expectedRemote, {
          branch,
          depth: 1,
          targetDir: WORKSPACE_DIRECTORY,
        });
      } else if (row.commit_sha && current.stdout.trim() !== row.commit_sha) {
        const checkout = await sandbox.exec(
          `git checkout --detach ${shellQuote(row.commit_sha)}`,
          {
            cwd: WORKSPACE_DIRECTORY,
            timeout: 30_000,
          },
        );
        if (!checkout.success)
          throw new Error(
            compactFailure("Unable to restore the pinned commit", checkout),
          );
      }

      const resolved = await sandbox.exec("git rev-parse HEAD", {
        cwd: WORKSPACE_DIRECTORY,
        timeout: 10_000,
      });
      if (!resolved.success)
        throw new Error(
          compactFailure("Unable to resolve the repository commit", resolved),
        );
      const commitSHA = resolved.stdout.trim();
      this.storage.sql.exec(
        "UPDATE relay_room SET commit_sha = ?, workspace_status = 'ready', workspace_error = NULL WHERE singleton = 1",
        commitSHA,
      );
      return { repository, branch, commitSHA, directory: WORKSPACE_DIRECTORY };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Repository workspace failed to initialize";
      this.storage.sql.exec(
        "UPDATE relay_room SET workspace_status = 'error', workspace_error = ? WHERE singleton = 1",
        message.slice(0, 2_000),
      );
      throw error;
    }
  }

  private sandbox(roomID: string) {
    if (!this.env.Sandbox)
      throw new Error("Cloudflare Sandbox binding is unavailable");
    return getSandbox(this.env.Sandbox, `relay-${roomID}`.slice(0, 63), {
      normalizeId: true,
      sleepAfter: "10m",
    });
  }

  private room(): WorkspaceRow {
    return this.storage.sql
      .exec<WorkspaceRow>("SELECT * FROM relay_room WHERE singleton = 1")
      .one();
  }

  private ensureRemoteSchema() {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS relay_workspace_files (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_workspace_changes (
        path TEXT PRIMARY KEY,
        original TEXT NOT NULL,
        content TEXT NOT NULL
      );
    `);
  }

  private async prepareRemote(
    repository: string,
    branch: string,
    pinnedCommit: string | null,
  ): Promise<WorkspaceInfo> {
    this.ensureRemoteSchema();
    const existing = this.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM relay_workspace_files",
      )
      .one();
    let commitSHA = pinnedCommit;
    if (!commitSHA) {
      commitSHA = await resolveGitHubBranch(repository, branch);
    }

    if (!existing.count || !pinnedCommit) {
      const archive = await githubFetch(
        `https://codeload.github.com/${repository}/tar.gz/${commitSHA}`,
      );
      const compressed = archive.body;
      if (!compressed) throw new Error("GitHub repository archive was empty");
      const bytes = new Uint8Array(
        await new Response(
          compressed.pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
      );
      const files = readTarTextFiles(bytes);
      this.storage.sql.exec("DELETE FROM relay_workspace_files");
      for (const file of files) {
        this.storage.sql.exec(
          "INSERT INTO relay_workspace_files (path, content) VALUES (?, ?)",
          file.path,
          file.content,
        );
      }
    }

    this.storage.sql.exec(
      "UPDATE relay_room SET commit_sha = ?, workspace_status = 'ready', workspace_error = NULL WHERE singleton = 1",
      commitSHA,
    );
    return {
      repository,
      branch,
      commitSHA,
      directory: `github://${repository}@${commitSHA}`,
    };
  }

  private searchRemote(query: string): string {
    this.ensureRemoteSchema();
    const needle = query.toLowerCase();
    const matches: string[] = [];
    const files = [...this.remoteFiles()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
    for (const [path, content] of files) {
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const column = lines[index].toLowerCase().indexOf(needle);
        if (column >= 0)
          matches.push(`./${path}:${index + 1}:${column + 1}:${lines[index]}`);
        if (matches.length >= 50) return truncate(matches.join("\n"));
      }
    }
    return matches.length ? truncate(matches.join("\n")) : "No matches found.";
  }

  private checkRemoteSnapshot(
    target: "auto" | "test" | "typecheck" | "build",
  ): string {
    this.ensureRemoteSchema();
    const files = this.remoteFiles();
    const packageFile = files.get("package.json");
    if (packageFile) JSON.parse(packageFile);
    return [
      `✓ Workers-native ${target} preflight passed`,
      `✓ ${files.size} commit-pinned text files are readable`,
      packageFile
        ? "✓ package.json is valid JSON"
        : "• no package.json; package-script execution skipped",
      "• full command execution requires the free Microsandbox runner to be online",
    ].join("\n");
  }

  private workspaceChanges(): WorkspaceChange[] {
    this.ensureRemoteSchema();
    return this.storage.sql
      .exec<WorkspaceChange>(
        "SELECT path, content FROM relay_workspace_changes ORDER BY path",
      )
      .toArray();
  }

  private remoteFiles(): Map<string, string> {
    this.ensureRemoteSchema();
    const files = new Map(
      this.storage.sql
        .exec<{ path: string; content: string }>(
          "SELECT path, content FROM relay_workspace_files",
        )
        .toArray()
        .map((file) => [file.path, file.content] as const),
    );
    for (const change of this.storage.sql
      .exec<{ path: string; content: string }>(
        "SELECT path, content FROM relay_workspace_changes",
      )
      .toArray()) {
      files.set(change.path, change.content);
    }
    return files;
  }

  private applyRemotePatch(patch: string): string[] {
    this.ensureRemoteSchema();
    const files = this.remoteFiles();
    const changes = applyUnifiedDiff(files, patch);
    for (const change of changes) {
      const existing = this.storage.sql
        .exec<{ original: string }>(
          "SELECT original FROM relay_workspace_changes WHERE path = ?",
          change.path,
        )
        .toArray()[0];
      this.storage.sql.exec(
        "INSERT INTO relay_workspace_changes (path, original, content) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET content = excluded.content",
        change.path,
        existing?.original ?? change.original,
        change.content,
      );
    }
    this.storage.sql.exec(
      "UPDATE relay_room SET pull_request_url = NULL, pull_request_branch = NULL WHERE singleton = 1",
    );
    return changes.map((change) => change.path);
  }
}

async function githubFetch(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "relay-multiplayer-agent",
    },
  });
  if (!response.ok)
    throw new Error(
      `GitHub request failed (${response.status} ${response.statusText})`,
    );
  return response;
}

async function resolveGitHubBranch(
  repository: string,
  branch: string,
): Promise<string> {
  const response = await fetch(
    `https://github.com/${repository}.git/info/refs?service=git-upload-pack`,
    {
      headers: { "User-Agent": "relay-multiplayer-agent" },
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub refs request failed (${response.status} ${response.statusText})`,
    );
  const refs = new TextDecoder().decode(await response.arrayBuffer());
  const escapedBranch = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = refs.match(
    new RegExp(`([0-9a-f]{40}) refs/heads/${escapedBranch}(?:\\n|\\0)`),
  );
  if (!match) throw new Error(`GitHub branch was not found: ${branch}`);
  return match[1];
}

function readTarTextFiles(
  bytes: Uint8Array,
): Array<{ path: string; content: string }> {
  const decoder = new TextDecoder();
  const files: Array<{ path: string; content: string }> = [];
  let offset = 0;
  let totalBytes = 0;
  while (
    offset + 512 <= bytes.length &&
    files.length < 5_000 &&
    totalBytes < 20_000_000
  ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = decodeTarString(header.subarray(0, 100), decoder);
    const prefix = decodeTarString(header.subarray(345, 500), decoder);
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(
      decodeTarString(header.subarray(124, 136), decoder).trim() || "0",
      8,
    );
    const type = header[156];
    const dataOffset = offset + 512;
    const data = bytes.subarray(dataOffset, dataOffset + size);
    const slash = rawPath.indexOf("/");
    const path = slash >= 0 ? rawPath.slice(slash + 1) : rawPath;
    if (
      (type === 0 || type === 48) &&
      path &&
      size <= 500_000 &&
      !data.subarray(0, 8_192).includes(0)
    ) {
      const content = decoder.decode(data);
      files.push({ path, content });
      totalBytes += content.length;
    }
    offset = dataOffset + Math.ceil(size / 512) * 512;
  }
  if (!files.length)
    throw new Error("GitHub archive did not contain readable text files");
  return files;
}

function decodeTarString(bytes: Uint8Array, decoder: TextDecoder): string {
  const zero = bytes.indexOf(0);
  return decoder.decode(zero >= 0 ? bytes.subarray(0, zero) : bytes);
}

function numberLines(content: string): string {
  return truncate(
    content
      .split("\n")
      .slice(0, 1_500)
      .map((line, index) => `${String(index + 1).padStart(6)} │ ${line}`)
      .join("\n"),
  );
}

function validateRepository(value: string): string {
  const normalized = value
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error("Repository must be a public GitHub owner/name pair");
  }
  return normalized;
}

function validateBranch(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 200 ||
    normalized.startsWith("-") ||
    normalized.includes("..") ||
    normalized.includes("@{") ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) {
    throw new Error("Branch contains unsupported characters");
  }
  return normalized;
}

function validateRelativePath(value: string): string {
  const normalized = value.trim().replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.length > 500 ||
    normalized.startsWith("/") ||
    segments.includes("..") ||
    value.includes("\0")
  ) {
    throw new Error("File path must stay within the repository");
  }
  return normalized;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function compactFailure(
  label: string,
  result: { stdout: string; stderr: string; exitCode: number },
): string {
  const detail = [result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .trim();
  return truncate(
    `${label} (exit ${result.exitCode})${detail ? `\n${detail}` : ""}`,
  );
}

function truncate(value: string): string {
  if (value.length <= MAX_TOOL_OUTPUT) return value;
  return `${value.slice(0, MAX_TOOL_OUTPUT)}\n… output truncated by Relay`;
}
