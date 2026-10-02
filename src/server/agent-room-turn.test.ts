import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, RoomSnapshot, ServerMessage } from "../shared/protocol";
import type {
  EmbeddedOpenCodeRunner,
  EmbeddedTurnResult,
  NativeRunnerEvent,
} from "./embedded-opencode";
import type { WorkerEnv } from "./opencode";
import { sqliteStorage } from "./fixtures/sqlite-storage";
import { deferred } from "./fixtures/deferred";

const execution = vi.hoisted(() => ({
  turn: vi.fn<EmbeddedOpenCodeRunner["turn"]>(),
  interrupt: vi.fn<EmbeddedOpenCodeRunner["interrupt"]>(),
}));
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: WorkerEnv,
    ) {}
  },
}));
vi.mock("@opencode/sdk/workerd", () => ({
  OpenCodeWorkerd: { create: async () => ({}) },
}));
vi.mock("./embedded-opencode", () => ({
  EmbeddedOpenCodeRunner: class {
    turn = execution.turn;
    interrupt = execution.interrupt;
  },
}));
import { AgentRoom } from "./agent-room";
import { RepositoryWorkspace } from "./workspace";

const databases: ReturnType<typeof sqliteStorage>[] = [];
const info = {
  repository: "owner/repo",
  branch: "main",
  commitSHA: "base",
  directory: "/workspace/repository",
};

beforeEach(() => {
  execution.turn.mockReset();
  execution.interrupt.mockReset().mockResolvedValue(undefined);
  vi.spyOn(RepositoryWorkspace.prototype, "ensureReady").mockResolvedValue(info);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const database of databases.splice(0)) {
    database.close();
  }
});

async function createRoom(mode: "live" | "simulation" = "live") {
  const database = sqliteStorage();
  databases.push(database);
  const pending: Promise<unknown>[] = [];
  const messages: ServerMessage[] = [];
  const socket = {
    deserializeAttachment: () => ({
      participant: { id: "p1", name: "Maya", role: "maintainer", color: "blue" },
    }),
    send: (message: string) => {
      messages.push(JSON.parse(message) as ServerMessage);
    },
  } as WebSocket;
  const context = {
    id: { name: "room-1" },
    storage: { sql: database.sql },
    getWebSockets: () => [socket],
    blockConcurrencyWhile<T>(callback: () => Promise<T>) {
      const promise = callback();
      pending.push(promise);
      return promise;
    },
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as DurableObjectState;
  const env = {
    OPENCODE_MODE: mode,
    OPENCODE_PROVIDER: "opencode-zen",
    OPENCODE_MODEL: "opencode/test-model",
    OPENCODE_ZEN_API_KEY: "mock-only",
    RAILWAY_ENVIRONMENT_ID: "mock-only",
    RAILWAY_TOKEN: "mock-only",
  } as WorkerEnv;
  const room = new AgentRoom(context, env);
  await Promise.all(pending);
  await room.initialize("room-1");
  await Promise.all(pending);
  return {
    database,
    messages,
    room,
    send: (message: ClientMessage) => room.webSocketMessage(socket, JSON.stringify(message)),
    snapshot: async () =>
      (await (await room.fetch(new Request("https://room.test"))).json()) as RoomSnapshot,
    changes: () =>
      database.sql
        .exec<{ content: string }>("SELECT content FROM relay_workspace_changes ORDER BY path")
        .toArray()
        .map((row) => row.content),
  };
}

function controlledTurn() {
  const completion = deferred<EmbeddedTurnResult>();
  const started = deferred<void>();
  let callback: Parameters<EmbeddedOpenCodeRunner["turn"]>[1];
  execution.turn.mockImplementationOnce((_request, onEvent) => {
    callback = onEvent;
    started.resolve();
    return completion.promise;
  });
  return {
    result: completion,
    started: started.promise,
    emit: (event: NativeRunnerEvent) => callback?.(event),
  };
}
function result(
  sessionID: string,
  content: string,
  status: EmbeddedTurnResult["status"] = "succeeded",
): EmbeddedTurnResult {
  return { sessionID, cursor: sessionID, changes: [{ path: "feature.ts", content }], status };
}

describe("room turn ownership", () => {
  it("ignores old callbacks, checkpoints and completion after a newer turn succeeds", async () => {
    const fixture = await createRoom();
    const old = controlledTurn();
    const oldRequest = fixture.send({ type: "prompt", text: "old", delivery: "steer" });
    await old.started;
    const current = controlledTurn();
    const newRequest = fixture.send({ type: "prompt", text: "new", delivery: "steer" });
    await current.started;
    current.result.resolve(result("new", "new edits"));
    await newRequest;
    await old.emit({ type: "session", sessionID: "old" });
    await old.emit({
      type: "opencode",
      cursor: "old",
      event: { type: "message.updated", data: { text: "obsolete" } },
    });
    await old.emit({ type: "changes", changes: result("old", "old edits").changes });
    old.result.resolve(result("old", "old edits"));
    await oldRequest;
    const snapshot = await fixture.snapshot();
    expect(snapshot.room).toMatchObject({
      agentStatus: "idle",
      opencodeSessionID: "new",
      workspaceRevision: 1,
    });
    expect(
      fixture.database.sql
        .exec<{ opencode_event_cursor: string }>("SELECT opencode_event_cursor FROM relay_room")
        .one().opencode_event_cursor,
    ).toBe("new");
    expect(fixture.changes()).toEqual(["new edits"]);
    expect(snapshot.events.some((event) => event.kind === "opencode")).toBe(false);
  });

  it("suppresses an obsolete runner failure without changing the current room", async () => {
    const fixture = await createRoom();
    const old = controlledTurn();
    const oldRequest = fixture.send({ type: "prompt", text: "old", delivery: "steer" });
    await old.started;
    const current = controlledTurn();
    const newRequest = fixture.send({ type: "prompt", text: "new", delivery: "steer" });
    await current.started;
    old.result.reject(new Error("Obsolete failure"));
    await oldRequest;
    expect((await fixture.snapshot()).room.agentStatus).toBe("running");
    expect(fixture.messages.some((message) => message.type === "error")).toBe(false);
    current.result.resolve(result("new", "new edits"));
    await newRequest;
  });

  it("pauses immediately, saves interrupted edits and never publishes a late success", async () => {
    const fixture = await createRoom();
    const publish = vi.spyOn(fixture.room, "publishSavedPullRequest").mockResolvedValue(undefined);
    const turn = controlledTurn();
    const request = fixture.send({ type: "prompt", text: "edit", delivery: "steer" });
    await turn.started;
    await turn.emit({ type: "session", sessionID: "session" });
    const interruption = deferred<void>();
    execution.interrupt.mockReturnValueOnce(interruption.promise);
    const pause = fixture.send({ type: "agent.pause" });
    expect((await fixture.snapshot()).room.agentStatus).toBe("paused");
    turn.result.resolve(result("session", "saved edits"));
    await request;
    interruption.resolve();
    await pause;
    expect((await fixture.snapshot()).room).toMatchObject({
      agentStatus: "paused",
      workspaceRevision: 1,
    });
    expect(fixture.changes()).toEqual(["saved edits"]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not let a delayed pause acknowledgement overwrite a newer turn", async () => {
    const fixture = await createRoom();
    const old = controlledTurn();
    const oldRequest = fixture.send({ type: "prompt", text: "old", delivery: "steer" });
    await old.started;
    await old.emit({ type: "session", sessionID: "old" });
    const interrupted = deferred<void>();
    execution.interrupt.mockReturnValueOnce(interrupted.promise);
    const pause = fixture.send({ type: "agent.pause" });
    const current = controlledTurn();
    const newRequest = fixture.send({ type: "prompt", text: "new", delivery: "steer" });
    await current.started;
    interrupted.resolve();
    await pause;
    expect((await fixture.snapshot()).room.agentStatus).toBe("running");
    old.result.resolve(result("old", "stale", "interrupted"));
    await oldRequest;
    current.result.resolve(result("new", "new edits"));
    await newRequest;
    expect((await fixture.snapshot()).room.agentStatus).toBe("idle");
  });

  it.each(["failed", "interrupted"] as const)(
    "counts saved edits for a %s outcome",
    async (status) => {
      const fixture = await createRoom();
      execution.turn.mockResolvedValueOnce(result("session", "saved edits", status));
      await fixture.send({ type: "prompt", text: "edit", delivery: "steer" });
      expect((await fixture.snapshot()).room).toMatchObject({
        agentStatus: status === "failed" ? "error" : "paused",
        workspaceRevision: 1,
      });
      expect(fixture.changes()).toEqual(["saved edits"]);
    },
  );

  it("saves checkpointed edits before surfacing a provider failure", async () => {
    const fixture = await createRoom();
    execution.turn.mockImplementationOnce(async (_request, emit) => {
      await emit?.({ type: "changes", changes: result("session", "saved edits").changes });
      throw new Error("Provider failed");
    });
    await fixture.send({ type: "prompt", text: "edit", delivery: "steer" });
    expect((await fixture.snapshot()).room).toMatchObject({
      agentStatus: "error",
      workspaceRevision: 1,
    });
    expect(fixture.changes()).toEqual(["saved edits"]);
    expect(fixture.messages.at(-1)).toEqual({ type: "error", message: "Provider failed" });
  });

  it("reports a checkpoint failure after pause without changing the paused state", async () => {
    const fixture = await createRoom();
    const turn = controlledTurn();
    const request = fixture.send({ type: "prompt", text: "edit", delivery: "steer" });
    await turn.started;
    await fixture.send({ type: "agent.pause" });
    turn.result.reject(new Error("Checkpoint could not be saved"));
    await request;
    expect((await fixture.snapshot()).room.agentStatus).toBe("paused");
    expect(fixture.messages.at(-1)).toEqual({
      type: "error",
      message: "Checkpoint could not be saved",
    });
  });

  it("keeps a queued prompt pending until the provider accepts it", async () => {
    const fixture = await createRoom();
    const turn = controlledTurn();
    const request = fixture.send({ type: "prompt", text: "queued", delivery: "queue" });
    await turn.started;
    await turn.emit({ type: "status", message: "Preparing" });
    await turn.emit({ type: "session", sessionID: "session" });
    expect((await fixture.snapshot()).queue.map((item) => item.text)).toEqual(["queued"]);
    turn.result.reject(new Error("Admission failed"));
    await request;
    expect((await fixture.snapshot()).queue).toHaveLength(1);
  });

  it("consumes an accepted queued prompt exactly once", async () => {
    const fixture = await createRoom();
    const turn = controlledTurn();
    const request = fixture.send({ type: "prompt", text: "queued", delivery: "queue" });
    await turn.started;
    await turn.emit({ type: "accepted" });
    const count = fixture.messages.length;
    await turn.emit({ type: "accepted" });
    expect(fixture.messages).toHaveLength(count);
    expect((await fixture.snapshot()).queue).toEqual([]);
    turn.result.resolve(result("session", "saved edits"));
    await request;
  });

  it("does not start native execution if paused during workspace preparation", async () => {
    const fixture = await createRoom();
    const ready = deferred<typeof info>();
    vi.spyOn(RepositoryWorkspace.prototype, "ensureReady").mockReturnValueOnce(ready.promise);
    const request = fixture.send({ type: "prompt", text: "queued", delivery: "queue" });
    await fixture.send({ type: "agent.pause" });
    ready.resolve(info);
    await request;
    expect(execution.turn).not.toHaveBeenCalled();
    expect((await fixture.snapshot()).room.agentStatus).toBe("paused");
    expect((await fixture.snapshot()).queue).toHaveLength(1);
  });

  it("stops simulated playback and queue draining when paused", async () => {
    vi.useFakeTimers();
    vi.spyOn(RepositoryWorkspace.prototype, "search").mockResolvedValue("matches");
    vi.spyOn(RepositoryWorkspace.prototype, "diff").mockResolvedValue("clean");
    const fixture = await createRoom("simulation");
    const request = fixture.send({ type: "prompt", text: "first", delivery: "steer" });
    await vi.advanceTimersByTimeAsync(200);
    await fixture.send({ type: "prompt", text: "follow-up", delivery: "queue" });
    await fixture.send({ type: "agent.pause" });
    const events = (await fixture.snapshot()).events.length;
    await vi.runAllTimersAsync();
    await request;
    const snapshot = await fixture.snapshot();
    expect(snapshot.events).toHaveLength(events);
    expect(snapshot.room.agentStatus).toBe("paused");
    expect(snapshot.queue.map((item) => item.text)).toEqual(["follow-up"]);
  });
});
