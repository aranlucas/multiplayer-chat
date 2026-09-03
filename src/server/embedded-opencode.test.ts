import { describe, expect, it, vi } from "vitest";
import {
  EmbeddedOpenCodeRunner,
  eventSessionID,
  openCodeModelRef,
} from "./embedded-opencode";

describe("openCodeModelRef", () => {
  it("preserves model IDs with nested path segments", () => {
    expect(openCodeModelRef("opencode/vendor/coding-free")).toEqual({
      providerID: "opencode",
      id: "vendor/coding-free",
    });
  });

  it("rejects incomplete model IDs", () => {
    expect(() => openCodeModelRef("hy3-free")).toThrow(
      "Invalid OpenCode model",
    );
    expect(() => openCodeModelRef("opencode/")).toThrow(
      "Invalid OpenCode model",
    );
  });
});

describe("eventSessionID", () => {
  it("finds the session on an OpenCode form.created event", () => {
    expect(
      eventSessionID({
        type: "form.created",
        data: { form: { id: "frm_1", sessionID: "ses_1" } },
      }),
    ).toBe("ses_1");
  });
});

describe("EmbeddedOpenCodeRunner.turn", () => {
  it("checkpoints workspace changes before surfacing a failed turn", async () => {
    const failure = new Error("Transport");
    const changes = [{ path: "src/feature.ts", content: "export {};\n" }];
    const workspace = {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      syncSandboxChanges: vi.fn().mockResolvedValue(changes),
    };
    const opencode = {
      events: { subscribe: async function* () {} },
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
        prompt: vi.fn().mockRejectedValue(failure),
        wait: vi.fn(),
      },
    };
    const onEvent = vi.fn();
    const runner = new EmbeddedOpenCodeRunner(
      Promise.resolve(opencode as never),
      workspace as never,
      {} as never,
    );

    await expect(
      runner.turn(
        {
          roomID: "room-1",
          prompt: "Implement the approved feature",
          delivery: "steer",
          model: "openrouter/model",
        },
        onEvent,
      ),
    ).rejects.toBe(failure);

    expect(workspace.syncSandboxChanges).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({ type: "changes", changes });
  });

  it("checkpoints workspace changes when the event stream fails", async () => {
    const failure = new Error("Transport");
    const workspace = {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      syncSandboxChanges: vi.fn().mockResolvedValue([]),
    };
    const opencode = {
      events: {
        subscribe: async function* () {
          if (!failure.message) yield { type: "ignored" };
          throw failure;
        },
      },
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
        prompt: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
      },
    };
    const runner = new EmbeddedOpenCodeRunner(
      Promise.resolve(opencode as never),
      workspace as never,
      {} as never,
    );

    await expect(
      runner.turn({
        roomID: "room-1",
        prompt: "Implement the approved feature",
        delivery: "steer",
        model: "openrouter/model",
      }),
    ).rejects.toBe(failure);

    expect(workspace.syncSandboxChanges).toHaveBeenCalledOnce();
  });
});
