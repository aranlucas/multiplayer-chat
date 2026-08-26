export type ExecutionTarget = "auto" | "test" | "typecheck" | "build";

export interface WorkspaceChange {
  path: string;
  content: string;
}

export interface ExecuteRequest {
  roomID: string;
  repository: string;
  commitSHA: string;
  changes: WorkspaceChange[];
  target?: ExecutionTarget;
  command?: string;
  timeoutMs: number;
}

const ROOM_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function parseExecuteRequest(value: unknown): ExecuteRequest {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.roomID !== "string" || !ROOM_PATTERN.test(input.roomID)) throw new Error("Invalid room ID");
  if (typeof input.repository !== "string" || !REPOSITORY_PATTERN.test(input.repository)) {
    throw new Error("Invalid GitHub repository");
  }
  if (typeof input.commitSHA !== "string" || !COMMIT_PATTERN.test(input.commitSHA)) throw new Error("Invalid commit SHA");
  if (!Array.isArray(input.changes) || input.changes.length > 500) throw new Error("Invalid workspace changes");
  const changes = input.changes.map(parseChange);
  const target = parseTarget(input.target);
  const command = typeof input.command === "string" ? input.command.trim() : undefined;
  if (command && command.length > 4_000) throw new Error("Command is too long");
  if (!command && !target) throw new Error("A command or test target is required");
  if (command && target) throw new Error("Choose either a command or test target");
  const timeoutMs = typeof input.timeoutMs === "number" ? Math.floor(input.timeoutMs) : 300_000;
  if (timeoutMs < 1_000 || timeoutMs > 600_000) throw new Error("Timeout must be between 1 and 600 seconds");
  return { roomID: input.roomID, repository: input.repository, commitSHA: input.commitSHA, changes, target, command, timeoutMs };
}

function parseChange(value: unknown): WorkspaceChange {
  if (!value || typeof value !== "object") throw new Error("Invalid workspace change");
  const change = value as Record<string, unknown>;
  if (typeof change.path !== "string" || !isSafePath(change.path)) throw new Error("Invalid changed file path");
  if (typeof change.content !== "string" || change.content.length > 500_000) throw new Error("Invalid changed file content");
  return { path: change.path, content: change.content };
}

function parseTarget(value: unknown): ExecutionTarget | undefined {
  return value === "auto" || value === "test" || value === "typecheck" || value === "build" ? value : undefined;
}

function isSafePath(path: string): boolean {
  return Boolean(path) && path.length <= 500 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");
}
