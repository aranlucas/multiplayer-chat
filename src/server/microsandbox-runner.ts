import {
  parseWorkspaceChanges,
  type WorkspaceChange,
} from "../shared/workspace-change";

export type { WorkspaceChange } from "../shared/workspace-change";

export interface MicrosandboxRunnerEnv {
  MICROSANDBOX_RUNNER_URL?: string;
  MICROSANDBOX_RUNNER_TOKEN?: string;
}

export interface ExecuteRequest {
  roomID: string;
  repository: string;
  commitSHA: string;
  changes: WorkspaceChange[];
  command: string;
  timeoutMs?: number;
}

export type RunnerEvent =
  | { type: "status"; message: string }
  | { type: "stdout" | "stderr"; data: string }
  | { type: "changes"; changes: WorkspaceChange[] }
  | { type: "result"; exitCode: number; durationMs: number };

export interface RunnerExecution {
  output: string;
  exitCode: number;
  changes: WorkspaceChange[];
}

const MAX_OUTPUT = 60_000;

export class MicrosandboxRunnerClient {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly env: MicrosandboxRunnerEnv,
    fetcher: typeof fetch = fetch,
  ) {
    this.fetcher = (input, init) => fetcher.call(globalThis, input, init);
  }

  get configured(): boolean {
    return Boolean(
      this.env.MICROSANDBOX_RUNNER_URL && this.env.MICROSANDBOX_RUNNER_TOKEN,
    );
  }

  async execute(
    request: ExecuteRequest,
    onEvent?: (event: RunnerEvent) => void | Promise<void>,
  ): Promise<RunnerExecution> {
    const endpoint = this.endpoint();
    const response = await this.fetcher(new URL("/v1/execute", endpoint), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.MICROSANDBOX_RUNNER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(
        Math.min((request.timeoutMs ?? 300_000) + 60_000, 660_000),
      ),
    });

    if (!response.ok || !response.body) {
      const detail = (await response.text()).slice(0, 2_000);
      throw new Error(
        `Microsandbox runner rejected the command (${response.status}): ${detail || response.statusText}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    let exitCode: number | undefined;
    let changes: WorkspaceChange[] | undefined;

    const consume = async (line: string) => {
      if (!line.trim()) return;
      const event = parseRunnerEvent(line);
      await onEvent?.(event);
      if (event.type === "stdout" || event.type === "stderr") {
        output = appendOutput(output, event.data);
      } else if (event.type === "changes") {
        changes = event.changes;
      } else if (event.type === "result") {
        exitCode = event.exitCode;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) await consume(line);
      if (done) break;
    }
    await consume(buffer);

    if (exitCode === undefined)
      throw new Error("Microsandbox runner ended without an exit result");
    if (!changes)
      throw new Error(
        output.trim() || "Microsandbox runner ended without workspace changes",
      );
    return {
      output: output.trim() || `Process exited ${exitCode}`,
      exitCode,
      changes,
    };
  }

  private endpoint(): URL {
    if (!this.configured)
      throw new Error("Microsandbox runner is not configured");
    const endpoint = new URL(this.env.MICROSANDBOX_RUNNER_URL!);
    if (
      endpoint.protocol !== "https:" &&
      endpoint.hostname !== "127.0.0.1" &&
      endpoint.hostname !== "localhost"
    ) {
      throw new Error("Microsandbox runner must use HTTPS unless it is local");
    }
    return endpoint;
  }
}

export function parseRunnerEvent(line: string): RunnerEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Microsandbox runner returned invalid streamed output");
  }
  if (!value || typeof value !== "object")
    throw new Error("Microsandbox runner returned an invalid event");
  const event = value as Record<string, unknown>;
  if (event.type === "status" && typeof event.message === "string")
    return { type: "status", message: event.message };
  if (
    (event.type === "stdout" || event.type === "stderr") &&
    typeof event.data === "string"
  ) {
    return { type: event.type, data: event.data };
  }
  if (event.type === "changes") {
    return {
      type: "changes",
      changes: parseWorkspaceChanges(event.changes),
    };
  }
  if (
    event.type === "result" &&
    Number.isInteger(event.exitCode) &&
    typeof event.durationMs === "number"
  ) {
    return {
      type: "result",
      exitCode: Number(event.exitCode),
      durationMs: event.durationMs,
    };
  }
  throw new Error("Microsandbox runner returned an unsupported event");
}

function appendOutput(current: string, chunk: string): string {
  const next = current + chunk;
  if (next.length <= MAX_OUTPUT) return next;
  return `… output truncated …\n${next.slice(next.length - MAX_OUTPUT)}`;
}
