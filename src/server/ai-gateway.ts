interface GatewayConfiguration {
  settings: { baseURL: string };
  headers: Record<string, string>;
}

import type { OpenCodeWorkerd } from "@opencode/sdk/workerd";

export interface AIGatewayEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
  CLOUDFLARE_AI_GATEWAY_LOG_PAYLOADS?: string;
  OPENCODE_PROVIDER: string;
  OPENCODE_MODEL: string;
}

type ProviderConfiguration = NonNullable<OpenCodeWorkerd.Configuration["providers"]>[string];

export function aiGatewayConfigurationError(env: AIGatewayEnv): string | undefined {
  const gatewayID = env.CLOUDFLARE_AI_GATEWAY_ID?.trim();

  if (!gatewayID) {
    return env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim() || env.CLOUDFLARE_AI_GATEWAY_LOG_PAYLOADS?.trim()
      ? "Set CLOUDFLARE_AI_GATEWAY_ID before configuring AI Gateway options."
      : undefined;
  }

  if (env.OPENCODE_PROVIDER !== "openrouter") {
    return "Relay AI Gateway routing requires OPENCODE_PROVIDER=openrouter.";
  }

  if (!env.OPENCODE_MODEL.startsWith("openrouter/")) {
    return "Relay AI Gateway routing requires an openrouter/ model ID.";
  }

  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "")) {
    return "AI Gateway requires a valid CLOUDFLARE_ACCOUNT_ID (32 hexadecimal characters).";
  }

  if (!/^[a-z0-9_-]{1,64}$/i.test(gatewayID)) {
    return "CLOUDFLARE_AI_GATEWAY_ID must contain 1–64 letters, numbers, underscores, or hyphens.";
  }

  const token = env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim();

  if (token && /\s/.test(token)) {
    return "CLOUDFLARE_AI_GATEWAY_TOKEN must not contain whitespace.";
  }

  const logPayloads = env.CLOUDFLARE_AI_GATEWAY_LOG_PAYLOADS?.trim();

  if (logPayloads && logPayloads !== "true" && logPayloads !== "false") {
    return "CLOUDFLARE_AI_GATEWAY_LOG_PAYLOADS must be true or false.";
  }

  return undefined;
}

export function openRouterGatewayConfiguration(
  env: AIGatewayEnv,
): Pick<ProviderConfiguration, "settings" | "headers"> | undefined {
  const error = aiGatewayConfigurationError(env);

  if (error) {
    throw new Error(error);
  }

  const gatewayID = env.CLOUDFLARE_AI_GATEWAY_ID?.trim();

  if (!gatewayID) {
    return undefined;
  }

  const token = env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim();

  const configuration: GatewayConfiguration = {
    settings: {
      baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID?.trim()}/${gatewayID}/openrouter`,
    },
    headers: {
      "cf-aig-collect-log": "true",
      "cf-aig-collect-log-payload":
        env.CLOUDFLARE_AI_GATEWAY_LOG_PAYLOADS?.trim() === "true" ? "true" : "false",
      "cf-aig-skip-cache": "true",
      "cf-aig-no-wholesale": "true",
      "cf-aig-metadata": JSON.stringify({ application: "relay" }),
    },
  };

  if (token) {
    configuration.headers["cf-aig-authorization"] = `Bearer ${token}`;
  }

  return configuration;
}
