import {
  parseWorkspaceChanges,
  type WorkspaceChange,
} from "../src/shared/workspace-change";

export type { WorkspaceChange } from "../src/shared/workspace-change";

export interface ExecuteRequest {
  roomID: string;
  repository: string;
  commitSHA: string;
  changes: WorkspaceChange[];
  command: string;
  timeoutMs: number;
}

const ROOM_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function parseExecuteRequest(value: unknown): ExecuteRequest {
  if (!value || typeof value !== "object")
    throw new Error("Request body must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.roomID !== "string" || !ROOM_PATTERN.test(input.roomID))
    throw new Error("Invalid room ID");
  if (
    typeof input.repository !== "string" ||
    !REPOSITORY_PATTERN.test(input.repository)
  ) {
    throw new Error("Invalid GitHub repository");
  }
  if (
    typeof input.commitSHA !== "string" ||
    !COMMIT_PATTERN.test(input.commitSHA)
  )
    throw new Error("Invalid commit SHA");
  const changes = parseWorkspaceChanges(input.changes);
  const command =
    typeof input.command === "string" ? input.command.trim() : undefined;
  if (command && command.length > 4_000) throw new Error("Command is too long");
  if (!command) throw new Error("A command is required");
  const timeoutMs =
    typeof input.timeoutMs === "number" ? Math.floor(input.timeoutMs) : 300_000;
  if (timeoutMs < 1_000 || timeoutMs > 600_000)
    throw new Error("Timeout must be between 1 and 600 seconds");
  return {
    roomID: input.roomID,
    repository: input.repository,
    commitSHA: input.commitSHA,
    changes,
    command,
    timeoutMs,
  };
}
