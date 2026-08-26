import { describe, expect, it, vi } from "vitest";
import { GitHubPullRequestClient } from "./github-pull-request";

describe("GitHubPullRequestClient", () => {
  it("creates blobs, a commit-pinned branch, and a pull request", async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    let blob = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      requests.push({ url, body });
      if (url.endsWith("/repos/owner/repo")) {
        return json({ name: "repo", full_name: "owner/repo", permissions: { push: true } });
      }
      if (url.includes("/git/commits/") && init?.method !== "POST") {
        return json({ sha: "a".repeat(40), tree: { sha: "base-tree" } });
      }
      if (url.endsWith("/git/blobs")) return json({ sha: `blob-${++blob}` }, 201);
      if (url.endsWith("/git/trees")) return json({ sha: "new-tree" }, 201);
      if (url.endsWith("/git/commits")) return json({ sha: "new-commit" }, 201);
      if (url.endsWith("/git/refs")) return json({ ref: "refs/heads/relay/test" }, 201);
      if (url.endsWith("/pulls")) return json({ number: 42, html_url: "https://github.com/owner/repo/pull/42" }, 201);
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
      ],
      title: "Relay update",
      body: "Created by Relay",
    });

    expect(result.url).toBe("https://github.com/owner/repo/pull/42");
    expect(result.branch).toMatch(/^relay\/session-test-/);
    const tree = requests.find((request) => request.url.endsWith("/git/trees"))?.body;
    expect(tree).toEqual({
      base_tree: "base-tree",
      tree: [
        { path: "README.md", mode: "100644", type: "blob", sha: "blob-1" },
        { path: "src/index.ts", mode: "100644", type: "blob", sha: "blob-2" },
      ],
    });
    const pull = requests.find((request) => request.url.endsWith("/pulls"))?.body;
    expect(pull).toMatchObject({ title: "Relay update", base: "main" });
    expect(String(pull?.head)).toMatch(/^relay\/session-test-/);
  });

  it("does not call GitHub when the room has no changes", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new GitHubPullRequestClient("token", fetcher).create({
      accessToken: "token",
      login: "owner",
      roomID: "room",
      repository: "owner/repo",
      baseBranch: "main",
      baseCommitSHA: "a".repeat(40),
      changes: [],
      title: "No changes",
      body: "",
    })).rejects.toThrow("no shared workspace changes");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
