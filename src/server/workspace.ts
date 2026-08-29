import {
  MAX_WORKSPACE_CHANGE_BYTES,
  MAX_WORKSPACE_FILE_BYTES,
  parseGitChangePaths,
  parseWorkspaceChanges,
  type WorkspaceChange,
} from "../shared/workspace-change";
import { replaceExact } from "../shared/exact-edit";
import { RailwayRoomSandbox, type RailwaySandboxEnv } from "./railway-sandbox";

export type WorkspaceEnv = RailwaySandboxEnv;

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
  private readonly sandbox: RailwayRoomSandbox;

  constructor(
    private readonly storage: DurableObjectStorage,
    env: WorkspaceEnv,
    sandbox?: RailwayRoomSandbox,
  ) {
    this.sandbox = sandbox ?? new RailwayRoomSandbox(storage, env);
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
      "UPDATE relay_room SET repository = ?, branch = ?, commit_sha = NULL, workspace_status = 'cloning', workspace_error = NULL, opencode_session_id = NULL, opencode_event_cursor = NULL, workspace_revision = 0, published_workspace_revision = 0, pull_request_url = NULL, pull_request_number = NULL, pull_request_branch = NULL, pull_request_repository = NULL, pull_request_head_sha = NULL, github_credential = NULL WHERE singleton = 1",
      normalizedRepository,
      normalizedBranch,
    );
    if (this.sandbox.configured) {
      await this.sandbox.exec(`rm -rf ${WORKSPACE_DIRECTORY}`, {
        timeout: 30_000,
      });
    }
    this.ensureRemoteSchema();
    this.storage.sql.exec("DELETE FROM relay_workspace_files");
    this.storage.sql.exec("DELETE FROM relay_workspace_changes");
    this.storage.sql.exec("DELETE FROM relay_handoffs");
    this.storage.sql.exec("DELETE FROM relay_revisions");
    return this.ensureReady();
  }

  async search(query: string): Promise<string> {
    const value = query.trim();
    if (!value || value.length > 300 || value.includes("\0"))
      throw new Error("Search query must be 1-300 characters");
    await this.ensureReady();
    if (!this.sandbox.configured) return this.searchRemote(value);
    const result = await this.sandbox.exec(
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
    if (!this.sandbox.configured) {
      this.ensureRemoteSchema();
      const content = this.remoteFiles().get(relativePath);
      if (content === undefined)
        throw new Error(
          `File is not tracked by the selected repository: ${relativePath}`,
        );
      return numberLines(content);
    }
    const tracked = await this.sandbox.exec(
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
    const file = await this.sandbox.readFile(
      `${WORKSPACE_DIRECTORY}/${relativePath}`,
    );
    const numbered = file
      .split("\n")
      .slice(0, 1_500)
      .map((line, index) => `${String(index + 1).padStart(6)} │ ${line}`)
      .join("\n");
    return truncate(numbered);
  }

  async diff(): Promise<string> {
    await this.ensureReady();
    if (!this.sandbox.configured) {
      this.ensureRemoteSchema();
      const changes = this.storage.sql
        .exec<{
          path: string;
          original: string;
          content: string;
          deleted: number;
        }>(
          "SELECT path, original, content, deleted FROM relay_workspace_changes ORDER BY path",
        )
        .toArray();
      if (!changes.length) return "Working tree is clean.";
      return truncate(
        changes
          .map((change) => {
            if (change.deleted) return ` D ${change.path}`;
            const before = change.original.split("\n").length;
            const after = change.content.split("\n").length;
            return ` M ${change.path} (${before} → ${after} lines)`;
          })
          .join("\n"),
      );
    }
    const result = await this.sandbox.exec(
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

  async editFile(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<string> {
    const path = normalizeWorkspacePath(filePath);
    if (!oldString || oldString.length > 250_000)
      throw new Error("oldString must be between 1 and 250,000 characters");
    if (newString.length > 250_000)
      throw new Error("newString must not exceed 250,000 characters");
    if (oldString === newString)
      throw new Error("oldString and newString must be different");
    await this.ensureReady();
    if (this.sandbox.configured) {
      const file = await this.sandbox
        .readFile(`${WORKSPACE_DIRECTORY}/${path}`)
        .catch(() => undefined);
      if (!file) throw new Error(`File does not exist: ${path}`);
      const content = replaceExact(file, oldString, newString, replaceAll);
      ensureFileSize(path, content);
      await this.sandbox.writeFile(`${WORKSPACE_DIRECTORY}/${path}`, content);
      this.replaceWorkspaceChanges(await this.sandboxChanges());
    } else {
      const current = this.remoteFiles().get(path);
      if (current === undefined)
        throw new Error(`File does not exist: ${path}`);
      const content = replaceExact(current, oldString, newString, replaceAll);
      ensureFileSize(path, content);
      this.storeWorkspaceChange({ path, content });
    }
    return this.diff();
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

  async nativeAgentWorkspace(): Promise<PullRequestWorkspace> {
    const workspace = await this.ensureReady();
    return { ...workspace, changes: this.workspaceChanges() };
  }

  syncNativeAgentChanges(changes: WorkspaceChange[]) {
    this.replaceWorkspaceChanges(changes);
  }

  async syncSandboxChanges(): Promise<WorkspaceChange[]> {
    if (!this.sandbox.configured) return this.workspaceChanges();
    const changes = await this.sandboxChanges();
    this.replaceWorkspaceChanges(changes);
    return changes;
  }

  private async prepare(): Promise<WorkspaceInfo> {
    const row = this.room();
    const repository = validateRepository(row.repository);
    const branch = validateBranch(row.branch);
    this.storage.sql.exec(
      "UPDATE relay_room SET workspace_status = 'cloning', workspace_error = NULL WHERE singleton = 1",
    );

    try {
      if (!this.sandbox.configured)
        return await this.prepareRemote(repository, branch, row.commit_sha);
      const current = await this.sandbox
        .exec("git rev-parse HEAD", {
          cwd: WORKSPACE_DIRECTORY,
          timeout: 10_000,
        })
        .catch(() => undefined);
      const remote = await this.sandbox
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
        await this.sandbox.exec(`rm -rf ${WORKSPACE_DIRECTORY}`, {
          timeout: 30_000,
        });
        const clone = await this.sandbox.exec(
          `git clone --depth 1 --branch ${shellQuote(branch)} -- ${shellQuote(expectedRemote)} ${shellQuote(WORKSPACE_DIRECTORY)}`,
          { timeout: 120_000 },
        );
        if (!clone.success)
          throw new Error(
            compactFailure("Unable to clone the repository", clone),
          );
      } else if (row.commit_sha && current.stdout.trim() !== row.commit_sha) {
        const checkout = await this.sandbox.exec(
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

      const resolved = await this.sandbox.exec("git rev-parse HEAD", {
        cwd: WORKSPACE_DIRECTORY,
        timeout: 10_000,
      });
      if (!resolved.success)
        throw new Error(
          compactFailure("Unable to resolve the repository commit", resolved),
        );
      const commitSHA = resolved.stdout.trim();
      await this.applyStoredChanges();
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
        content TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      );
    `);
    const columns = this.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(relay_workspace_changes)")
      .toArray();
    if (!columns.some((column) => column.name === "deleted")) {
      this.storage.sql.exec(
        "ALTER TABLE relay_workspace_changes ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
      );
    }
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

  private workspaceChanges(): WorkspaceChange[] {
    this.ensureRemoteSchema();
    return this.storage.sql
      .exec<{ path: string; content: string; deleted: number }>(
        "SELECT path, content, deleted FROM relay_workspace_changes ORDER BY path",
      )
      .toArray()
      .map((change) => ({
        path: change.path,
        content: change.deleted ? null : change.content,
      }));
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
      .exec<{ path: string; content: string; deleted: number }>(
        "SELECT path, content, deleted FROM relay_workspace_changes",
      )
      .toArray()) {
      if (change.deleted) files.delete(change.path);
      else files.set(change.path, change.content);
    }
    return files;
  }

  private storeWorkspaceChange(change: WorkspaceChange) {
    this.ensureRemoteSchema();
    this.storage.sql.exec(
      "UPDATE relay_room SET pull_request_url = NULL, pull_request_branch = NULL WHERE singleton = 1",
    );
    const base = this.storage.sql
      .exec<{ content: string }>(
        "SELECT content FROM relay_workspace_files WHERE path = ?",
        change.path,
      )
      .toArray()[0];
    if (
      (base && change.content === base.content) ||
      (!base && change.content === null)
    ) {
      this.storage.sql.exec(
        "DELETE FROM relay_workspace_changes WHERE path = ?",
        change.path,
      );
      return;
    }
    const existing = this.storage.sql
      .exec<{ original: string }>(
        "SELECT original FROM relay_workspace_changes WHERE path = ?",
        change.path,
      )
      .toArray()[0];
    this.storage.sql.exec(
      "INSERT INTO relay_workspace_changes (path, original, content, deleted) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET content = excluded.content, deleted = excluded.deleted",
      change.path,
      existing?.original ?? base?.content ?? "",
      change.content ?? "",
      change.content === null ? 1 : 0,
    );
  }

  private replaceWorkspaceChanges(value: WorkspaceChange[]) {
    const changes = parseWorkspaceChanges(value);
    this.ensureRemoteSchema();
    this.storage.sql.exec(
      "UPDATE relay_room SET pull_request_url = NULL, pull_request_branch = NULL WHERE singleton = 1",
    );
    this.storage.sql.exec("DELETE FROM relay_workspace_changes");
    for (const change of changes) this.storeWorkspaceChange(change);
  }

  private async sandboxChanges(): Promise<WorkspaceChange[]> {
    const baseCommitSHA = this.room().commit_sha;
    if (!baseCommitSHA) throw new Error("Repository commit is not pinned");
    const nameStatus = await this.sandbox.exec(
      `git diff --name-status -z ${shellQuote(baseCommitSHA)} --`,
      { cwd: WORKSPACE_DIRECTORY, timeout: 30_000 },
    );
    if (!nameStatus.success)
      throw new Error(
        compactFailure("Unable to inspect changed files", nameStatus),
      );
    const untracked = await this.sandbox.exec(
      "git ls-files --others --exclude-standard -z",
      { cwd: WORKSPACE_DIRECTORY, timeout: 30_000 },
    );
    if (!untracked.success)
      throw new Error(
        compactFailure("Unable to inspect untracked files", untracked),
      );
    const paths = parseGitChangePaths(nameStatus.stdout, untracked.stdout);
    const changes: WorkspaceChange[] = [];
    let totalBytes = 0;
    for (const change of paths) {
      if (change.deleted) {
        changes.push({ path: change.path, content: null });
        continue;
      }
      const regular = await this.sandbox.exec(
        `test -f ${shellQuote(change.path)} && test ! -L ${shellQuote(change.path)}`,
        { cwd: WORKSPACE_DIRECTORY, timeout: 5_000 },
      );
      if (!regular.success)
        throw new Error(`Changed path is not a regular file: ${change.path}`);
      const file = await this.sandbox.readFile(
        `${WORKSPACE_DIRECTORY}/${change.path}`,
      );
      ensureFileSize(change.path, file);
      totalBytes += new TextEncoder().encode(file).byteLength;
      if (totalBytes > MAX_WORKSPACE_CHANGE_BYTES)
        throw new Error("Workspace changes are too large");
      changes.push({ path: change.path, content: file });
    }
    return parseWorkspaceChanges(changes);
  }

  private async applyStoredChanges(): Promise<void> {
    for (const change of this.workspaceChanges()) {
      const fullPath = `${WORKSPACE_DIRECTORY}/${change.path}`;
      if (change.content === null) {
        const removed = await this.sandbox.exec(
          `rm -f -- ${shellQuote(change.path)}`,
          { cwd: WORKSPACE_DIRECTORY, timeout: 10_000 },
        );
        if (!removed.success)
          throw new Error(
            compactFailure(`Unable to remove ${change.path}`, removed),
          );
        continue;
      }
      ensureFileSize(change.path, change.content);
      await this.sandbox.writeFile(fullPath, change.content);
    }
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

function normalizeWorkspacePath(value: string): string {
  const trimmed = value.trim();
  const relative = trimmed.startsWith(`${WORKSPACE_DIRECTORY}/`)
    ? trimmed.slice(WORKSPACE_DIRECTORY.length + 1)
    : trimmed;
  return validateRelativePath(relative);
}

function ensureFileSize(path: string, content: string) {
  if (new TextEncoder().encode(content).byteLength > MAX_WORKSPACE_FILE_BYTES)
    throw new Error(`Changed file is too large: ${path}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function compactFailure(
  label: string,
  result: { stdout: string; stderr: string; exitCode: number | null },
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
