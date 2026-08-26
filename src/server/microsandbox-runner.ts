import {
  parseWorkspaceChanges,
  type WorkspaceChange,
} from "../shared/workspace-change";

export type { WorkspaceChange } from "../shared/workspace-change";

export interface MicrosandboxRunnerEnv {
  MICROSANDBOX_RUNNER_URL?: string;
  MICROSANDBOX_RUNNER_TOKEN?: string;
}

export interface NativeTurnRequest {
  roomID: string;
  repository: string;
  commitSHA: string;
  changes: WorkspaceChange[];
  prompt: string;
  delivery: "steer" | "queue";
  model: string;
  sessionID?: string;
  after?: string;
  timeoutMs?: number;
}

export type NativeRunnerEvent =
  | { type: "status"; message: string }
  | { type: "session"; sessionID: string }
  | { type: "opencode"; cursor?: string; event: Record<string, unknown> }
  | { type: "changes"; changes: WorkspaceChange[] }
  | {
      type: "result";
      status: "succeeded" | "failed" | "interrupted";
      durationMs: number;
    };

export interface NativeTurnResult {
  sessionID: string;
  status: "succeeded" | "failed" | "interrupted";
  changes: WorkspaceChange[];
  cursor?: string;
}

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

  async turn(
    request: NativeTurnRequest,
    onEvent?: (event: NativeRunnerEvent) => void | Promise<void>,
  ): Promise<NativeTurnResult> {
    const response = await this.fetcher(
      new URL("/v1/opencode/turn", this.endpoint()),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(
          Math.min((request.timeoutMs ?? 600_000) + 60_000, 960_000),
        ),
      },
    );
    if (!response.ok || !response.body)
      throw new Error(await runnerFailure(response, "rejected the turn"));

    let sessionID = request.sessionID;
    let changes: WorkspaceChange[] | undefined;
    let status: NativeTurnResult["status"] | undefined;
    let cursor = request.after;
    await readNDJSON(response.body, async (line) => {
      const event = parseNativeRunnerEvent(line);
      await onEvent?.(event);
      if (event.type === "session") sessionID = event.sessionID;
      if (event.type === "changes") changes = event.changes;
      if (event.type === "opencode" && event.cursor) cursor = event.cursor;
      if (event.type === "result") status = event.status;
    });
    if (!sessionID) throw new Error("Runner ended without an OpenCode session");
    if (!changes) throw new Error("Runner ended without workspace changes");
    if (!status) throw new Error("Runner ended without a turn result");
    return { sessionID, changes, status, cursor };
  }

  async interrupt(roomID: string, sessionID: string): Promise<void> {
    const response = await this.fetcher(
      new URL("/v1/opencode/interrupt", this.endpoint()),
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ roomID, sessionID }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(await runnerFailure(response, "failed to interrupt"));
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.env.MICROSANDBOX_RUNNER_TOKEN}`,
      "Content-Type": "application/json",
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
    )
      throw new Error("Microsandbox runner must use HTTPS unless it is local");
    return endpoint;
  }
}

export function parseNativeRunnerEvent(line: string): NativeRunnerEvent {
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
  if (event.type === "session" && typeof event.sessionID === "string")
    return { type: "session", sessionID: event.sessionID };
  if (event.type === "opencode" && isRecord(event.event))
    return {
      type: "opencode",
      event: event.event,
      cursor: typeof event.cursor === "string" ? event.cursor : undefined,
    };
  if (event.type === "changes")
    return { type: "changes", changes: parseWorkspaceChanges(event.changes) };
  if (
    event.type === "result" &&
    (event.status === "succeeded" ||
      event.status === "failed" ||
      event.status === "interrupted") &&
    typeof event.durationMs === "number"
  )
    return {
      type: "result",
      status: event.status,
      durationMs: event.durationMs,
    };
  throw new Error("Microsandbox runner returned an unsupported event");
}

async function readNDJSON(
  body: ReadableStream<Uint8Array>,
  consume: (line: string) => Promise<void>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) await consume(line);
    if (done) break;
  }
  if (buffer.trim()) await consume(buffer);
}

async function runnerFailure(response: Response, label: string) {
  const detail = (await response.text()).slice(0, 2_000);
  return `Microsandbox runner ${label} (${response.status}): ${detail || response.statusText}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
