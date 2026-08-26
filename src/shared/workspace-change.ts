export interface WorkspaceChange {
  path: string;
  content: string | null;
}

export interface GitChangePath {
  path: string;
  deleted: boolean;
}

export const MAX_WORKSPACE_CHANGES = 500;
export const MAX_WORKSPACE_FILE_BYTES = 500_000;
export const MAX_WORKSPACE_CHANGE_BYTES = 1_500_000;

export function parseWorkspaceChanges(value: unknown): WorkspaceChange[] {
  if (!Array.isArray(value) || value.length > MAX_WORKSPACE_CHANGES)
    throw new Error("Invalid workspace changes");

  let totalBytes = 0;
  const changes = value.map((item) => {
    if (!item || typeof item !== "object")
      throw new Error("Invalid workspace change");
    const change = item as Record<string, unknown>;
    if (typeof change.path !== "string" || !isSafeWorkspacePath(change.path))
      throw new Error("Invalid changed file path");
    if (change.content !== null && typeof change.content !== "string")
      throw new Error("Invalid changed file content");
    if (typeof change.content === "string") {
      const bytes = new TextEncoder().encode(change.content).byteLength;
      if (bytes > MAX_WORKSPACE_FILE_BYTES)
        throw new Error("Invalid changed file content");
      totalBytes += bytes;
    }
    return { path: change.path, content: change.content } as WorkspaceChange;
  });

  if (totalBytes > MAX_WORKSPACE_CHANGE_BYTES)
    throw new Error("Workspace changes are too large");
  return changes;
}

export function parseGitChangePaths(
  nameStatus: string,
  untracked: string,
): GitChangePath[] {
  const tokens = nameStatus.split("\0");
  const paths = new Map<string, GitChangePath>();
  let index = 0;

  while (index < tokens.length && tokens[index]) {
    const status = tokens[index++];
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      if (!oldPath || !newPath) throw new Error("Invalid Git change output");
      if (kind === "R") addPath(paths, oldPath, true);
      addPath(paths, newPath, false);
      continue;
    }
    const path = tokens[index++];
    if (!path) throw new Error("Invalid Git change output");
    addPath(paths, path, kind === "D");
  }

  for (const path of untracked.split("\0")) {
    if (path) addPath(paths, path, false);
  }
  if (paths.size > MAX_WORKSPACE_CHANGES)
    throw new Error("Too many workspace changes");
  return [...paths.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
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

function addPath(
  paths: Map<string, GitChangePath>,
  path: string,
  deleted: boolean,
) {
  if (!isSafeWorkspacePath(path)) throw new Error("Invalid changed file path");
  paths.set(path, { path, deleted });
}
