import { describe, expect, it, vi } from "vitest";
import { GitHubPullRequestClient } from "./github-pull-request";

describe("GitHubPullRequestClient", () => {
  it("creates blobs, a commit-pinned branch, and a pull request", async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    let blob = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
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
      if (url.endsWith("/git/blobs"))
        return json({ sha: `blob-${++blob}` }, 201);
      if (url.endsWith("/git/trees")) return json({ sha: "new-tree" }, 201);
      if (url.endsWith("/git/commits")) return json({ sha: "new-commit" }, 201);
      if (url.endsWith("/git/refs"))
        return json({ ref: "refs/heads/relay/test" }, 201);
      if (url.endsWith("/pulls"))
        return json(
          { number: 42, html_url: "https://github.com/owner/repo/pull/42" },
          201,
        );
      return json({ message: "not found" }, 404);
    });
    const result = await new GitHubPullRequestClient("token", fetcher).create({
      accessToken: "token",
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
    const tree = requests.find((request) =>
      request.url.endsWith("/git/trees"),
    )?.body;
    expect(tree).toEqual({
      base_tree: "base-tree",
      tree: [
        { path: "README.md", mode: "100644", type: "blob", sha: "blob-1" },
        { path: "src/index.ts", mode: "100644", type: "blob", sha: "blob-2" },
        { path: "src/removed.ts", mode: "100644", type: "blob", sha: null },
      ],
    });
    const pull = requests.find((request) =>
      request.url.endsWith("/pulls"),
    )?.body;
    expect(pull).toMatchObject({ title: "Relay update", base: "main" });
    expect(String(pull?.head)).toMatch(/^relay\/session-test--/);
  });

  it("does not call GitHub when the room has no changes", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new GitHubPullRequestClient("token", fetcher).create({
        accessToken: "token",
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
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith("/repos/owner/repo"))
        return json({ full_name: "owner/repo", name: "repo", permissions: { push: true } });
      if (url.endsWith("/git/commits/" + "a".repeat(40)))
        return json({ sha: "a".repeat(40), tree: { sha: "base-tree" } });
      if (url.includes("/git/ref/heads/relay/existing"))
        return json({ object: { sha: "old-head" } });
      if (url.endsWith("/git/blobs")) return json({ sha: "blob" }, 201);
      if (url.endsWith("/git/trees")) return json({ sha: "tree" }, 201);
      if (url.endsWith("/git/commits")) return json({ sha: "new-head" }, 201);
      if (url.includes("/git/refs/heads/relay/existing")) return json({}, 200);
      return json({ message: "not found" }, 404);
    });
    const result = await new GitHubPullRequestClient("token", fetcher).publish(
      {
        accessToken: "token",
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
    expect(
      requests.find((request) => request.method === "PATCH")?.body,
    ).toEqual({ sha: "new-head", force: false });
  });

  it("discovers the ready preview URL for an exact commit", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/deployments?sha=abc"))
        return json([{ id: 7, environment: "preview" }]);
      if (url.endsWith("/deployments/7/statuses?per_page=20"))
        return json([
          {
            id: 9,
            state: "success",
            environment_url: "https://pink.example.test",
          },
        ]);
      return json({ message: "not found" }, 404);
    });

    await expect(
      new GitHubPullRequestClient("token", fetcher).findDeployment(
        "owner/repo",
        "abc",
      ),
    ).resolves.toEqual({
      status: "ready",
      environmentURL: "https://pink.example.test",
      environment: "preview",
      deploymentID: "7",
    });
  });
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
