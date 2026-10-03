import { afterEach, describe, expect, it, vi } from "vitest";
import { validateHandoffClientState, type RoomContext } from "./agent-room-core";
import { roomContext, TestRoom, simulationEnv } from "./fixtures/room";
import { deferred } from "./fixtures/deferred";
import { sealGitHubCredential } from "./github-auth";
import type { PullRequestResult } from "./github-pull-request";

const databases: ReturnType<typeof roomContext>["database"][] = [];

afterEach(() => {
  vi.unstubAllGlobals();

  for (const database of databases.splice(0)) {
    database.close();
  }
});

function fixture() {
  const value = roomContext();
  databases.push(value.database);

  return value;
}

function publication(commitSHA: string): PullRequestResult {
  return {
    number: 1,
    url: "https://github.com/owner/repo/pull/1",
    branch: "relay/test",
    repository: "owner/repo",
    writeRepository: "owner/repo",
    commitSHA,
  };
}

class PublishingRoom extends TestRoom {
  constructor(
    context: RoomContext,
    private readonly publish: () => Promise<PullRequestResult>,
  ) {
    super(context, { ...simulationEnv, GITHUB_SESSION_SECRET: "local-test-key" });
  }
  protected override publishPullRequest() {
    return this.publish();
  }
}

describe("deployment readiness", () => {
  it.each([
    ["abc", 1],
    ["wrong-commit", 0],
  ] as const)(
    "recovers a saved preview only for its published SHA (%s)",
    async (commitSHA, expectedCalls) => {
      const { context, database } = fixture();
      const room = new TestRoom(context);
      room.seed("room-1");
      room.revision({
        workspaceRevision: 1,
        commitSHA: "abc",
        status: "waiting",
        previewURL: "https://preview.example",
      });
      database.sql.exec("UPDATE relay_room SET pull_request_head_sha = 'abc'");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ ready: true, commitSHA, roomProtocol: 1 })),
      );
      const recordDeployment = vi.spyOn(room, "recordDeployment");
      await room.alarm();
      expect(recordDeployment).toHaveBeenCalledTimes(expectedCalls);
      expect(recordDeployment.mock.calls).toEqual(
        Array.from({ length: expectedCalls }, (): unknown[] => [
          expect.objectContaining({ status: "ready", commitSHA: "abc" }),
        ]),
      );
    },
  );
  it.each(["waiting", "building", "failed"] as const)(
    "does not let a stale %s observation overwrite a ready callback",
    async (status) => {
      const { context } = fixture();
      const room = new TestRoom(context);
      room.seed("room-1");

      const ready = room.revision({
        workspaceRevision: 1,
        commitSHA: "abc",
        status: "ready",
        previewURL: "https://preview.example",
      });

      expect(await room.recordDeployment({ commitSHA: "abc", status })).toEqual(ready);
      expect(room.info().latestRevision).toEqual(ready);
    },
  );
});

describe("concurrent publication", () => {
  it("publishes changes that arrive while the previous snapshot is being published", async () => {
    const { context, database } = fixture();

    const publish = vi
      .fn()
      .mockImplementationOnce(async () => {
        database.sql.exec(
          "UPDATE relay_room SET workspace_revision = 2, published_workspace_revision = 1",
        );

        return publication("first");
      })
      .mockImplementationOnce(async () => {
        database.sql.exec("UPDATE relay_room SET published_workspace_revision = 2");

        return publication("second");
      });

    const room = new PublishingRoom(context, publish);
    room.seed("room-1");

    const sealed = await sealGitHubCredential(
      { accessToken: "synthetic", login: "maintainer" },
      { GITHUB_SESSION_SECRET: "local-test-key" },
    );

    database.sql.exec(
      "UPDATE relay_room SET workspace_revision = 1, github_credential = ?",
      sealed,
    );
    expect(await room.publishSavedPullRequest()).toEqual(publication("second"));
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("shares one GitHub publication between finishing turns and permits the next revision", async () => {
    const { context } = fixture();
    let completion = deferred<PullRequestResult>();
    const publish = vi.fn(() => completion.promise);
    const room = new PublishingRoom(context, publish);
    const input = { accessToken: "synthetic", login: "maintainer" };
    const first = room.createPullRequest(input);
    const second = room.createPullRequest(input);
    expect(publish).toHaveBeenCalledTimes(1);
    completion.resolve(publication("one"));
    expect(await first).toEqual(publication("one"));
    expect(await second).toEqual(publication("one"));
    completion = deferred<PullRequestResult>();
    const next = room.createPullRequest(input);
    expect(publish).toHaveBeenCalledTimes(2);
    completion.resolve(publication("two"));
    expect(await next).toEqual(publication("two"));
  });
  it("releases a failed publication so a later attempt can retry", async () => {
    const { context } = fixture();

    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("GitHub unavailable"))
      .mockResolvedValue(publication("retry"));

    const room = new PublishingRoom(context, publish);
    const input = { accessToken: "synthetic", login: "maintainer" };
    await expect(room.createPullRequest(input)).rejects.toThrow("GitHub unavailable");
    await expect(room.createPullRequest(input)).resolves.toEqual(publication("retry"));
  });
});

describe("preview handoff client state", () => {
  it("keeps the brief tab through redeem instead of collapsing it to transcript", () => {
    expect(validateHandoffClientState({ draft: "unsent", mobileTab: "brief" })).toEqual({
      draft: "unsent",
      selectedID: undefined,
      mobileTab: "brief",
    });

    for (const mobileTab of ["people", "queue", "transcript"] as const) {
      expect(validateHandoffClientState({ mobileTab })?.mobileTab).toBe(mobileTab);
    }
  });
});
