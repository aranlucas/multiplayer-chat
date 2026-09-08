/// <reference types="node" />
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
    expect(() => replaceExact("same same", "same", "next", false)).toThrow("multiple matches");
    expect(replaceExact("same same", "same", "next", true)).toBe("next next");
  });

  it("directs the agent to re-read after stale content", () => {
    expect(() => replaceExact("actual", "stale", "next", false)).toThrow("Re-read the file");
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
            if (query.startsWith("SELECT * FROM relay_room")) {
              return room;
            }
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

// Exercise checkpoint and migration SQL against a real SQLite database.
describe("published workspace association", () => {
  it("retains the same PR through changed, repeated, and reverted checkpoints", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE relay_room (singleton INTEGER PRIMARY KEY, pull_request_url TEXT, pull_request_branch TEXT, pull_request_number INTEGER, pull_request_head_sha TEXT);
      INSERT INTO relay_room VALUES (1, 'https://github.com/owner/repo/pull/30', 'relay/feature', 30, 'published');`);
    const sql = {
      exec(query: string, ...values: (string | number | null)[]) {
        if (query.includes("CREATE TABLE")) {
          database.exec(query);
          return { toArray: () => [] };
        }
        const rows = database.prepare(query).all(...values);
        return { toArray: () => rows, one: () => rows[0] };
      },
    } as unknown as DurableObjectStorage["sql"];
    const workspace = new RepositoryWorkspace({ sql } as DurableObjectStorage, {});
    try {
      for (const changes of [
        [{ path: "feature.ts", content: "first" }],
        [{ path: "feature.ts", content: "second" }],
        [{ path: "feature.ts", content: "second" }],
        [],
      ]) {
        workspace.syncNativeAgentChanges(changes);
        expect(
          database
            .prepare(
              "SELECT pull_request_url AS url, pull_request_branch AS branch FROM relay_room",
            )
            .get(),
        ).toEqual({ url: "https://github.com/owner/repo/pull/30", branch: "relay/feature" });
      }
      database.exec(
        "ALTER TABLE relay_room ADD COLUMN workspace_revision INTEGER NOT NULL DEFAULT 1",
      );
      vi.spyOn(workspace, "ensureReady").mockResolvedValue({
        repository: "owner/repo",
        branch: "main",
        commitSHA: "base",
        directory: "/workspace/repository",
      });
      workspace.syncNativeAgentChanges([{ path: "feature.ts", content: "published snapshot" }]);
      const snapshot = await workspace.pullRequestWorkspace();
      database.exec("UPDATE relay_room SET workspace_revision = 2");
      workspace.syncNativeAgentChanges([{ path: "feature.ts", content: "newer edit" }]);
      expect(snapshot.workspaceRevision).toBe(1);
      expect(snapshot.changes).toEqual([{ path: "feature.ts", content: "published snapshot" }]);
      expect((await workspace.pullRequestWorkspace()).workspaceRevision).toBe(2);
    } finally {
      database.close();
    }
  });

  it("restores missing PR fields from the exact published commit, without replacing intact fields", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { restorePullRequestAssociation } = await import("./workspace");
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE relay_room (singleton INTEGER PRIMARY KEY, pull_request_url TEXT, pull_request_branch TEXT, pull_request_number INTEGER, pull_request_head_sha TEXT);
      CREATE TABLE relay_events (seq INTEGER PRIMARY KEY, kind TEXT, payload_json TEXT);
      INSERT INTO relay_room VALUES (1, NULL, NULL, 30, 'published');`);
    const insert = database.prepare("INSERT INTO relay_events VALUES (?, 'system', ?)");
    insert.run(
      1,
      JSON.stringify({
        type: "pull_request",
        commitSHA: "published",
        url: "https://github.com/owner/repo/pull/30",
        branch: "relay/feature",
      }),
    );
    insert.run(
      2,
      JSON.stringify({ type: "pull_request", commitSHA: "other", url: "wrong", branch: "wrong" }),
    );
    const sql = {
      exec: (query: string) => database.exec(query),
    } as unknown as DurableObjectStorage["sql"];
    try {
      restorePullRequestAssociation(sql);
      expect(
        database
          .prepare("SELECT pull_request_url AS url, pull_request_branch AS branch FROM relay_room")
          .get(),
      ).toEqual({ url: "https://github.com/owner/repo/pull/30", branch: "relay/feature" });
      database.exec(
        "UPDATE relay_room SET pull_request_url = 'intact', pull_request_branch = NULL",
      );
      restorePullRequestAssociation(sql);
      expect(
        database
          .prepare("SELECT pull_request_url AS url, pull_request_branch AS branch FROM relay_room")
          .get(),
      ).toEqual({ url: "intact", branch: "relay/feature" });
    } finally {
      database.close();
    }
  });
});
