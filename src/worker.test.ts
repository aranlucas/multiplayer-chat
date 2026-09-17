import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("@opencode-ai/sdk/workerd", () => ({ OpenCodeWorkerd: class {} }));

import app from "./worker";
import type { WorkerEnv } from "./server/opencode";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/api/health", () => {
  it("reports Railway sandbox config presence without calling Railway", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);

    const body: unknown = await readHealth(
      env({
        RAILWAY_TOKEN: "railway-project-token",
        RAILWAY_ENVIRONMENT_ID: "railway-environment",
        GITHUB_OAUTH_CLIENT_ID: "client",
        GITHUB_OAUTH_CLIENT_SECRET: "secret",
        GITHUB_SESSION_SECRET: "session-secret",
      }),
    );

    expect(body).toEqual({
      ok: true,
      service: "relay-multiplayer-agent",
      opencodeMode: "live",
      opencodeProvider: "opencode-zen",
      sandboxConfigured: true,
      githubOAuthConfigured: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a Railway API token as sufficient when the project token is absent", async () => {
    const body: unknown = await readHealth(
      env({
        RAILWAY_TOKEN: undefined,
        RAILWAY_API_TOKEN: "railway-api-token",
        RAILWAY_ENVIRONMENT_ID: "railway-environment",
      }),
    );

    expect(body).toMatchObject({ sandboxConfigured: true });
  });

  it.each([
    ["token", { RAILWAY_TOKEN: undefined, RAILWAY_ENVIRONMENT_ID: "railway-environment" }],
    [
      "environment ID",
      { RAILWAY_TOKEN: "railway-project-token", RAILWAY_ENVIRONMENT_ID: undefined },
    ],
  ] as const)("reports the sandbox as unconfigured without a %s", async (_label, overrides) => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);

    const body: unknown = await readHealth(env(overrides));

    expect(body).toMatchObject({ ok: true, sandboxConfigured: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

async function readHealth(bindings: WorkerEnv): Promise<unknown> {
  const response = await app.request("https://relay.test/api/health", {}, bindings);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/application\/json/);
  return response.json();
}

function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    OPENCODE_MODE: "live",
    OPENCODE_PROVIDER: "opencode-zen",
    OPENCODE_MODEL: "opencode/mimo-v2.5-free",
    OPENCODE_ZEN_API_KEY: "zen-test-key",
    CLOUDFLARE_ACCOUNT_ID: "account",
    RAILWAY_ENVIRONMENT_ID: "railway-environment",
    RAILWAY_TOKEN: "railway-project-token",
    ...overrides,
  } as WorkerEnv;
}
