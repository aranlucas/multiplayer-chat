import { Plugin } from "@opencode-ai/plugin";
import { MAX_WORKSPACE_FILE_BYTES } from "../shared/workspace-change";
import { replaceExact } from "../shared/exact-edit";
import { RailwayRoomSandbox } from "./railway-sandbox";

const WORKSPACE_DIRECTORY = "/workspace/repository";
const MAX_TOOL_OUTPUT = 60_000;
const DEFAULT_TIMEOUT = 120_000;

interface RailwayToolDependencies {
  sandbox: RailwayRoomSandbox;
  ensureWorkspace: () => Promise<unknown>;
  checkpointWorkspace: () => Promise<unknown>;
}

export function railwayTools({
  sandbox,
  ensureWorkspace,
  checkpointWorkspace,
}: RailwayToolDependencies) {
  return Plugin.define({
    id: "relay.railway-tools",
    async setup(ctx) {
      await ctx.tool.transform((draft) => {
        for (const name of ["patch", "file_diff", "file-diff"])
          draft.remove(name);

        draft.add({
          name: "shell",
          description:
            "Run a Bash command in the room's isolated Railway sandbox. Commands execute in /workspace/repository by default. Long commands can be detached and later reattached by sessionName.",
          input: {
            type: "object",
            properties: {
              command: { type: "string" },
              workdir: { type: "string" },
              timeout: {
                type: "integer",
                minimum: 1_000,
                maximum: 900_000,
              },
              background: { type: "boolean" },
              sessionName: { type: "string" },
            },
            additionalProperties: false,
            oneOf: [{ required: ["command"] }, { required: ["sessionName"] }],
          },
          options: { codemode: false },
          execute: async (raw, tool) => {
            const input = asRecord(raw);
            await ensureWorkspace();
            await tool.progress({ status: "running in Railway Sandbox" });
            const timeout = optionalInteger(input.timeout) ?? DEFAULT_TIMEOUT;
            const sessionName = optionalString(input.sessionName);
            if (sessionName) {
              const result = await sandbox.reattach(sessionName, { timeout });
              await checkpointWorkspace();
              return { content: formatCommandResult(result) };
            }
            const command = requiredString(input.command, "command");
            const cwd = resolveWorkspacePath(
              optionalString(input.workdir) ?? WORKSPACE_DIRECTORY,
            );
            if (input.background === true) {
              const detached = await sandbox.detach(command, { cwd, timeout });
              return {
                content: `Command is running in the background. Reattach with sessionName: ${detached}`,
                metadata: { sessionName: detached, background: true },
              };
            }
            const result = await sandbox.exec(command, { cwd, timeout });
            await checkpointWorkspace();
            return {
              content: formatCommandResult(result),
              metadata: {
                exitCode: result.exitCode,
                timedOut: result.timedOut,
                truncated: result.truncated,
              },
            };
          },
        });

        draft.add({
          name: "read",
          description:
            "Read a UTF-8 file or list a directory in the Railway workspace. Text lines are prefixed with 1-based line numbers.",
          input: {
            type: "object",
            properties: {
              path: { type: "string" },
              offset: { type: "integer", minimum: 1 },
              limit: { type: "integer", minimum: 1, maximum: 2_000 },
            },
            required: ["path"],
            additionalProperties: false,
          },
          options: { codemode: false },
          execute: async (raw) => {
            const input = asRecord(raw);
            await ensureWorkspace();
            const path = resolveWorkspacePath(
              requiredString(input.path, "path"),
            );
            const stat = await sandbox.stat(path);
            const offset = optionalInteger(input.offset) ?? 1;
            const limit = optionalInteger(input.limit) ?? 2_000;
            if (stat.isDir) {
              const entries = await sandbox.list(path);
              const content = entries
                .slice(offset - 1, offset - 1 + limit)
                .map((entry) => `${entry.isDir ? "d" : "f"} ${entry.name}`)
                .join("\n");
              return { content: truncate(content || "Directory is empty.") };
            }
            const content = await sandbox.readFile(path);
            const numbered = content
              .split("\n")
              .slice(offset - 1, offset - 1 + limit)
              .map((line, index) => `${offset + index}: ${line}`)
              .join("\n");
            return { content: truncate(numbered) };
          },
        });

        draft.add({
          name: "write",
          description:
            "Create or replace a UTF-8 file in the Railway workspace. Missing parent directories are created automatically.",
          input: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
          options: { codemode: false },
          execute: async (raw) => {
            const input = asRecord(raw);
            await ensureWorkspace();
            const path = resolveWorkspacePath(
              requiredString(input.path, "path"),
            );
            const content = requiredString(input.content, "content", true);
            ensureSize(path, content);
            await sandbox.writeFile(path, content);
            await checkpointWorkspace();
            return { content: `Wrote ${relativeWorkspacePath(path)}.` };
          },
        });

        draft.add({
          name: "edit",
          description:
            "Replace an exact string in a UTF-8 file in the Railway workspace. The old string must be unique unless replaceAll is true.",
          input: {
            type: "object",
            properties: {
              path: { type: "string" },
              oldString: { type: "string" },
              newString: { type: "string" },
              replaceAll: { type: "boolean" },
            },
            required: ["path", "oldString", "newString"],
            additionalProperties: false,
          },
          options: { codemode: false },
          execute: async (raw) => {
            const input = asRecord(raw);
            await ensureWorkspace();
            const path = resolveWorkspacePath(
              requiredString(input.path, "path"),
            );
            const current = await sandbox.readFile(path);
            const content = replaceExact(
              current,
              requiredString(input.oldString, "oldString"),
              requiredString(input.newString, "newString", true),
              input.replaceAll === true,
            );
            ensureSize(path, content);
            await sandbox.writeFile(path, content);
            await checkpointWorkspace();
            return { content: `Edited ${relativeWorkspacePath(path)}.` };
          },
        });

        draft.add({
          name: "glob",
          description:
            "Find files in the Railway workspace using a gitignore-style glob pattern.",
          input: {
            type: "object",
            properties: {
              pattern: { type: "string" },
              path: { type: "string" },
              limit: { type: "integer", minimum: 1, maximum: 2_000 },
            },
            required: ["pattern"],
            additionalProperties: false,
          },
          options: { codemode: false },
          execute: async (raw) => {
            const input = asRecord(raw);
            await ensureWorkspace();
            const pattern = requiredString(input.pattern, "pattern");
            const path = relativeWorkspacePath(
              resolveWorkspacePath(optionalString(input.path) ?? "."),
            );
            const limit = optionalInteger(input.limit) ?? 200;
            const result = await sandbox.exec(
              `rg --files --hidden --glob '!.git' --glob ${shellQuote(pattern)} -- ${shellQuote(path)} | head -n ${limit}`,
              {
                cwd: WORKSPACE_DIRECTORY,
                timeout: 30_000,
                retryOnInterrupted: true,
              },
            );
            if (!result.success)
              throw new Error(result.stderr || "File search failed");
            return { content: truncate(result.stdout || "No files found.") };
          },
        });

        draft.add({
          name: "grep",
          description:
            "Search UTF-8 repository files in the Railway workspace using a regular expression.",
          input: {
            type: "object",
            properties: {
              pattern: { type: "string" },
              path: { type: "string" },
              include: { type: "string" },
              limit: { type: "integer", minimum: 1, maximum: 2_000 },
            },
            required: ["pattern"],
            additionalProperties: false,
          },
          options: { codemode: false },
          execute: async (raw) => {
            const input = asRecord(raw);
            await ensureWorkspace();
            const path = relativeWorkspacePath(
              resolveWorkspacePath(optionalString(input.path) ?? "."),
            );
            const include = optionalString(input.include);
            const limit = optionalInteger(input.limit) ?? 200;
            const result = await sandbox.exec(
              `rg --line-number --column --color never --hidden --glob '!.git'${include ? ` --glob ${shellQuote(include)}` : ""} -- ${shellQuote(requiredString(input.pattern, "pattern"))} ${shellQuote(path)} | head -n ${limit}`,
              {
                cwd: WORKSPACE_DIRECTORY,
                timeout: 30_000,
                retryOnInterrupted: true,
              },
            );
            if (result.exitCode !== 0 && result.exitCode !== 1)
              throw new Error(result.stderr || "Repository search failed");
            return { content: truncate(result.stdout || "No matches found.") };
          },
        });
      });

      await ctx.session.hook("context", (event) => {
        event.system.push({
          type: "text",
          text: "The repository is mounted remotely at /workspace/repository in an isolated Railway Sandbox. Use the read, glob, grep, edit, write, and shell tools; all of them operate on that same remote workspace. Inspect evidence, implement requested changes, and run appropriate verification before finishing.",
        });
      });
    },
  });
}

function resolveWorkspacePath(value: string): string {
  const raw = value.startsWith("/") ? value : `${WORKSPACE_DIRECTORY}/${value}`;
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized = `/${parts.join("/")}`;
  if (
    normalized !== WORKSPACE_DIRECTORY &&
    !normalized.startsWith(`${WORKSPACE_DIRECTORY}/`)
  )
    throw new Error("Tool paths must stay inside /workspace/repository");
  return normalized;
}

function relativeWorkspacePath(path: string): string {
  if (path === WORKSPACE_DIRECTORY) return ".";
  return path.slice(WORKSPACE_DIRECTORY.length + 1);
}

function formatCommandResult(result: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}) {
  const sections = [
    result.stdout,
    result.stderr ? `stderr:\n${result.stderr}` : "",
    `exit code: ${result.exitCode ?? "unknown"}${result.timedOut ? " (timed out)" : ""}${result.truncated ? " (output truncated upstream)" : ""}`,
  ].filter(Boolean);
  return truncate(sections.join("\n"));
}

function ensureSize(path: string, content: string) {
  if (new TextEncoder().encode(content).byteLength > MAX_WORKSPACE_FILE_BYTES)
    throw new Error(`File is too large: ${relativeWorkspacePath(path)}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Tool input must be an object");
  return value as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  field: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && !value))
    throw new Error(
      `${field} must be a${allowEmpty ? "" : " non-empty"} string`,
    );
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function truncate(value: string): string {
  return value.length <= MAX_TOOL_OUTPUT
    ? value
    : `${value.slice(0, MAX_TOOL_OUTPUT)}\n… output truncated`;
}
