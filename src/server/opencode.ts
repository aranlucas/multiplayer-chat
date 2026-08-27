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
  OPENCODE_MODEL_ALLOWLIST?: string;
  RELAY_DEPLOYMENT_WEBHOOK_SECRET?: string;
}

const MUSE_SPARK_MODEL = "opencode/muse-spark-1.2-contributor-free";
const MUSE_SPARK_MODEL_NAME = "Muse Spark 1.2 Contributor Free";

export function openCodeModelAllowlist(env: WorkerEnv): string[] {
  return (env.OPENCODE_MODEL_ALLOWLIST ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model, index, models) =>
      Boolean(model) && models.indexOf(model) === index,
    );
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
  type ProviderConfiguration = NonNullable<
    OpenCodeWorkerd.Configuration["providers"]
  >[string];
  const providers: Record<string, ProviderConfiguration> = {};
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
  if (
    modelProvider === "opencode" &&
    (env.OPENCODE_MODEL === MUSE_SPARK_MODEL ||
      openCodeModelAllowlist(env).includes(MUSE_SPARK_MODEL))
  ) {
    const modelID = MUSE_SPARK_MODEL.slice("opencode/".length);
    providers[modelProvider] = {
      ...providers[modelProvider],
      models: {
        ...providers[modelProvider]?.models,
        [modelID]: { name: MUSE_SPARK_MODEL_NAME },
      },
    };
  }
  return {
    default_agent: "build",
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
    providers,
    snapshots: false,
    watcher: {},
    formatter: false,
    lsp: false,
  };
}
