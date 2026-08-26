import type { Sandbox } from "@cloudflare/sandbox";
import type { GitHubOAuthEnv } from "./github-auth";
import type { MicrosandboxRunnerEnv } from "./microsandbox-runner";

export interface WorkerEnv extends GitHubOAuthEnv, MicrosandboxRunnerEnv {
  AGENT_ROOMS: DurableObjectNamespace;
  Sandbox?: DurableObjectNamespace<Sandbox>;
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
  if (!env.MICROSANDBOX_RUNNER_URL)
    return "The native OpenCode runner URL is not configured.";
  if (!env.MICROSANDBOX_RUNNER_TOKEN)
    return "The native OpenCode runner token is not configured.";
  return undefined;
}
