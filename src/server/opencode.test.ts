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
    MICROSANDBOX_RUNNER_URL: "http://127.0.0.1:7777",
    MICROSANDBOX_RUNNER_TOKEN: "x".repeat(32),
    ...overrides,
  } as WorkerEnv;
}

describe("hasLiveOpenCode", () => {
  it("enables live mode when the native runner is configured", () => {
    expect(hasLiveOpenCode(env({}))).toBe(true);
  });

  it("requires the native runner transport", () => {
    expect(
      hasLiveOpenCode(env({ MICROSANDBOX_RUNNER_URL: undefined })),
    ).toBe(false);
    expect(
      hasLiveOpenCode(env({ MICROSANDBOX_RUNNER_TOKEN: undefined })),
    ).toBe(false);
    expect(
      liveOpenCodeConfigurationError(
        env({ MICROSANDBOX_RUNNER_URL: undefined }),
      ),
    ).toBe("The native OpenCode runner URL is not configured.");
    expect(
      liveOpenCodeConfigurationError(
        env({ MICROSANDBOX_RUNNER_TOKEN: undefined }),
      ),
    ).toBe("The native OpenCode runner token is not configured.");
  });

  it("keeps simulation mode offline", () => {
    expect(hasLiveOpenCode(env({ OPENCODE_MODE: "simulation" }))).toBe(false);
    expect(
      liveOpenCodeConfigurationError(env({ OPENCODE_MODE: "simulation" })),
    ).toBeUndefined();
  });
});
