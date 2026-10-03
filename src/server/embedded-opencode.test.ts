import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  type OpenCodeHost,
  EmbeddedOpenCodeRunner,
  decodeNativeEvents,
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
    expect(() => openCodeModelRef("hy3-free")).toThrow("Invalid OpenCode model");
    expect(() => openCodeModelRef("opencode/")).toThrow("Invalid OpenCode model");
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
  it.each([true, false])(
    "checkpoints an expired execution and only interrupts while it owns the turn (current: %s)",
    async (isCurrent) => {
      const controller = new AbortController();
      const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
      const changes = [{ path: "src/feature.ts", content: "export {};\n" }];

      const workspace = {
        ensureReady: vi.fn().mockResolvedValue(undefined),
        syncSandboxChanges: vi.fn().mockResolvedValue(changes),
      };

      const opencode = hostFixture({
        events: { subscribe: async function* () {} },
        sessions: {
          create: vi.fn().mockResolvedValue({ id: "session-1" }),
          prompt: vi.fn<OpenCodeHost["sessions"]["prompt"]>().mockResolvedValue(undefined),
          wait: vi.fn<OpenCodeHost["sessions"]["wait"]>().mockImplementation(async () => {
            controller.abort();
            throw new Error("Transport");
          }),
          interrupt: vi.fn().mockResolvedValue(undefined),
        },
      });

      const sandbox = { killActive: vi.fn().mockResolvedValue(undefined) };
      const onEvent = vi.fn();

      const runner = new EmbeddedOpenCodeRunner(Promise.resolve(opencode), workspace, sandbox);

      try {
        await expect(
          runner.turn(
            {
              roomID: "room-1",
              prompt: "Build the feature",
              delivery: "steer",
              model: "openrouter/model",
              timeoutMs: 60_000,
              isCurrent: () => isCurrent,
            },
            onEvent,
          ),
        ).rejects.toThrow("Agent turn timed out after 60 seconds");
        expect(vi.mocked(opencode.sessions.interrupt).mock.calls).toEqual(
          isCurrent ? [[{ sessionID: "session-1" }]] : [],
        );
        expect(sandbox.killActive).toHaveBeenCalledTimes(isCurrent ? 1 : 0);
        expect(onEvent).toHaveBeenCalledWith({ type: "changes", changes });
        expect(vi.mocked(opencode.sessions.prompt).mock.calls[0][1]?.signal).toBe(
          vi.mocked(opencode.sessions.wait).mock.calls[0][1]?.signal,
        );
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it("checkpoints workspace changes before surfacing a failed turn", async () => {
    const failure = new Error("Transport");
    const changes = [{ path: "src/feature.ts", content: "export {};\n" }];

    const workspace = {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      syncSandboxChanges: vi.fn().mockResolvedValue(changes),
    };

    const opencode = hostFixture({
      events: { subscribe: async function* () {} },
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
        prompt: vi.fn().mockRejectedValue(failure),
        wait: vi.fn(),
      },
    });

    const onEvent = vi.fn();

    const runner = new EmbeddedOpenCodeRunner(Promise.resolve(opencode), workspace, {
      killActive: vi.fn().mockResolvedValue(undefined),
    });

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
    expect(onEvent).not.toHaveBeenCalledWith({ type: "accepted" });
    expect(onEvent).toHaveBeenCalledWith({ type: "changes", changes });
  });

  it("interrupts a pending prompt and checkpoints when the event stream fails", async () => {
    const failure = new Error("Transport");

    const workspace = {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      syncSandboxChanges: vi.fn().mockResolvedValue([]),
    };

    const opencode = hostFixture({
      events: {
        subscribe: async function* () {
          if (!failure.message) {
            yield { type: "ignored" };
          }

          await new Promise((resolve) => setTimeout(resolve, 0));
          throw failure;
        },
      },
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
        prompt: vi.fn<OpenCodeHost["sessions"]["prompt"]>().mockImplementation(
          (_input, options) =>
            new Promise((_resolve, reject) => {
              const signal = options?.signal;

              if (!signal) {
                throw new Error("Expected execution signal");
              }

              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
        ),
        wait: vi.fn().mockResolvedValue(undefined),
        interrupt: vi.fn().mockResolvedValue(undefined),
      },
    });

    const runner = new EmbeddedOpenCodeRunner(Promise.resolve(opencode), workspace, {
      killActive: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      runner.turn({
        roomID: "room-1",
        prompt: "Implement the approved feature",
        delivery: "steer",
        model: "openrouter/model",
      }),
    ).rejects.toBe(failure);

    expect(opencode.sessions.interrupt).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(opencode.sessions.wait).not.toHaveBeenCalled();
    expect(workspace.syncSandboxChanges).toHaveBeenCalledOnce();
  });
});

function hostFixture(overrides: {
  sessions: Partial<OpenCodeHost["sessions"]>;
  events?: OpenCodeHost["events"];
}): OpenCodeHost {
  return {
    sessions: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
      get: vi.fn().mockResolvedValue({ id: "session-1" }),
      prompt: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      interrupt: vi.fn().mockResolvedValue(undefined),
      switchModel: vi.fn().mockResolvedValue(undefined),
      form: { reply: vi.fn(), cancel: vi.fn() },
      ...overrides.sessions,
    },
    events: overrides.events ?? { subscribe: async function* () {} },
    model: { list: vi.fn().mockResolvedValue({ data: [] }) },
  };
}

describe("public SDK event stream decoding", () => {
  it("propagates early consumer cancellation to the SDK iterator", async () => {
    let closed = false;

    async function* source() {
      try {
        yield { type: "future.event", data: { items: [{ text: "x", optional: undefined }] } };
        yield { type: "unread" };
      } finally {
        closed = true;
      }
    }

    const received = [];

    for await (const event of decodeNativeEvents(source())) {
      received.push(event);
      break;
    }

    expect(received).toEqual([
      { type: "future.event", data: { items: [{ text: "x", optional: undefined }] } },
    ]);
    expect(closed).toBe(true);
  });
  it("closes the source and rejects unsupported non-JSON extension data", async () => {
    let closed = false;

    async function* source() {
      try {
        yield { type: "invalid", data: { amount: 1n } };
      } finally {
        closed = true;
      }
    }

    const consume = async () => {
      for await (const event of decodeNativeEvents(source())) {
        return event;
      }
    };

    await expect(consume()).rejects.toThrow(ZodError);
    expect(closed).toBe(true);
  });
  it("propagates upstream stream failure without inventing an event", async () => {
    const failure = new Error("stream disconnected");

    async function* source() {
      yield { type: "first" };
      throw failure;
    }

    const consume = async () => {
      const events = [];

      for await (const event of decodeNativeEvents(source())) {
        events.push(event);
      }

      return events;
    };

    await expect(consume()).rejects.toBe(failure);
  });
});
