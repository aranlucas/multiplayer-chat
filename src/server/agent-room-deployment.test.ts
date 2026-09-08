import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("@opencode-ai/sdk/workerd", () => ({ OpenCodeWorkerd: class {} }));
vi.mock("./github-auth", () => ({
  unsealGitHubCredential: async () => ({ accessToken: "test", login: "maintainer" }),
  sealGitHubCredential: async () => "sealed",
}));

import { AgentRoom } from "./agent-room";

afterEach(() => vi.unstubAllGlobals());

describe("deployment readiness", () => {
  it.each([
    ["abc", 1],
    ["wrong-commit", 0],
  ] as const)(
    "recovers a saved preview only for its published SHA (%s)",
    async (commitSHA, expectedCalls) => {
      const revision = {
        commitSHA: "abc",
        status: "waiting",
        previewURL: "https://preview.example",
        createdAt: Date.now(),
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ ready: true, commitSHA, roomProtocol: 1 })),
      );
      const recordDeployment = vi.fn();
      const room = Object.assign(Object.create(AgentRoom.prototype) as object, {
        getRoomOrNull: () => ({ pullRequestHeadSHA: "abc", latestRevision: revision }),
        githubCredential: () => undefined,
        recordDeployment,
      }) as unknown as AgentRoom;
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
      const ready = {
        id: "revision",
        commitSHA: "abc",
        status: "ready",
        previewURL: "https://preview.example",
      };
      const exec = vi.fn();
      const room = Object.assign(Object.create(AgentRoom.prototype) as object, {
        revisionForCommit: () => ready,
        ctx: { storage: { sql: { exec } } },
      }) as unknown as AgentRoom;
      expect(await room.recordDeployment({ commitSHA: "abc", status })).toBe(ready);
      expect(exec).not.toHaveBeenCalled();
    },
  );
});

describe("concurrent publication", () => {
  it("publishes changes that arrive while the previous snapshot is being published", async () => {
    const state = { workspaceRevision: 1, publishedWorkspaceRevision: 0 };
    const createPullRequest = vi
      .fn()
      .mockImplementationOnce(async () => {
        state.workspaceRevision = 2;
        state.publishedWorkspaceRevision = 1;
        return { commitSHA: "first" };
      })
      .mockImplementationOnce(async () => {
        state.publishedWorkspaceRevision = 2;
        return { commitSHA: "second" };
      });
    const room = Object.assign(Object.create(AgentRoom.prototype) as object, {
      getRoom: () => state,
      githubCredential: () => "sealed",
      createPullRequest,
    }) as unknown as AgentRoom;
    expect(await room.publishSavedPullRequest()).toEqual({ commitSHA: "second" });
    expect(createPullRequest).toHaveBeenCalledTimes(2);
  });
  it("shares one GitHub publication between finishing turns and permits the next revision", async () => {
    let finish!: (value: { commitSHA: string }) => void;
    const publishPullRequest = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const room = Object.assign(Object.create(AgentRoom.prototype) as object, {
      publishPullRequest,
    }) as unknown as AgentRoom;
    const input = { accessToken: "test", login: "maintainer" };
    const first = room.createPullRequest(input);
    const second = room.createPullRequest(input);
    expect(publishPullRequest).toHaveBeenCalledTimes(1);
    finish({ commitSHA: "one" });
    expect(await first).toEqual({ commitSHA: "one" });
    expect(await second).toEqual({ commitSHA: "one" });
    const next = room.createPullRequest(input);
    expect(publishPullRequest).toHaveBeenCalledTimes(2);
    finish({ commitSHA: "two" });
    expect(await next).toEqual({ commitSHA: "two" });
  });

  it("releases a failed publication so a later attempt can retry", async () => {
    const publishPullRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("GitHub unavailable"))
      .mockResolvedValue({ commitSHA: "retry" });
    const room = Object.assign(Object.create(AgentRoom.prototype) as object, {
      publishPullRequest,
    }) as unknown as AgentRoom;
    const input = { accessToken: "test", login: "maintainer" };
    await expect(room.createPullRequest(input)).rejects.toThrow("GitHub unavailable");
    await expect(room.createPullRequest(input)).resolves.toEqual({ commitSHA: "retry" });
  });
});
