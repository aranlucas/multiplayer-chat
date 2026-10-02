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
    expect(hasLiveOpenCode(env({ RAILWAY_ENVIRONMENT_ID: undefined }))).toBe(false);
    expect(hasLiveOpenCode(env({ RAILWAY_TOKEN: undefined }))).toBe(false);
    expect(liveOpenCodeConfigurationError(env({ RAILWAY_ENVIRONMENT_ID: undefined }))).toBe(
      "The Railway environment ID is not configured.",
    );
    expect(liveOpenCodeConfigurationError(env({ RAILWAY_TOKEN: undefined }))).toBe(
      "A Railway project or API token is not configured.",
    );
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
    expect(liveOpenCodeConfigurationError(env({ OPENCODE_MODE: "simulation" }))).toBeUndefined();
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
        OPENCODE_MODEL_ALLOWLIST: "opencode/big-pickle,opencode/muse-spark-1.2-contributor-free",
      }),
    );

    expect(config.providers?.opencode?.models?.["muse-spark-1.2-contributor-free"]).toEqual({
      name: "Muse Spark 1.2 Contributor Free",
    });
    expect(config.providers?.opencode?.settings).toEqual({
      apiKey: "zen-test-key",
    });
  });

  it("configures OpenRouter and adds Nemotron to pinned catalogs", () => {
    const config = openCodeConfiguration(
      env({
        OPENCODE_PROVIDER: "openrouter",
        OPENCODE_MODEL: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        OPENCODE_MODEL_ALLOWLIST: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
        OPENCODE_ZEN_API_KEY: undefined,
        OPENROUTER_API_KEY: "openrouter-test-key",
      }),
    );

    expect(config.providers?.openrouter?.settings).toEqual({
      apiKey: "openrouter-test-key",
    });
    expect(
      config.providers?.openrouter?.models?.["nvidia/nemotron-3-ultra-550b-a55b:free"],
    ).toEqual({ name: "NVIDIA Nemotron 3 Ultra (free)" });
  });

  it("routes OpenRouter through an authenticated gateway without changing the model or key", () => {
    const gatewayEnv = env({
      OPENCODE_PROVIDER: "openrouter",
      OPENCODE_MODEL: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
      OPENROUTER_API_KEY: "openrouter-test-key",
      CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_AI_GATEWAY_ID: " relay ",
      CLOUDFLARE_AI_GATEWAY_TOKEN: " gateway-run-token ",
    });

    expect(hasLiveOpenCode(gatewayEnv)).toBe(true);
    expect(openCodeConfiguration(gatewayEnv).providers?.openrouter).toMatchObject({
      settings: {
        apiKey: "openrouter-test-key",
        baseURL:
          "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/relay/openrouter",
      },
      headers: {
        "cf-aig-authorization": "Bearer gateway-run-token",
        "cf-aig-collect-log": "true",
        "cf-aig-collect-log-payload": "false",
        "cf-aig-skip-cache": "true",
        "cf-aig-no-wholesale": "true",
        "cf-aig-metadata": '{"application":"relay"}',
      },
      models: {
        "nvidia/nemotron-3-ultra-550b-a55b:free": { name: "NVIDIA Nemotron 3 Ultra (free)" },
      },
    });
  });

  it("allows an unauthenticated gateway and explicit payload logging", () => {
    const config = openCodeConfiguration(
      env({
        OPENCODE_PROVIDER: "openrouter",
        OPENCODE_MODEL: "openrouter/openai/gpt-4.1",
        OPENROUTER_API_KEY: "openrouter-test-key",
        CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_AI_GATEWAY_ID: "relay-Team_1",
        CLOUDFLARE_AI_GATEWAY_LOG_PAYLOADS: "true",
      }),
    );

    expect(config.providers?.openrouter?.headers?.["cf-aig-authorization"]).toBeUndefined();
    expect(config.providers?.openrouter?.headers?.["cf-aig-collect-log-payload"]).toBe("true");
    expect(config.providers?.openrouter?.settings?.baseURL).toBe(
      "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/relay-Team_1/openrouter",
    );
  });

  it.each([
    { CLOUDFLARE_ACCOUNT_ID: undefined },
    { CLOUDFLARE_ACCOUNT_ID: "../another-account" },
    { CLOUDFLARE_AI_GATEWAY_ID: "relay/other-provider" },
    { CLOUDFLARE_AI_GATEWAY_ID: "relay?override=true" },
    { CLOUDFLARE_AI_GATEWAY_ID: "r".repeat(65) },
    { CLOUDFLARE_AI_GATEWAY_TOKEN: "token\r\ninjected: value" },
    { CLOUDFLARE_AI_GATEWAY_LOG_PAYLOADS: "yes" },
    { OPENCODE_PROVIDER: "opencode-zen" as const },
    { OPENCODE_PROVIDER: "cloudflare-workers-ai" as const },
    { OPENCODE_MODEL: "opencode/mimo-v2.5-free" },
  ])(
    "rejects invalid gateway options instead of silently using a direct provider: %j",
    (invalid) => {
      const gatewayEnv = env({
        OPENCODE_PROVIDER: "openrouter",
        OPENCODE_MODEL: "openrouter/openai/gpt-4.1",
        OPENROUTER_API_KEY: "openrouter-test-key",
        CLOUDFLARE_API_TOKEN: "workers-ai-token",
        CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_AI_GATEWAY_ID: "relay",
        ...invalid,
      });

      expect(hasLiveOpenCode(gatewayEnv)).toBe(false);
      const error = liveOpenCodeConfigurationError(gatewayEnv);
      expect(error).toBeTruthy();
      expect(() => openCodeConfiguration(gatewayEnv)).toThrow(error);
    },
  );

  it("requires a gateway ID when a gateway token is set", () => {
    const gatewayEnv = env({ CLOUDFLARE_AI_GATEWAY_TOKEN: "gateway-run-token" });
    expect(hasLiveOpenCode(gatewayEnv)).toBe(false);
    expect(() => openCodeConfiguration(gatewayEnv)).toThrow("Set CLOUDFLARE_AI_GATEWAY_ID");
  });

  it("still requires the OpenRouter key when gateway routing is enabled", () => {
    expect(
      liveOpenCodeConfigurationError(
        env({
          OPENCODE_PROVIDER: "openrouter",
          CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
          CLOUDFLARE_AI_GATEWAY_ID: "relay",
        }),
      ),
    ).toBe("The OpenRouter API key is not configured.");
  });

  it("disables code mode when workspace tools are direct-only", () => {
    expect(openCodeConfiguration(env({})).permissions).toEqual([
      { action: "*", resource: "*", effect: "allow" },
      { action: "execute", resource: "*", effect: "deny" },
    ]);
  });

  it("uses a stable display name for the fast OpenRouter snapshot", () => {
    expect(
      configuredOpenCodeModels(
        env({
          OPENCODE_PROVIDER: "openrouter",
          OPENCODE_MODEL: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
          OPENCODE_MODEL_ALLOWLIST: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
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
