import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomContext } from "@/server/agent-room-core";
import { validateHandoffClientState } from "@/shared/handoff";
import { roomContext, TestRoom, simulationEnv } from "@test/server/fixtures/room";
import { deferred } from "@test/server/fixtures/deferred";
import { sealGitHubCredential } from "@/server/github-auth";
import type { PullRequestResult } from "@/server/github-pull-request";
import { DEFAULT_REPOSITORY, parseServerMessage } from "@/shared/protocol";
import { BASE_COMMIT, fakeGitHub } from "@test/server/fixtures/github-api";

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
    ["abc", "ready"],
    ["wrong-commit", "waiting"],
  ] as const)(
    "recovers a saved preview only for its published SHA (%s)",
    async (commitSHA, expectedStatus) => {
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
      await room.alarm();
      expect(room.info().latestRevision).toMatchObject({
        status: expectedStatus,
        commitSHA: "abc",
      });
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

describe("Cloudflare CLI Preview handoff", () => {
  const commitSHA = "abc";
  const branch = "relay/room-1--abc";
  const previewURL = "https://immutable-preview.example";
  const deploymentID = "native-deployment";
  const apiURL = `https://api.cloudflare.com/client/v4/accounts/test-account/workers/workers/test-worker/previews/${encodeURIComponent(branch)}/deployments?per_page=100`;

  function previewRoom() {
    const { context, database } = fixture();

    const setAlarm = vi.spyOn(context.storage, "setAlarm");

    const room = new TestRoom(context, {
      ...simulationEnv,
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      RELAY_PREVIEW_WORKER_NAME: "test-worker",
      RELAY_PREVIEW_API_TOKEN: "preview-read-token",
    });

    room.seed("room-1");
    room.revision({ workspaceRevision: 1, commitSHA, status: "waiting" });
    database.sql.exec(
      "UPDATE relay_room SET pull_request_head_sha = ?, pull_request_branch = ?, pull_request_repository = ?",
      commitSHA,
      branch,
      DEFAULT_REPOSITORY,
    );

    return { room, database, setAlarm };
  }

  function deployments() {
    return Response.json({
      success: true,
      result: [
        {
          id: "unrelated-deployment",
          annotations: { "workers/commit_sha": "different-sha" },
          urls: ["https://unrelated-preview.example"],
        },
        { id: deploymentID, annotations: { "workers/commit_sha": commitSHA }, urls: [previewURL] },
      ],
    });
  }

  it("waits for the exact SHA, then hands off the room and unsent draft to its immutable URL", async () => {
    const { room, setAlarm } = previewRoom();

    const readiness = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(Response.json({ ready: true, commitSHA: "wrong", roomProtocol: 1 }))
      .mockResolvedValueOnce(Response.json({ ready: true, commitSHA, roomProtocol: 1 }));

    const fetcher = vi.fn((url: string | URL, _init?: RequestInit) =>
      url === apiURL ? Promise.resolve(deployments()) : readiness(),
    );

    vi.stubGlobal("fetch", fetcher);

    await room.alarm();
    expect(room.info().latestRevision).toMatchObject({ status: "waiting" });
    expect(setAlarm).toHaveBeenCalledTimes(1);
    await room.alarm();
    expect(room.info().latestRevision).toMatchObject({
      status: "ready",
      commitSHA,
      deploymentID,
      previewURL: `${previewURL}/`,
    });
    const apiRequest = [apiURL, "Bearer preview-read-token"];
    const readinessRequest = [`${previewURL}/__relay/ready`, null];

    expect(
      fetcher.mock.calls.map(([url, init]) => [
        String(url),
        new Headers(init?.headers).get("Authorization"),
      ]),
    ).toEqual([apiRequest, readinessRequest, apiRequest, readinessRequest]);

    const controlOrigin = "https://relay.example";
    const participant = { id: "alice", name: "Alice", role: "maintainer" } as const;

    const ticket = await room.createHandoff({
      participant,
      currentOrigin: controlOrigin,
      controlOrigin,
      clientState: { draft: "unsent" },
    });

    const target = new URL(ticket.url);

    expect(target.origin).toBe(previewURL);
    await expect(
      room.redeemHandoff({
        token: target.hash.slice("#handoff=".length),
        targetOrigin: previewURL,
      }),
    ).resolves.toMatchObject({
      roomID: "room-1",
      participant,
      clientState: { draft: "unsent" },
    });
  });

  it.each([404, 503])("retries when the Preview API returns HTTP %s", async (status) => {
    const { room, setAlarm } = previewRoom();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    await room.alarm();
    expect(room.info().latestRevision).toMatchObject({ commitSHA, status: "waiting" });
    expect(setAlarm).toHaveBeenCalledTimes(1);
  });

  it("ignores a completed lookup for a revision superseded during discovery", async () => {
    const { room, database, setAlarm } = previewRoom();

    const pending = deferred<Response>();

    const fetcher = vi.fn((url: string) =>
      url === apiURL
        ? pending.promise
        : Promise.resolve(Response.json({ ready: true, commitSHA, roomProtocol: 1 })),
    );

    vi.stubGlobal("fetch", fetcher);

    const earlierPoll = room.alarm();

    expect(fetcher).toHaveBeenCalledOnce();

    const newer = room.revision({ workspaceRevision: 2, commitSHA: "new-head", status: "waiting" });

    database.sql.exec("UPDATE relay_room SET pull_request_head_sha = 'new-head'");
    pending.resolve(deployments());
    await earlierPoll;

    expect(room.info().latestRevision).toEqual(newer);
    expect(setAlarm).not.toHaveBeenCalled();
    await expect(room.recordDeployment({ commitSHA, status: "waiting" })).resolves.toMatchObject({
      status: "waiting",
      previewURL: undefined,
    });
  });
});

describe("concurrent publication", () => {
  it("publishes changes that arrive while the previous snapshot is being published", async () => {
    const { context, database } = fixture();

    const publish = vi
      .fn()
      .mockImplementationOnce(() => {
        database.sql.exec(
          "UPDATE relay_room SET workspace_revision = 2, published_workspace_revision = 1",
        );

        return Promise.resolve(publication("first"));
      })
      .mockImplementationOnce(() => {
        database.sql.exec("UPDATE relay_room SET published_workspace_revision = 2");

        return Promise.resolve(publication("second"));
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

describe("pull request lifecycle", () => {
  it("moves the room to a new pull request after its saved one was merged", async () => {
    const { context, database } = fixture();

    const room = new TestRoom(context, {
      ...simulationEnv,
      GITHUB_SESSION_SECRET: "local-test-key",
    });

    room.seed("room-1");
    room.changeWorkspace([{ path: "src/index.ts", content: "pink" }]);

    database.sql.exec(
      "INSERT INTO relay_workspace_files (path, content) VALUES ('src/index.ts', 'blue')",
    );
    database.sql.exec(
      "UPDATE relay_room SET repository = 'owner/repo', branch = 'main', commit_sha = ?, workspace_status = 'ready', workspace_revision = 2, published_workspace_revision = 1, pull_request_url = 'https://github.com/owner/repo/pull/42', pull_request_number = 42, pull_request_branch = 'relay/existing', pull_request_repository = 'owner/repo', pull_request_head_sha = 'old-head'",
      BASE_COMMIT,
    );
    const github = fakeGitHub({ savedPullState: "closed" });
    vi.stubGlobal("fetch", github.fetcher);

    await expect(
      room.createPullRequest({ accessToken: "synthetic", login: "maintainer" }),
    ).resolves.toMatchObject({ number: 43 });

    expect(room.info()).toMatchObject({
      pullRequestNumber: 43,
      pullRequestURL: "https://github.com/owner/repo/pull/43",
      pullRequestHeadSHA: "new-head",
      publishedWorkspaceRevision: 2,
    });

    const snapshot = parseServerMessage(
      await (await room.fetch(new Request("https://room.test"))).text(),
    );

    expect(
      snapshot.type === "snapshot" ? snapshot.events.at(-1)?.payload : undefined,
    ).toMatchObject({
      type: "pull_request",
      text: "@maintainer created pull request #43 because #42 is no longer open",
      url: "https://github.com/owner/repo/pull/43",
    });
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
