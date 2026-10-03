import { z } from "zod";

export interface WorkspaceChange {
  path: string;
  content: string | null;
}

interface GitChangePath {
  path: string;
  deleted: boolean;
}

export const MAX_WORKSPACE_CHANGES = 500;

export const MAX_WORKSPACE_FILE_BYTES = 500_000;

export const MAX_WORKSPACE_CHANGE_BYTES = 1_500_000;

const workspaceChangeSchema = z.object({
  path: z
    .string({ error: "Invalid changed file path" })
    .refine(isSafeWorkspacePath, "Invalid changed file path"),
  content: z.string({ error: "Invalid changed file content" }).nullable(),
});

const workspaceChangesSchema = z
  .array(workspaceChangeSchema, { error: "Invalid workspace changes" })
  .max(MAX_WORKSPACE_CHANGES, "Invalid workspace changes");

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the external checkpoint decoder; all paths and content are checked before workspace mutation.
export function parseWorkspaceChanges(value: unknown): WorkspaceChange[] {
  const changes = workspaceChangesSchema.parse(value);
  let totalBytes = 0;

  for (const change of changes) {
    if (change.content !== null) {
      const bytes = new TextEncoder().encode(change.content).byteLength;

      if (bytes > MAX_WORKSPACE_FILE_BYTES) {
        throw new Error("Invalid changed file content");
      }

      totalBytes += bytes;
    }
  }

  if (totalBytes > MAX_WORKSPACE_CHANGE_BYTES) {
    throw new Error("Workspace changes are too large");
  }

  return changes;
}

export function parseGitChangePaths(nameStatus: string, untracked: string): GitChangePath[] {
  const tokens = nameStatus.split("\0");
  const paths = new Map<string, GitChangePath>();
  let index = 0;

  while (index < tokens.length && tokens[index]) {
    const status = tokens[index++];
    const kind = status[0];

    if (kind === "R" || kind === "C") {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];

      if (!oldPath || !newPath) {
        throw new Error("Invalid Git change output");
      }

      if (kind === "R") {
        addPath(paths, oldPath, true);
      }

      addPath(paths, newPath, false);
      continue;
    }

    const path = tokens[index++];

    if (!path) {
      throw new Error("Invalid Git change output");
    }

    addPath(paths, path, kind === "D");
  }

  for (const path of untracked.split("\0")) {
    if (path) {
      addPath(paths, path, false);
    }
  }

  if (paths.size > MAX_WORKSPACE_CHANGES) {
    throw new Error("Too many workspace changes");
  }

  return [...paths.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function isSafeWorkspacePath(path: string): boolean {
  return (
    Boolean(path) &&
    path.length <= 500 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.split("/").includes("..")
  );
}

function addPath(paths: Map<string, GitChangePath>, path: string, deleted: boolean) {
  if (!isSafeWorkspacePath(path)) {
    throw new Error("Invalid changed file path");
  }

  paths.set(path, { path, deleted });
}
