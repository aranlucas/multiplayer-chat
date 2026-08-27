import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd";
import type { GitHubOAuthEnv } from "./github-auth";
import type { RailwaySandboxEnv } from "./railway-sandbox";

export interface WorkerEnv extends GitHubOAuthEnv, RailwaySandboxEnv {
  AGENT_ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  OPENCODE_MODE: "simulation" | "live";
  OPENCODE_PROVIDER: "opencode-zen" | "cloudflare-workers-ai";
  OPENCODE_ZEN_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN?: string;
  OPENCODE_MODEL: string;
  RELAY_DEPLOYMENT_WEBHOOK_SECRET?: string;
}

export function hasLiveOpenCode(env: WorkerEnv) {
  return env.OPENCODE_MODE === "live" && !liveOpenCodeConfigurationError(env);
}

export function liveOpenCodeConfigurationError(
  env: WorkerEnv,
): string | undefined {
  if (env.OPENCODE_MODE !== "live") return undefined;
  if (!env.RAILWAY_ENVIRONMENT_ID)
    return "The Railway environment ID is not configured.";
  if (!env.RAILWAY_TOKEN && !env.RAILWAY_API_TOKEN)
    return "A Railway project or API token is not configured.";
  if (
    env.OPENCODE_PROVIDER === "opencode-zen" &&
    !env.OPENCODE_ZEN_API_KEY
  )
    return "The OpenCode Zen API key is not configured.";
  if (
    env.OPENCODE_PROVIDER === "cloudflare-workers-ai" &&
    !env.CLOUDFLARE_API_TOKEN
  )
    return "The Cloudflare API token is not configured.";
  return undefined;
}

export function openCodeConfiguration(
  env: WorkerEnv,
): OpenCodeWorkerd.Configuration {
  const [modelProvider] = env.OPENCODE_MODEL.split("/", 1);
  const providers: Record<string, { settings: Record<string, string> }> = {};
  if (env.OPENCODE_PROVIDER === "opencode-zen" && env.OPENCODE_ZEN_API_KEY) {
    providers[modelProvider] = {
      settings: { apiKey: env.OPENCODE_ZEN_API_KEY },
    };
  }
  if (
    env.OPENCODE_PROVIDER === "cloudflare-workers-ai" &&
    env.CLOUDFLARE_API_TOKEN
  ) {
    providers[modelProvider] = {
      settings: {
        apiKey: env.CLOUDFLARE_API_TOKEN,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
      },
    };
  }
  return {
    default_agent: "build",
    model: env.OPENCODE_MODEL,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    providers,
    snapshots: false,
    watcher: {},
    formatter: false,
    lsp: false,
  };
}
