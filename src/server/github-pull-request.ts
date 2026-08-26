import type { WorkspaceChange } from "./microsandbox-runner";

export interface PullRequestInput {
  accessToken: string;
  login: string;
  roomID: string;
  repository: string;
  baseBranch: string;
  baseCommitSHA: string;
  changes: WorkspaceChange[];
  title: string;
  body: string;
}

export interface PullRequestResult {
  number: number;
  url: string;
  branch: string;
  repository: string;
}

interface RepositoryResponse {
  name: string;
  full_name: string;
  permissions?: { push?: boolean };
  parent?: { full_name: string };
}

interface GitCommitResponse {
  sha: string;
  tree: { sha: string };
}

const API_VERSION = "2026-03-10";

export class GitHubPullRequestClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async create(input: PullRequestInput): Promise<PullRequestResult> {
    if (!input.changes.length)
      throw new Error(
        "There are no shared workspace changes to put in a pull request",
      );
    const baseRepository = await this.request<RepositoryResponse>(
      `/repos/${input.repository}`,
    );
    const writeRepository = baseRepository.permissions?.push
      ? baseRepository.full_name
      : await this.ensureFork(input.login, baseRepository);
    const baseCommit = await this.waitForCommit(
      writeRepository,
      input.baseCommitSHA,
    );
    const blobs = await Promise.all(
      input.changes.map(async (change) => ({
        path: change.path,
        sha: (
          await this.request<{ sha: string }>(
            `/repos/${writeRepository}/git/blobs`,
            {
              method: "POST",
              body: JSON.stringify({
                content: change.content,
                encoding: "utf-8",
              }),
            },
          )
        ).sha,
      })),
    );
    const tree = await this.request<{ sha: string }>(
      `/repos/${writeRepository}/git/trees`,
      {
        method: "POST",
        body: JSON.stringify({
          base_tree: baseCommit.tree.sha,
          tree: blobs.map((blob) => ({
            path: blob.path,
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          })),
        }),
      },
    );
    const commit = await this.request<{ sha: string }>(
      `/repos/${writeRepository}/git/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          message: input.title,
          tree: tree.sha,
          parents: [input.baseCommitSHA],
        }),
      },
    );
    const branch = branchName(input.roomID);
    await this.request(`/repos/${writeRepository}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
    const pull = await this.request<{ number: number; html_url: string }>(
      `/repos/${input.repository}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          base: input.baseBranch,
          head:
            writeRepository === baseRepository.full_name
              ? branch
              : `${input.login}:${branch}`,
        }),
      },
    );
    return {
      number: pull.number,
      url: pull.html_url,
      branch,
      repository: input.repository,
    };
  }

  private async ensureFork(
    login: string,
    base: RepositoryResponse,
  ): Promise<string> {
    const forkName = `${login}/${base.name}`;
    const existing = await this.request<RepositoryResponse>(
      `/repos/${forkName}`,
      {},
      true,
    );
    if (existing) {
      if (
        existing.full_name !== forkName ||
        existing.parent?.full_name !== base.full_name
      ) {
        throw new Error(
          `GitHub repository ${forkName} exists but is not a fork of ${base.full_name}`,
        );
      }
      return forkName;
    }
    await this.request(`/repos/${base.full_name}/forks`, {
      method: "POST",
      body: JSON.stringify({ default_branch_only: false }),
    });
    return forkName;
  }

  private async waitForCommit(
    repository: string,
    sha: string,
  ): Promise<GitCommitResponse> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const commit = await this.request<GitCommitResponse>(
        `/repos/${repository}/git/commits/${sha}`,
        {},
        true,
      );
      if (commit) return commit;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250 * 2 ** attempt, 2_000)),
      );
    }
    throw new Error(
      `GitHub fork did not make commit ${sha.slice(0, 12)} available in time`,
    );
  }

  private async request<T = unknown>(
    path: string,
    init?: RequestInit,
  ): Promise<T>;
  private async request<T = unknown>(
    path: string,
    init: RequestInit,
    allowNotFound: true,
  ): Promise<T | undefined>;
  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
    allowNotFound = false,
  ): Promise<T | undefined> {
    const response = await this.fetcher.call(
      globalThis,
      `https://api.github.com${path}`,
      {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "relay-multiplayer-agent",
          "X-GitHub-Api-Version": API_VERSION,
          ...init.headers,
        },
      },
    );
    if (allowNotFound && response.status === 404) return undefined;
    const value: Record<string, unknown> = await response
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof value.message === "string"
          ? value.message
          : `GitHub API request failed (${response.status})`,
      );
    }
    return value as T;
  }
}

function branchName(roomID: string): string {
  const room = roomID
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32);
  return `relay/${room || "session"}-${Date.now().toString(36)}`;
}
