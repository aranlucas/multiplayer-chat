import { describe, expect, it } from "vitest";
import {
  hasLiveOpenCode,
  liveOpenCodeConfigurationError,
  type WorkerEnv,
} from "./opencode";

function env(overrides: Partial<WorkerEnv>): WorkerEnv {
  return {
    OPENCODE_MODE: "live",
    OPENCODE_PROVIDER: "opencode-zen",
    OPENCODE_MODEL: "opencode/mimo-v2.5-free",
    OPENCODE_ZEN_API_KEY: "zen-test-key",
    RAILWAY_ENVIRONMENT_ID: "railway-environment",
    RAILWAY_TOKEN: "railway-project-token",
    ...overrides,
  } as WorkerEnv;
}

describe("hasLiveOpenCode", () => {
  it("enables live mode when the native runner is configured", () => {
    expect(hasLiveOpenCode(env({}))).toBe(true);
  });

  it("requires Railway sandbox access", () => {
    expect(
      hasLiveOpenCode(env({ RAILWAY_ENVIRONMENT_ID: undefined })),
    ).toBe(false);
    expect(
      hasLiveOpenCode(env({ RAILWAY_TOKEN: undefined })),
    ).toBe(false);
    expect(
      liveOpenCodeConfigurationError(
        env({ RAILWAY_ENVIRONMENT_ID: undefined }),
      ),
    ).toBe("The Railway environment ID is not configured.");
    expect(
      liveOpenCodeConfigurationError(
        env({ RAILWAY_TOKEN: undefined }),
      ),
    ).toBe("A Railway project or API token is not configured.");
  });

  it("keeps simulation mode offline", () => {
    expect(hasLiveOpenCode(env({ OPENCODE_MODE: "simulation" }))).toBe(false);
    expect(
      liveOpenCodeConfigurationError(env({ OPENCODE_MODE: "simulation" })),
    ).toBeUndefined();
  });
});
