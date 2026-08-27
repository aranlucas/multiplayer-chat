import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd";
import type { OpenCodeModelOption } from "../shared/protocol";
import type { WorkspaceChange } from "../shared/workspace-change";
import { RailwayRoomSandbox } from "./railway-sandbox";
import { RepositoryWorkspace } from "./workspace";

export interface EmbeddedTurnRequest {
  roomID: string;
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

export interface EmbeddedTurnResult {
  sessionID: string;
  status: "succeeded" | "failed" | "interrupted";
  changes: WorkspaceChange[];
  cursor?: string;
}

export class EmbeddedOpenCodeRunner {
  constructor(
    private readonly host: Promise<OpenCodeWorkerd.Interface>,
    private readonly workspace: RepositoryWorkspace,
    private readonly sandbox: RailwayRoomSandbox,
  ) {}

  async turn(
    request: EmbeddedTurnRequest,
    onEvent?: (event: NativeRunnerEvent) => void | Promise<void>,
  ): Promise<EmbeddedTurnResult> {
    const startedAt = Date.now();
    const opencode = await this.host;
    await this.workspace.ensureReady();
    await onEvent?.({
      type: "status",
      message: "OpenCode is running in the room Durable Object",
    });

    const session = await this.resolveSession(
      opencode,
      request.sessionID,
      request.model,
    );
    await onEvent?.({ type: "session", sessionID: session.id });

    const controller = new AbortController();
    let cursor = request.after;
    let observedStatus: EmbeddedTurnResult["status"] | undefined;
    let deferredProviderError: Error | undefined;
    const eventTask = (async () => {
      try {
        for await (const event of opencode.events.subscribe({
          signal: controller.signal,
        })) {
          const record = event as unknown as Record<string, unknown>;
          if (eventSessionID(record) !== session.id) continue;
          const nextCursor = eventCursor(record);
          if (
            nextCursor &&
            cursor &&
            Number.isFinite(Number(nextCursor)) &&
            Number(nextCursor) <= Number(cursor)
          )
            continue;
          if (nextCursor) cursor = nextCursor;
          observedStatus = terminalStatus(record) ?? observedStatus;
          await onEvent?.({
            type: "opencode",
            cursor: nextCursor,
            event: record,
          });
          const providerError = deferredProviderFailure(record);
          if (providerError) {
            deferredProviderError = providerError;
            await opencode.sessions.interrupt({ sessionID: session.id });
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }
    })();

    let executionError: unknown;
    try {
      await opencode.sessions.prompt(
        {
          sessionID: session.id,
          text: request.prompt,
          delivery: request.delivery,
        },
        { signal: AbortSignal.timeout(request.timeoutMs ?? 900_000) },
      );
      await opencode.sessions.wait(
        { sessionID: session.id },
        { signal: AbortSignal.timeout(request.timeoutMs ?? 900_000) },
      );
    } catch (error) {
      executionError = error;
    } finally {
      controller.abort();
      await eventTask;
    }
    if (deferredProviderError) throw deferredProviderError;
    if (executionError) throw executionError;

    const latest = await opencode.sessions.get({ sessionID: session.id });
    const status = latest.outcome ?? observedStatus ?? "succeeded";
    const changes = await this.workspace.syncSandboxChanges();
    await onEvent?.({ type: "changes", changes });
    await onEvent?.({
      type: "result",
      status,
      durationMs: Date.now() - startedAt,
    });
    return { sessionID: session.id, status, changes, cursor };
  }

  async interrupt(sessionID: string): Promise<void> {
    const opencode = await this.host;
    await Promise.allSettled([
      opencode.sessions.interrupt({ sessionID }),
      this.sandbox.killActive(),
    ]);
  }

  async models(): Promise<OpenCodeModelOption[]> {
    const opencode = await this.host;
    const response = await opencode.model.list({
      location: { directory: "/workspace/repository" },
    });
    return response.data
      .filter(
        (model) =>
          model.enabled &&
          model.capabilities.tools &&
          model.status !== "deprecated",
      )
      .map((model) => ({
        id: `${model.providerID}/${model.modelID}`,
        name: model.name,
        providerID: model.providerID,
        free:
          model.cost.length > 0 &&
          model.cost.every(
            (cost) =>
              cost.input === 0 &&
              cost.output === 0 &&
              cost.cache.read === 0 &&
              cost.cache.write === 0,
          ),
      }))
      .sort((left, right) =>
        left.free === right.free
          ? left.name.localeCompare(right.name)
          : left.free
            ? -1
            : 1,
      );
  }

  private async resolveSession(
    opencode: OpenCodeWorkerd.Interface,
    sessionID: string | undefined,
    model: string,
  ) {
    if (sessionID) {
      const existing = await opencode.sessions
        .get({ sessionID })
        .catch(() => undefined);
      if (existing) {
        const modelRef = openCodeModelRef(model);
        if (
          existing.model?.providerID !== modelRef.providerID ||
          existing.model.id !== modelRef.id
        ) {
          await opencode.sessions.switchModel({
            sessionID: existing.id,
            model: modelRef,
          });
        }
        return existing;
      }
    }
    return opencode.sessions.create({
      agent: "build",
      model: openCodeModelRef(model),
      location: { directory: "/workspace/repository" },
    });
  }
}

export function openCodeModelRef(model: string) {
  const [providerID, ...modelParts] = model.split("/");
  if (!providerID || !modelParts.length || modelParts.some((part) => !part))
    throw new Error(`Invalid OpenCode model: ${model}`);
  return { providerID, id: modelParts.join("/") };
}

function deferredProviderFailure(
  event: Record<string, unknown>,
): Error | undefined {
  if (event.type !== "session.retry.scheduled") return undefined;
  const data = asRecord(event.data);
  const retryAt = typeof data.at === "number" ? data.at : 0;
  if (!retryAt || retryAt <= Date.now() + 60_000) return undefined;
  const providerError = asRecord(data.error);
  const message =
    typeof providerError.message === "string"
      ? providerError.message
      : "Provider request failed";
  return new Error(`OpenCode provider retry deferred too long: ${message}`);
}

function eventSessionID(event: Record<string, unknown>): string | undefined {
  const data = asRecord(event.data);
  return typeof data.sessionID === "string" ? data.sessionID : undefined;
}

function eventCursor(event: Record<string, unknown>): string | undefined {
  const durable = asRecord(event.durable);
  const seq = durable.seq;
  return typeof seq === "number" || typeof seq === "string"
    ? String(seq)
    : undefined;
}

function terminalStatus(
  event: Record<string, unknown>,
): EmbeddedTurnResult["status"] | undefined {
  if (event.type === "session.execution.succeeded") return "succeeded";
  if (event.type === "session.execution.failed") return "failed";
  if (event.type === "session.execution.interrupted") return "interrupted";
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
