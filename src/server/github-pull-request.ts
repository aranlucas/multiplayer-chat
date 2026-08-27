import type { WorkspaceChange } from "../shared/workspace-change";

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
  writeRepository: string;
  commitSHA: string;
}

export interface ExistingPullRequest {
  number: number;
  url: string;
  branch: string;
  writeRepository: string;
  headSHA: string;
}

export interface DeploymentObservation {
  status: "waiting" | "building" | "ready" | "failed";
  environmentURL?: string;
  environment?: string;
  deploymentID?: string;
  failure?: string;
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
    return this.publish(input);
  }

  async publish(
    input: PullRequestInput,
    existing?: ExistingPullRequest,
  ): Promise<PullRequestResult> {
    if (!input.changes.length)
      throw new Error(
        "There are no shared workspace changes to put in a pull request",
      );
    const baseRepository = await this.request<RepositoryResponse>(
      `/repos/${input.repository}`,
    );
    const writeRepository =
      existing?.writeRepository ??
      (baseRepository.permissions?.push
        ? baseRepository.full_name
        : await this.ensureFork(input.login, baseRepository));
    const baseCommit = await this.waitForCommit(
      writeRepository,
      input.baseCommitSHA,
    );
    const blobs = await Promise.all(
      input.changes.map(async (change) => {
        if (change.content === null) return { path: change.path, sha: null };
        return {
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
        };
      }),
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
    let parentSHA = input.baseCommitSHA;
    if (existing) {
      const remote = await this.request<{ object: { sha: string } }>(
        `/repos/${writeRepository}/git/ref/heads/${refPath(existing.branch)}`,
      );
      if (remote.object.sha !== existing.headSHA) {
        throw new Error(
          `Pull request branch moved from ${existing.headSHA.slice(0, 12)} to ${remote.object.sha.slice(0, 12)}; refresh the room before publishing`,
        );
      }
      parentSHA = remote.object.sha;
    }
    const commit = await this.request<{ sha: string }>(
      `/repos/${writeRepository}/git/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          message: input.title,
          tree: tree.sha,
          parents: [parentSHA],
        }),
      },
    );
    const branch = existing?.branch ?? branchName(input.roomID);
    if (existing) {
      await this.request(
        `/repos/${writeRepository}/git/refs/heads/${refPath(branch)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: commit.sha, force: false }),
        },
      );
    } else {
      await this.request(`/repos/${writeRepository}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
      });
    }
    const pull = existing
      ? { number: existing.number, html_url: existing.url }
      : await this.request<{ number: number; html_url: string }>(
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
      writeRepository,
      commitSHA: commit.sha,
    };
  }

  async findDeployment(
    repository: string,
    commitSHA: string,
  ): Promise<DeploymentObservation> {
    const deployments = await this.request<
      Array<{ id: number; environment?: string }>
    >(
      `/repos/${repository}/deployments?sha=${encodeURIComponent(commitSHA)}&per_page=20`,
    );
    if (!deployments.length) return { status: "waiting" };

    for (const deployment of deployments) {
      const statuses = await this.request<
        Array<{
          id: number;
          state: string;
          environment_url?: string;
          description?: string;
        }>
      >(`/repos/${repository}/deployments/${deployment.id}/statuses?per_page=20`);
      const latest = statuses[0];
      if (!latest) continue;
      if (latest.state === "success" && latest.environment_url) {
        return {
          status: "ready",
          environmentURL: latest.environment_url,
          environment: deployment.environment,
          deploymentID: String(deployment.id),
        };
      }
      if (
        latest.state === "failure" ||
        latest.state === "error" ||
        latest.state === "inactive"
      ) {
        return {
          status: "failed",
          environment: deployment.environment,
          deploymentID: String(deployment.id),
          failure: latest.description || `Deployment ${latest.state}`,
        };
      }
      return {
        status: "building",
        environment: deployment.environment,
        deploymentID: String(deployment.id),
      };
    }
    return { status: "waiting" };
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
    .slice(0, 64);
  return `relay/${room || "session"}--${Date.now().toString(36)}`;
}

function refPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}
