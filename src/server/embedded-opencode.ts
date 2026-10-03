import { z } from "zod";
import { jsonRecord, parseJsonRecord, type JsonRecord, type JsonValue } from "../shared/json-value";
import { InactiveAgentTurnError } from "./agent-turn";
import type { OpenCodeWorkerd } from "@opencode/sdk/workerd";
import type { OpenCodeModelOption } from "../shared/protocol";
import type { WorkspaceChange } from "../shared/workspace-change";
import type { RailwayRoomSandbox } from "./railway-sandbox";
import type { RepositoryWorkspace } from "./workspace";

interface EmbeddedTurnRequest {
  roomID: string;
  prompt: string;
  delivery: "steer" | "queue";
  model: string;
  sessionID?: string;
  after?: string;
  timeoutMs?: number;
  isCurrent?: () => boolean;
  isRunning?: () => boolean;
}

export type NativeRunnerEvent =
  | { type: "status"; message: string }
  | { type: "session"; sessionID: string }
  | { type: "accepted" }
  | { type: "opencode"; cursor?: string; event: JsonRecord }
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

type NativeSessions = OpenCodeWorkerd.Interface["sessions"];

interface RunnerSession {
  id: string;
  model?: { providerID: string; id: string };
  outcome?: EmbeddedTurnResult["status"];
}

export interface OpenCodeHost {
  sessions: {
    create(this: void, ...args: Parameters<NativeSessions["create"]>): Promise<RunnerSession>;
    get(this: void, ...args: Parameters<NativeSessions["get"]>): Promise<RunnerSession>;
    prompt(this: void, ...args: Parameters<NativeSessions["prompt"]>): Promise<void>;
    wait(this: void, ...args: Parameters<NativeSessions["wait"]>): Promise<void>;
    interrupt(this: void, ...args: Parameters<NativeSessions["interrupt"]>): Promise<void>;
    switchModel(this: void, ...args: Parameters<NativeSessions["switchModel"]>): Promise<void>;
    form: Pick<NativeSessions["form"], "reply" | "cancel">;
  };
  events: {
    subscribe(
      ...args: Parameters<OpenCodeWorkerd.Interface["events"]["subscribe"]>
    ): AsyncIterable<JsonRecord>;
  };
  model: Pick<OpenCodeWorkerd.Interface["model"], "list">;
}

/** Public SDK subscriptions are JSON-decoded SSE frames even for an in-process host.
 * Preserve future event fields while rejecting non-serializable extensions.
 */
export async function* decodeNativeEvents<T>(source: AsyncIterable<T>): AsyncIterable<JsonRecord> {
  for await (const event of source) {
    yield parseJsonRecord(event);
  }
}

/** Adapt SDK results at the integration boundary; the runner consumes only these operations. */
export function openCodeHost(host: OpenCodeWorkerd.Interface): OpenCodeHost {
  return {
    sessions: {
      create: (...args) => host.sessions.create(...args),
      get: (...args) => host.sessions.get(...args),
      prompt: async (...args) => {
        await host.sessions.prompt(...args);
      },
      wait: async (...args) => {
        await host.sessions.wait(...args);
      },
      interrupt: async (...args) => {
        await host.sessions.interrupt(...args);
      },
      switchModel: async (...args) => {
        await host.sessions.switchModel(...args);
      },
      form: {
        reply: (...args) => host.sessions.form.reply(...args),
        cancel: (...args) => host.sessions.form.cancel(...args),
      },
    },
    events: {
      async *subscribe(...args) {
        yield* decodeNativeEvents(host.events.subscribe(...args));
      },
    },
    model: { list: (...args) => host.model.list(...args) },
  };
}

export class EmbeddedOpenCodeRunner {
  constructor(
    private readonly host: Promise<OpenCodeHost>,
    private readonly workspace: Pick<RepositoryWorkspace, "ensureReady" | "syncSandboxChanges">,
    private readonly sandbox: Pick<RailwayRoomSandbox, "killActive">,
  ) {}

  async turn(
    request: EmbeddedTurnRequest,
    onEvent?: (event: NativeRunnerEvent) => void | Promise<void>,
  ): Promise<EmbeddedTurnResult> {
    const startedAt = Date.now();
    const opencode = await this.host;

    if (request.isRunning?.() === false) {
      throw new InactiveAgentTurnError();
    }

    await this.workspace.ensureReady();

    if (request.isRunning?.() === false) {
      throw new InactiveAgentTurnError();
    }

    await onEvent?.({
      type: "status",
      message: "OpenCode is running in the room Durable Object",
    });

    const session = await this.resolveSession(opencode, request.sessionID, request.model);

    if (request.isRunning?.() === false) {
      throw new InactiveAgentTurnError();
    }

    await onEvent?.({ type: "session", sessionID: session.id });

    const controller = new AbortController();
    const streamFailure = new AbortController();
    const timeoutMs = request.timeoutMs ?? 3_600_000;
    const deadline = AbortSignal.timeout(timeoutMs);
    const executionSignal = AbortSignal.any([deadline, streamFailure.signal]);
    let cursor = request.after;
    let observedStatus: EmbeddedTurnResult["status"] | undefined;
    let deferredProviderError: Error | undefined;
    let eventError: unknown;

    const eventTask = (async () => {
      try {
        for await (const event of opencode.events.subscribe({
          signal: controller.signal,
        })) {
          const record = parseJsonRecord(event);

          if (eventSessionID(record) !== session.id) {
            continue;
          }

          const nextCursor = eventCursor(record);

          if (
            nextCursor &&
            cursor &&
            Number.isFinite(Number(nextCursor)) &&
            Number(nextCursor) <= Number(cursor)
          ) {
            continue;
          }

          if (nextCursor) {
            cursor = nextCursor;
          }

          observedStatus = terminalStatus(record) ?? observedStatus;
          await onEvent?.({
            type: "opencode",
            cursor: nextCursor,
            event: record,
          });
          const providerError = deferredProviderFailure(record);

          if (providerError) {
            deferredProviderError = providerError;

            if (request.isCurrent?.() !== false) {
              await opencode.sessions.interrupt({ sessionID: session.id });
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          eventError = error;
          streamFailure.abort(error);
        }
      }
    })();

    // Feature work can spend longer than 15 minutes in provider retries and builds.
    // Use one deadline for the entire request, and stop the session if it expires.
    let executionError: unknown;

    try {
      if (request.isRunning?.() === false) {
        throw new InactiveAgentTurnError();
      }

      await opencode.sessions.prompt(
        {
          sessionID: session.id,
          text: request.prompt,
          delivery: request.delivery,
        },
        { signal: executionSignal },
      );
      await onEvent?.({ type: "accepted" });
      await opencode.sessions.wait({ sessionID: session.id }, { signal: executionSignal });
    } catch (error) {
      executionError = deadline.aborted
        ? new Error(
            `Agent turn timed out after ${Math.round(timeoutMs / 1_000)} seconds; saved changes can be resumed.`,
            { cause: error },
          )
        : error;

      if (executionSignal.aborted && request.isCurrent?.() !== false) {
        await this.interrupt(session.id);
      }
    } finally {
      controller.abort();
      await eventTask;
    }

    const turnError = deferredProviderError ?? eventError ?? executionError;
    let changes: WorkspaceChange[];

    try {
      changes = await this.workspace.syncSandboxChanges(request.isCurrent);
    } catch (checkpointError) {
      if (!turnError) {
        throw checkpointError;
      }

      throw new AggregateError(
        [turnError, checkpointError],
        "The agent turn failed and its workspace checkpoint could not be saved",
        { cause: checkpointError },
      );
    }

    await onEvent?.({ type: "changes", changes });

    if (turnError) {
      throw turnError;
    }

    const latest = await opencode.sessions.get({ sessionID: session.id });
    const status = latest.outcome ?? observedStatus ?? "succeeded";
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

  async replyToForm(
    sessionID: string,
    formID: string,
    answer: Record<string, string | string[]>,
  ): Promise<void> {
    const opencode = await this.host;
    await opencode.sessions.form.reply({ sessionID, formID, answer });
  }

  async cancelForm(sessionID: string, formID: string): Promise<void> {
    const opencode = await this.host;
    await opencode.sessions.form.cancel({ sessionID, formID });
  }

  async models(): Promise<OpenCodeModelOption[]> {
    const opencode = await this.host;

    const response = await opencode.model.list({
      location: { directory: "/workspace/repository" },
    });

    return response.data
      .filter((model) => model.enabled && model.capabilities.tools && model.status !== "deprecated")
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
        left.free === right.free ? left.name.localeCompare(right.name) : left.free ? -1 : 1,
      );
  }

  private async resolveSession(
    opencode: OpenCodeHost,
    sessionID: string | undefined,
    model: string,
  ) {
    if (sessionID) {
      const existing = await opencode.sessions.get({ sessionID }).catch(() => undefined);

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

  if (!providerID || !modelParts.length || modelParts.some((part) => !part)) {
    throw new Error(`Invalid OpenCode model: ${model}`);
  }

  return { providerID, id: modelParts.join("/") };
}

function deferredProviderFailure(event: JsonRecord): Error | undefined {
  if (event.type !== "session.retry.scheduled") {
    return undefined;
  }

  const data = asRecord(event.data);
  const retryAt = z.number().catch(0).parse(data.at);

  if (!retryAt || retryAt <= Date.now() + 60_000) {
    return undefined;
  }

  const providerError = asRecord(data.error);

  const message = z.string().catch("Provider request failed").parse(providerError.message);

  return new Error(`OpenCode provider retry deferred too long: ${message}`);
}

const eventRoutingSchema = z.object({
  data: z
    .object({
      sessionID: z.string().optional().catch(undefined),
      form: z
        .object({ sessionID: z.string().optional().catch(undefined) })
        .optional()
        .catch(undefined),
    })
    .catch({}),
  durable: z
    .object({ seq: z.union([z.number(), z.string()]).optional().catch(undefined) })
    .catch({}),
});

export function eventSessionID(event: JsonRecord): string | undefined {
  const parsed = eventRoutingSchema.parse(event);

  return parsed.data.sessionID ?? parsed.data.form?.sessionID;
}

function eventCursor(event: JsonRecord): string | undefined {
  const parsed = eventRoutingSchema.parse(event);

  return parsed.durable.seq === undefined ? undefined : String(parsed.durable.seq);
}

function terminalStatus(event: JsonRecord): EmbeddedTurnResult["status"] | undefined {
  if (event.type === "session.execution.succeeded") {
    return "succeeded";
  }

  if (event.type === "session.execution.failed") {
    return "failed";
  }

  if (event.type === "session.execution.interrupted") {
    return "interrupted";
  }

  return undefined;
}

function asRecord(value: JsonValue | undefined): JsonRecord {
  return jsonRecord(value);
}
