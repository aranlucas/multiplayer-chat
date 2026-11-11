import { z } from "zod";
import { parseJsonRecord, type JsonRecord, type JsonValue } from "@/shared/json-value";

export const BASE_COMMIT = "a".repeat(40);

export interface RecordedGitHubRequest {
  url: string;
  method: string;
  body?: JsonRecord;
}

interface FakeGitHubOptions {
  /** State GitHub reports for pull request #42; undefined means the pull request is not found. */
  savedPullState?: "open" | "closed";
  /** Head of the saved `relay/existing` branch; undefined means the branch was deleted. */
  savedBranchHead?: string;
}

/** An in-memory GitHub REST API for owner/repo with push access and a saved pull request #42. */
export function fakeGitHub({ savedPullState, savedBranchHead }: FakeGitHubOptions = {}) {
  const requests: RecordedGitHubRequest[] = [];

  const fetcher = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;

    const body = init?.body ? parseJsonRecord(JSON.parse(z.string().parse(init.body))) : undefined;

    requests.push({ url, method, body });

    if (method === "GET" && path === "/repos/owner/repo") {
      return json({ name: "repo", full_name: "owner/repo", permissions: { push: true } });
    }

    if (method === "GET" && path === "/repos/owner/repo/pulls/42" && savedPullState) {
      return json({ number: 42, state: savedPullState });
    }

    if (
      method === "GET" &&
      path === "/repos/owner/repo/git/ref/heads/relay/existing" &&
      savedBranchHead
    ) {
      return json({ object: { sha: savedBranchHead } });
    }

    if (method === "GET" && path === `/repos/owner/repo/git/commits/${BASE_COMMIT}`) {
      return json({ sha: BASE_COMMIT, tree: { sha: "base-tree" } });
    }

    if (method === "POST" && path === "/repos/owner/repo/git/blobs") {
      return json({ sha: "blob" }, 201);
    }

    if (method === "POST" && path === "/repos/owner/repo/git/trees") {
      return json({ sha: "tree" }, 201);
    }

    if (method === "POST" && path === "/repos/owner/repo/git/commits") {
      return json({ sha: "new-head" }, 201);
    }

    if (method === "POST" && path === "/repos/owner/repo/git/refs") {
      return json({ ref: body?.ref ?? null }, 201);
    }

    if (
      method === "PATCH" &&
      path === "/repos/owner/repo/git/refs/heads/relay/existing" &&
      savedBranchHead
    ) {
      return json({ ref: "refs/heads/relay/existing" });
    }

    if (method === "POST" && path === "/repos/owner/repo/pulls") {
      return json({ number: 43, html_url: "https://github.com/owner/repo/pull/43" }, 201);
    }

    return json({ message: "Not Found" }, 404);
  };

  return { fetcher, requests };
}

function json(value: JsonValue, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
