import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "./workspace";
import {
  drainSimulatedQueue,
  extractSearchTerm,
  runSimulatedTurn,
  type SimulatedWorkspace,
} from "./simulation-runner";

function workspaceStub(
  overrides: {
    info?: Partial<WorkspaceInfo>;
    search?: SimulatedWorkspace["search"];
    diff?: SimulatedWorkspace["diff"];
  } = {},
): {
  workspace: SimulatedWorkspace;
  search: ReturnType<typeof vi.fn<(query: string) => Promise<string>>>;
  diff: ReturnType<typeof vi.fn<() => Promise<string>>>;
} {
  const search = vi.fn<(query: string) => Promise<string>>(
    overrides.search ?? (async () => "src/server/agent-room.ts:10: WebSocket"),
  );
  const diff = vi.fn<() => Promise<string>>(
    overrides.diff ?? (async () => "Working tree is clean."),
  );
  return {
    search,
    diff,
    workspace: {
      ensureReady: async () => ({
        repository: "aranlucas/multiplayer-chat",
        branch: "main",
        commitSHA: "abcdef1234567890",
        directory: "/workspace/repository",
        ...overrides.info,
      }),
      search,
      diff,
    },
  };
}

describe("extractSearchTerm", () => {
  it("prefers CamelCase and path-like tokens over stopwords", () => {
    expect(extractSearchTerm("Investigate the WebSocket reconnect")).toBe("WebSocket");
    expect(extractSearchTerm("find agent-room.ts in the repository")).toBe("agent-room.ts");
  });

  it("skips stopwords then falls back to WebSocket", () => {
    expect(extractSearchTerm("look for reconnect")).toBe("reconnect");
    expect(extractSearchTerm("where is the implementation")).toBe("WebSocket");
    expect(extractSearchTerm("")).toBe("WebSocket");
  });
});

describe("runSimulatedTurn", () => {
  it("searches and diffs the workspace, then plays back the scripted events", async () => {
    const { workspace, search, diff } = workspaceStub();
    const payloads: Array<Record<string, unknown>> = [];
    const delays: number[] = [];

    await runSimulatedTurn({
      prompt: "Investigate the WebSocket reconnect",
      workspace,
      emitEvent: (payload) => {
        payloads.push(payload);
      },
      wait: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    expect(search).toHaveBeenCalledWith("WebSocket");
    expect(diff).toHaveBeenCalledOnce();
    expect(delays).toEqual([180, 260, 320, 280, 240]);
    expect(payloads).toEqual([
      {
        type: "reasoning",
        text: "I’ll inspect aranlucas/multiplayer-chat@abcdef12 for WebSocket, then read the shared Git diff.",
      },
      {
        type: "tool",
        tool: "bash",
        status: "running",
        summary: "Searching the repository…",
      },
      {
        type: "tool",
        tool: "bash",
        status: "completed",
        summary: "Repository search completed",
        output: "src/server/agent-room.ts:10: WebSocket",
      },
      {
        type: "tool",
        tool: "bash",
        status: "completed",
        summary: "Shared Git diff inspected",
        output: "Working tree is clean.",
      },
      {
        type: "text",
        text: "I inspected the real workspace pinned at abcdef123456. The search and diff transcripts above came from the Railway Sandbox; no repository files were changed.",
      },
    ]);
  });

  it("labels a GitHub snapshot workspace and a no-match search", async () => {
    const search = vi.fn<(query: string) => Promise<string>>(async () => "No matches found.");
    const { workspace } = workspaceStub({
      info: { directory: "github://aranlucas/multiplayer-chat@abcdef1234567890" },
      search,
    });
    const payloads: Array<Record<string, unknown>> = [];

    await runSimulatedTurn({
      prompt: "find reconnect",
      workspace,
      emitEvent: (payload) => {
        payloads.push(payload);
      },
      wait: async () => {},
    });

    expect(search).toHaveBeenCalledWith("reconnect");
    expect(payloads[2]).toEqual({
      type: "tool",
      tool: "bash",
      status: "completed",
      summary: "No matches",
      output: "No matches found.",
    });
    expect(payloads[4]).toEqual({
      type: "text",
      text: "I inspected the real workspace pinned at abcdef123456. The search and diff transcripts above came from the Workers-native GitHub snapshot; no repository files were changed.",
    });
  });

  it("does not emit events when workspace search fails", async () => {
    const search = vi.fn<(query: string) => Promise<string>>(async () => {
      throw new Error("Repository search failed");
    });
    const { workspace, diff } = workspaceStub({ search });
    const emitEvent = vi.fn();
    const delay = vi.fn(async () => {});

    await expect(
      runSimulatedTurn({
        prompt: "Investigate WebSocket",
        workspace,
        emitEvent,
        wait: delay,
      }),
    ).rejects.toThrow("Repository search failed");
    expect(diff).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });

  it("stops the playback when a later emit fails", async () => {
    const { workspace } = workspaceStub();
    const emitEvent = vi.fn((payload: Record<string, unknown>) => {
      if (payload.status === "running") {
        throw new Error("broadcast failed");
      }
    });

    await expect(
      runSimulatedTurn({
        prompt: "Investigate WebSocket",
        workspace,
        emitEvent,
        wait: async () => {},
      }),
    ).rejects.toThrow("broadcast failed");
    expect(emitEvent).toHaveBeenCalledTimes(2);
  });
});

describe("drainSimulatedQueue", () => {
  it("no-ops when the queue is empty", async () => {
    const runTurn = vi.fn(async () => {});
    await drainSimulatedQueue({
      nextQueuedPrompt: () => undefined,
      consumeQueuedPrompt: () => {
        throw new Error("should not consume");
      },
      runTurn,
    });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("consumes each queued prompt before running that turn", async () => {
    const queue = [
      { eventID: "q1", text: "first follow-up" },
      { eventID: "q2", text: "second follow-up" },
    ];
    const order: string[] = [];

    await drainSimulatedQueue({
      nextQueuedPrompt: () => queue[0],
      consumeQueuedPrompt: (eventID) => {
        order.push(`consume:${eventID}`);
        queue.shift();
      },
      runTurn: async (text) => {
        order.push(`turn:${text}`);
      },
    });

    expect(order).toEqual([
      "consume:q1",
      "turn:first follow-up",
      "consume:q2",
      "turn:second follow-up",
    ]);
  });

  it("leaves later prompts queued when a turn fails", async () => {
    const queue = [
      { eventID: "q1", text: "first follow-up" },
      { eventID: "q2", text: "second follow-up" },
    ];
    const consumed: string[] = [];

    await expect(
      drainSimulatedQueue({
        nextQueuedPrompt: () => queue[0],
        consumeQueuedPrompt: (eventID) => {
          consumed.push(eventID);
          queue.shift();
        },
        runTurn: async () => {
          throw new Error("simulated turn failed");
        },
      }),
    ).rejects.toThrow("simulated turn failed");

    expect(consumed).toEqual(["q1"]);
    expect(queue).toEqual([{ eventID: "q2", text: "second follow-up" }]);
  });
});
