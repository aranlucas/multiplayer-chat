import { z } from "zod";
import { parseJsonRecord, type JsonRecord, type JsonValue } from "@/shared/json-value";
import { describe, expect, it, vi } from "vitest";
import { GitHubPullRequestClient, type ExistingPullRequest } from "@/server/github-pull-request";
import { BASE_COMMIT, fakeGitHub } from "@test/server/fixtures/github-api";

interface RecordedRequest {
  url: string;
  method?: string;
  body?: JsonRecord;
}

describe("GitHubPullRequestClient", () => {
  it("creates blobs, a commit-pinned branch, and a pull request", async () => {
    const requests: Array<RecordedRequest> = [];
    let blob = 0;

    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const url = input instanceof Request ? input.url : String(input);

      const body = init?.body
        ? parseJsonRecord(JSON.parse(z.string().parse(init.body)))
        : undefined;

      requests.push({ url, body });

      if (url.endsWith("/repos/owner/repo")) {
        return json({
          name: "repo",
          full_name: "owner/repo",
          permissions: { push: true },
        });
      }

      if (url.includes("/git/commits/") && init?.method !== "POST") {
        return json({ sha: "a".repeat(40), tree: { sha: "base-tree" } });
      }

      if (url.endsWith("/git/blobs")) {
        return json({ sha: `blob-${++blob}` }, 201);
      }

      if (url.endsWith("/git/trees")) {
        return json({ sha: "new-tree" }, 201);
      }

      if (url.endsWith("/git/commits")) {
        return json({ sha: "new-commit" }, 201);
      }

      if (url.endsWith("/git/refs")) {
        return json({ ref: "refs/heads/relay/test" }, 201);
      }

      if (url.endsWith("/pulls")) {
        return json({ number: 42, html_url: "https://github.com/owner/repo/pull/42" }, 201);
      }

      return json({ message: "not found" }, 404);
    });

    const result = await new GitHubPullRequestClient("token", fetcher).publish({
      login: "owner",
      roomID: "session-test",
      repository: "owner/repo",
      baseBranch: "main",
      baseCommitSHA: "a".repeat(40),
      changes: [
        { path: "README.md", content: "updated" },
        { path: "src/index.ts", content: "export {};" },
        { path: "src/removed.ts", content: null },
      ],
      title: "Relay update",
      body: "Created by Relay",
    });

    expect(result.url).toBe("https://github.com/owner/repo/pull/42");
    expect(result.branch).toMatch(/^relay\/session-test--/);
    const tree = requests.find((request) => request.url.endsWith("/git/trees"))?.body;
    expect(tree).toEqual({
      base_tree: "base-tree",
      tree: [
        { path: "README.md", mode: "100644", type: "blob", sha: "blob-1" },
        { path: "src/index.ts", mode: "100644", type: "blob", sha: "blob-2" },
        { path: "src/removed.ts", mode: "100644", type: "blob", sha: null },
      ],
    });
    const pull = requests.find((request) => request.url.endsWith("/pulls"))?.body;
    expect(pull).toMatchObject({ title: "Relay update", base: "main" });
    expect(z.string().parse(pull?.head)).toMatch(/^relay\/session-test--/);
  });

  it("does not call GitHub when the room has no changes", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new GitHubPullRequestClient("token", fetcher).publish({
        login: "owner",
        roomID: "room",
        repository: "owner/repo",
        baseBranch: "main",
        baseCommitSHA: "a".repeat(40),
        changes: [],
        title: "No changes",
        body: "",
      }),
    ).rejects.toThrow("no shared workspace changes");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("publishes later revisions to the same pull request branch", async () => {
    const requests: Array<RecordedRequest> = [];

    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({
        url,
        method: init?.method,
        body: init?.body ? parseJsonRecord(JSON.parse(z.string().parse(init.body))) : undefined,
      });

      if (url.endsWith("/repos/owner/repo")) {
        return json({
          full_name: "owner/repo",
          name: "repo",
          permissions: { push: true },
        });
      }

      if (url.endsWith("/git/commits/" + "a".repeat(40))) {
        return json({ sha: "a".repeat(40), tree: { sha: "base-tree" } });
      }

      if (url.endsWith("/repos/owner/repo/pulls/42")) {
        return json({ number: 42, state: "open" });
      }

      if (url.includes("/git/ref/heads/relay/existing")) {
        return json({ object: { sha: "old-head" } });
      }

      if (url.endsWith("/git/blobs")) {
        return json({ sha: "blob" }, 201);
      }

      if (url.endsWith("/git/trees")) {
        return json({ sha: "tree" }, 201);
      }

      if (url.endsWith("/git/commits")) {
        return json({ sha: "new-head" }, 201);
      }

      if (url.includes("/git/refs/heads/relay/existing")) {
        return json({}, 200);
      }

      return json({ message: "not found" }, 404);
    });

    const result = await new GitHubPullRequestClient("token", fetcher).publish(
      {
        login: "owner",
        roomID: "room",
        repository: "owner/repo",
        baseBranch: "main",
        baseCommitSHA: "a".repeat(40),
        changes: [{ path: "src/index.ts", content: "pink" }],
        title: "Pink",
        body: "",
      },
      {
        number: 42,
        url: "https://github.com/owner/repo/pull/42",
        branch: "relay/existing",
        writeRepository: "owner/repo",
        headSHA: "old-head",
      },
    );

    expect(result).toMatchObject({
      number: 42,
      branch: "relay/existing",
      commitSHA: "new-head",
    });
    expect(requests.some((request) => request.url.endsWith("/pulls"))).toBe(false);
    expect(requests.find((request) => request.method === "PATCH")?.body).toEqual({
      sha: "new-head",
      force: false,
    });
  });

  it.each([
    ["merged or closed", { savedPullState: "closed", savedBranchHead: "old-head" }],
    ["open but its branch was deleted", { savedPullState: "open" }],
    ["no longer found", { savedBranchHead: "old-head" }],
  ] as const)(
    "opens a new pull request from the base commit when the saved one is %s",
    async (_case, github) => {
      const { fetcher, requests } = fakeGitHub(github);

      const result = await new GitHubPullRequestClient("token", fetcher).publish(
        laterRevision,
        savedPullRequest,
      );

      expect(result).toMatchObject({
        number: 43,
        url: "https://github.com/owner/repo/pull/43",
        commitSHA: "new-head",
      });
      expect(result.branch).toMatch(/^relay\/room--/);
      expect(requests.find((request) => request.url.endsWith("/git/commits"))?.body).toEqual({
        message: "Pink",
        tree: "tree",
        parents: [BASE_COMMIT],
      });
      expect(requests.find((request) => request.url.endsWith("/git/refs"))?.body).toEqual({
        ref: `refs/heads/${result.branch}`,
        sha: "new-head",
      });
      expect(requests.find((request) => request.url.endsWith("/pulls"))?.body).toMatchObject({
        base: "main",
        head: result.branch,
      });
      expect(requests.some((request) => request.method === "PATCH")).toBe(false);
    },
  );

  it("refuses to publish over an open pull request whose branch moved", async () => {
    const { fetcher, requests } = fakeGitHub({
      savedPullState: "open",
      savedBranchHead: "someone-else",
    });

    await expect(
      new GitHubPullRequestClient("token", fetcher).publish(laterRevision, savedPullRequest),
    ).rejects.toThrow("Pull request branch moved from old-head to someone-else");
    expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
  });

  it("discovers the ready preview URL for an exact commit", async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url.includes("/deployments?sha=abc")) {
        return json([{ id: 7, environment: "preview" }]);
      }

      if (url.endsWith("/deployments/7/statuses?per_page=20")) {
        return json([
          {
            id: 9,
            state: "success",
            environment_url: "https://pink.example.test",
          },
        ]);
      }

      return json({ message: "not found" }, 404);
    });

    await expect(
      new GitHubPullRequestClient("token", fetcher).findDeployment("owner/repo", "abc"),
    ).resolves.toEqual({
      status: "ready",
      environmentURL: "https://pink.example.test",
      environment: "preview",
      deploymentID: "7",
    });
  });
});

function json(value: JsonValue, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const laterRevision = {
  login: "owner",
  roomID: "room",
  repository: "owner/repo",
  baseBranch: "main",
  baseCommitSHA: BASE_COMMIT,
  changes: [{ path: "src/index.ts", content: "pink" }],
  title: "Pink",
  body: "",
};

const savedPullRequest: ExistingPullRequest = {
  number: 42,
  url: "https://github.com/owner/repo/pull/42",
  branch: "relay/existing",
  writeRepository: "owner/repo",
  headSHA: "old-head",
};
