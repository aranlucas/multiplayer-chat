/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { replaceExact } from "../shared/exact-edit";
import { RailwayRoomSandbox } from "./railway-sandbox";
import { sqliteStorage } from "./fixtures/sqlite-storage";
import { deferred } from "./fixtures/deferred";
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

    const database = sqliteStorage();
    database.sql
      .exec(`CREATE TABLE relay_room (singleton INTEGER PRIMARY KEY, room_id TEXT, repository TEXT, branch TEXT, commit_sha TEXT, workspace_status TEXT, workspace_error TEXT);
      INSERT INTO relay_room VALUES (1, 'room-1', 'aranlucas/multiplayer-chat', 'main', 'abc123', 'ready', NULL);`);
    const storage = { sql: database.sql };
    const sandbox = new RailwayRoomSandbox(storage, {});
    vi.spyOn(sandbox, "configured", "get").mockReturnValue(true);
    const exec = vi.spyOn(sandbox, "exec").mockRejectedValue(transportError);
    const workspace = new RepositoryWorkspace(storage, {}, sandbox);

    await expect(workspace.ensureReady()).rejects.toBe(transportError);

    expect(exec).toHaveBeenCalledOnce();
    expect(exec).not.toHaveBeenCalledWith(expect.stringContaining("rm -rf"), expect.anything());
    database.close();
  });
});

// Exercise checkpoint and migration SQL against a real SQLite database.
describe("published workspace association", () => {
  it("retains the same PR through changed, repeated, and reverted checkpoints", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    database.exec(`CREATE TABLE relay_room (singleton INTEGER PRIMARY KEY, pull_request_url TEXT, pull_request_branch TEXT, pull_request_number INTEGER, pull_request_head_sha TEXT);
      INSERT INTO relay_room VALUES (1, 'https://github.com/owner/repo/pull/30', 'relay/feature', 30, 'published');`);

    const { sql } = sqliteStorage(database);

    const workspace = new RepositoryWorkspace({ sql }, {});

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

    const { sql } = sqliteStorage(database);

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

describe("RepositoryWorkspace checkpoint ownership", () => {
  it("does not overwrite newer edits if ownership changes during a sandbox read", async () => {
    const database = sqliteStorage();
    database.sql
      .exec(`CREATE TABLE relay_room (singleton INTEGER PRIMARY KEY, room_id TEXT, repository TEXT, branch TEXT, commit_sha TEXT, workspace_status TEXT);
      INSERT INTO relay_room VALUES (1, 'room-1', 'owner/repo', 'main', 'base', 'ready');`);
    const storage = { sql: database.sql };
    const sandbox = new RailwayRoomSandbox(storage, {});
    vi.spyOn(sandbox, "configured", "get").mockReturnValue(true);
    vi.spyOn(sandbox, "exec").mockImplementation(async (command) => ({
      success: true,
      exitCode: 0,
      stderr: "",
      truncated: false,
      timedOut: false,
      stdout: command.startsWith("git diff") ? "M\0feature.ts\0" : "",
    }));
    const file = deferred<string>();
    const reading = deferred<void>();
    vi.spyOn(sandbox, "readFile").mockImplementation(() => {
      reading.resolve();

      return file.promise;
    });
    const workspace = new RepositoryWorkspace(storage, {}, sandbox);
    let current = true;

    try {
      const checkpoint = workspace.syncSandboxChanges(() => current);
      await reading.promise;
      current = false;
      workspace.syncNativeAgentChanges([{ path: "feature.ts", content: "newer edits" }]);
      file.resolve("stale edits");
      expect(await checkpoint).toEqual([{ path: "feature.ts", content: "stale edits" }]);
      expect(
        database.sql.exec<{ content: string }>("SELECT content FROM relay_workspace_changes").one()
          .content,
      ).toBe("newer edits");
    } finally {
      database.close();
    }
  });
});
