import { describe, expect, it, vi } from "vitest";
import type { NativeRunnerEvent } from "./embedded-opencode";
import type { WorkerEnv } from "./opencode";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: DurableObjectState;
    env: WorkerEnv;
    constructor(ctx: DurableObjectState, env: WorkerEnv) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
vi.mock("@opencode-ai/sdk/workerd", () => ({ OpenCodeWorkerd: class {} }));
vi.mock("./github-auth", () => ({
  unsealGitHubCredential: async () => ({ accessToken: "test", login: "maintainer" }),
  sealGitHubCredential: async () => "sealed",
}));

import { AgentRoom } from "./agent-room";

const simulationEnv = { OPENCODE_MODE: "simulation" } as WorkerEnv;

function sqlStub() {
  return {
    exec: vi.fn(() => ({
      toArray: () => [],
      one: () => ({ count: 0 }),
    })),
  };
}

function namedRoomContext(roomID: string, sql = sqlStub()): DurableObjectState {
  return {
    id: { name: roomID },
    storage: { sql },
  } as unknown as DurableObjectState;
}

function wokenRoom(roomID: string): AgentRoom {
  const room = new AgentRoom(namedRoomContext(roomID), simulationEnv);
  Object.assign(room, {
    latestRevision: () => ({
      id: "rev-1",
      previewURL: "https://preview.example/app",
      status: "ready",
    }),
  });
  return room;
}

describe("Durable Object room identity after hibernation", () => {
  it("keeps the named Durable Object id on handoff without initialize", async () => {
    const room = wokenRoom("session-42");
    const result = await room.createHandoff({
      participant: { id: "p1", name: "Maya", role: "maintainer" },
      currentOrigin: "https://control.example",
      controlOrigin: "https://control.example",
    });
    expect(new URL(result.url).pathname).toBe("/r/session-42");
    expect(result.url).not.toContain("reconnect-loop");
  });

  it("tags native OpenCode events with the named Durable Object id after wake", () => {
    const room = wokenRoom("session-42");
    const insertEvent = vi.fn((event: { id: string }) => event);
    Object.assign(room, {
      insertEvent,
      broadcast: vi.fn(),
    });
    const handler = room as unknown as {
      handleNativeRunnerEvent(event: NativeRunnerEvent): void;
    };
    handler.handleNativeRunnerEvent({
      type: "opencode",
      cursor: "7",
      event: { type: "message.updated", data: {} },
    });
    expect(insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opencode:session-42:7" }),
    );
  });

  it("falls back to the stored room id when the Durable Object is unnamed", async () => {
    const exec = vi.fn();
    const room = Object.assign(Object.create(AgentRoom.prototype) as object, {
      ctx: {
        id: {},
        storage: { sql: { exec } },
      },
      getRoom: () => ({ id: "stored-room" }),
      latestRevision: () => ({
        id: "rev-1",
        previewURL: "https://preview.example/app",
        status: "ready",
      }),
    }) as unknown as AgentRoom;
    const result = await room.createHandoff({
      participant: { id: "p1", name: "Maya", role: "maintainer" },
      currentOrigin: "https://control.example",
      controlOrigin: "https://control.example",
    });
    expect(new URL(result.url).pathname).toBe("/r/stored-room");
    expect(result.url).not.toContain("reconnect-loop");
  });
});
