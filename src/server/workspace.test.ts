import { describe, expect, it, vi } from "vitest";
import { replaceExact } from "../shared/exact-edit";
import type { RailwayRoomSandbox } from "./railway-sandbox";
import { RepositoryWorkspace } from "./workspace";

describe("replaceExact", () => {
  it("replaces one exact match", () => {
    expect(replaceExact("one\ntwo\nthree\n", "two", "updated", false)).toBe(
      "one\nupdated\nthree\n",
    );
  });

  it("requires a unique match unless replaceAll is enabled", () => {
    expect(() => replaceExact("same same", "same", "next", false)).toThrow(
      "multiple matches",
    );
    expect(replaceExact("same same", "same", "next", true)).toBe("next next");
  });

  it("directs the agent to re-read after stale content", () => {
    expect(() => replaceExact("actual", "stale", "next", false)).toThrow(
      "Re-read the file",
    );
  });
});

describe("RepositoryWorkspace.ensureReady", () => {
  it("does not replace the repository when a Railway probe fails", async () => {
    const transportError = new Error("Railway GraphQL request failed with HTTP 503");
    const sandbox = {
      configured: true,
      exec: vi.fn().mockRejectedValue(transportError),
    };
    const room = {
      room_id: "room-1",
      repository: "aranlucas/multiplayer-chat",
      branch: "main",
      commit_sha: "abc123",
      workspace_status: "ready",
    };
    const storage = {
      sql: {
        exec: vi.fn((query: string) => ({
          one: () => {
            if (query.startsWith("SELECT * FROM relay_room")) return room;
            throw new Error(`Unexpected query: ${query}`);
          },
        })),
      },
    };
    const workspace = new RepositoryWorkspace(
      storage as unknown as DurableObjectStorage,
      {},
      sandbox as unknown as RailwayRoomSandbox,
    );

    await expect(workspace.ensureReady()).rejects.toBe(transportError);

    expect(sandbox.exec).toHaveBeenCalledOnce();
    expect(sandbox.exec).not.toHaveBeenCalledWith(
      expect.stringContaining("rm -rf"),
      expect.anything(),
    );
  });
});
