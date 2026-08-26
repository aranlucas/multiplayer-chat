import { describe, expect, it } from "vitest";
import { hasLiveOpenCode, type WorkerEnv } from "./opencode";

function env(overrides: Partial<WorkerEnv>): WorkerEnv {
  return {
    OPENCODE_MODE: "live",
    OPENCODE_PROVIDER: "opencode-zen",
    OPENCODE_MODEL: "opencode/mimo-v2.5-free",
    ...overrides,
  } as WorkerEnv;
}

describe("hasLiveOpenCode", () => {
  it("allows a current Zen free model without an API key", () => {
    expect(hasLiveOpenCode(env({}))).toBe(true);
  });

  it("still requires a Zen API key for paid models", () => {
    expect(
      hasLiveOpenCode(env({ OPENCODE_MODEL: "opencode/claude-sonnet-5" })),
    ).toBe(false);
    expect(
      hasLiveOpenCode(
        env({
          OPENCODE_MODEL: "opencode/claude-sonnet-5",
          OPENCODE_ZEN_API_KEY: "secret",
        }),
      ),
    ).toBe(true);
  });

  it("keeps simulation mode offline", () => {
    expect(hasLiveOpenCode(env({ OPENCODE_MODE: "simulation" }))).toBe(false);
  });
});
