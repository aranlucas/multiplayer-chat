import {
  parseWorkspaceChanges,
  type WorkspaceChange,
} from "../src/shared/workspace-change";

export type { WorkspaceChange } from "../src/shared/workspace-change";

export interface OpenCodeTurnRequest {
  roomID: string;
  repository: string;
  commitSHA: string;
  changes: WorkspaceChange[];
  prompt: string;
  delivery: "steer" | "queue";
  model: string;
  sessionID?: string;
  after?: string;
  timeoutMs: number;
}

export interface OpenCodeInterruptRequest {
  roomID: string;
  sessionID: string;
}

const ROOM_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SESSION_PATTERN = /^ses[A-Za-z0-9_-]+$/;
const MODEL_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:/-]+$/;

export function parseOpenCodeTurnRequest(
  value: unknown,
): OpenCodeTurnRequest {
  const input = parseBaseRequest(value);
  const prompt =
    typeof input.prompt === "string" ? input.prompt.trim() : undefined;
  if (!prompt || prompt.length > 8_000)
    throw new Error("Prompt must be between 1 and 8,000 characters");
  if (input.delivery !== "steer" && input.delivery !== "queue")
    throw new Error("Invalid delivery mode");
  if (typeof input.model !== "string" || !MODEL_PATTERN.test(input.model))
    throw new Error("Invalid OpenCode model");
  const sessionID = optionalSessionID(input.sessionID);
  const after = optionalCursor(input.after);
  const timeoutMs =
    typeof input.timeoutMs === "number" ? Math.floor(input.timeoutMs) : 600_000;
  if (timeoutMs < 1_000 || timeoutMs > 900_000)
    throw new Error("Timeout must be between 1 and 900 seconds");
  return {
    roomID: parseRoomID(input.roomID),
    repository: parseRepository(input.repository),
    commitSHA: parseCommit(input.commitSHA),
    changes: parseWorkspaceChanges(input.changes),
    prompt,
    delivery: input.delivery,
    model: input.model,
    sessionID,
    after,
    timeoutMs,
  };
}

export function parseOpenCodeInterruptRequest(
  value: unknown,
): OpenCodeInterruptRequest {
  const input = parseBaseRequest(value);
  return {
    roomID: parseRoomID(input.roomID),
    sessionID: requiredSessionID(input.sessionID),
  };
}

function parseBaseRequest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object")
    throw new Error("Request body must be an object");
  return value as Record<string, unknown>;
}

function parseRoomID(value: unknown): string {
  if (typeof value !== "string" || !ROOM_PATTERN.test(value))
    throw new Error("Invalid room ID");
  return value;
}

function parseRepository(value: unknown): string {
  if (typeof value !== "string" || !REPOSITORY_PATTERN.test(value))
    throw new Error("Invalid GitHub repository");
  return value;
}

function parseCommit(value: unknown): string {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value))
    throw new Error("Invalid commit SHA");
  return value;
}

function optionalSessionID(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredSessionID(value);
}

function requiredSessionID(value: unknown): string {
  if (typeof value !== "string" || !SESSION_PATTERN.test(value))
    throw new Error("Invalid OpenCode session ID");
  return value;
}

function optionalCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length > 200 ||
    !/^[A-Za-z0-9_.:-]+$/.test(value)
  )
    throw new Error("Invalid OpenCode event cursor");
  return value;
}
