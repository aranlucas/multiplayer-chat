import { describe, expect, it } from "vitest";
import {
  configuredOpenCodeModels,
  hasLiveOpenCode,
  liveOpenCodeConfigurationError,
  openCodeConfiguration,
  openCodeModelAllowlist,
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
    expect(hasLiveOpenCode(env({ RAILWAY_ENVIRONMENT_ID: undefined }))).toBe(
      false,
    );
    expect(hasLiveOpenCode(env({ RAILWAY_TOKEN: undefined }))).toBe(false);
    expect(
      liveOpenCodeConfigurationError(
        env({ RAILWAY_ENVIRONMENT_ID: undefined }),
      ),
    ).toBe("The Railway environment ID is not configured.");
    expect(
      liveOpenCodeConfigurationError(env({ RAILWAY_TOKEN: undefined })),
    ).toBe("A Railway project or API token is not configured.");
  });

  it("requires the configured OpenRouter API key", () => {
    const openRouterEnv = env({
      OPENCODE_PROVIDER: "openrouter",
      OPENCODE_MODEL: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
      OPENCODE_ZEN_API_KEY: undefined,
    });

    expect(hasLiveOpenCode(openRouterEnv)).toBe(false);
    expect(liveOpenCodeConfigurationError(openRouterEnv)).toBe(
      "The OpenRouter API key is not configured.",
    );
  });

  it("keeps simulation mode offline", () => {
    expect(hasLiveOpenCode(env({ OPENCODE_MODE: "simulation" }))).toBe(false);
    expect(
      liveOpenCodeConfigurationError(env({ OPENCODE_MODE: "simulation" })),
    ).toBeUndefined();
  });

  it("normalizes the configured model allowlist", () => {
    expect(
      openCodeModelAllowlist(
        env({
          OPENCODE_MODEL_ALLOWLIST:
            " opencode/big-pickle,opencode/mimo-v2.5-free,opencode/big-pickle ",
        }),
      ),
    ).toEqual(["opencode/big-pickle", "opencode/mimo-v2.5-free"]);
  });

  it("adds Muse to pinned OpenCode catalogs when it is configured", () => {
    const config = openCodeConfiguration(
      env({
        OPENCODE_MODEL: "opencode/muse-spark-1.2-contributor-free",
        OPENCODE_MODEL_ALLOWLIST:
          "opencode/big-pickle,opencode/muse-spark-1.2-contributor-free",
      }),
    );

    expect(
      config.providers?.opencode?.models?.["muse-spark-1.2-contributor-free"],
    ).toEqual({ name: "Muse Spark 1.2 Contributor Free" });
    expect(config.providers?.opencode?.settings).toEqual({
      apiKey: "zen-test-key",
    });
  });

  it("configures OpenRouter and adds Nemotron to pinned catalogs", () => {
    const config = openCodeConfiguration(
      env({
        OPENCODE_PROVIDER: "openrouter",
        OPENCODE_MODEL: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        OPENCODE_MODEL_ALLOWLIST:
          "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        OPENCODE_ZEN_API_KEY: undefined,
        OPENROUTER_API_KEY: "openrouter-test-key",
      }),
    );

    expect(config.providers?.openrouter?.settings).toEqual({
      apiKey: "openrouter-test-key",
    });
    expect(
      config.providers?.openrouter?.models?.[
        "nvidia/nemotron-3-ultra-550b-a55b:free"
      ],
    ).toEqual({ name: "NVIDIA Nemotron 3 Ultra (free)" });
  });

  it("uses a stable display name for the fast OpenRouter snapshot", () => {
    expect(
      configuredOpenCodeModels(
        env({
          OPENCODE_PROVIDER: "openrouter",
          OPENCODE_MODEL: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
          OPENCODE_MODEL_ALLOWLIST:
            "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        }),
      ),
    ).toEqual([
      {
        id: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        name: "NVIDIA Nemotron 3 Ultra (free)",
        providerID: "openrouter",
        free: true,
      },
    ]);
  });
});
